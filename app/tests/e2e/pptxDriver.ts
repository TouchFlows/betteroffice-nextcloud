import { expect, type Page } from '@playwright/test';
import { TEST_RELAY_URL } from './testRelay';

/**
 * Drives the real presentation editor the way `editorDriver.ts` drives the
 * DOCX one: through the editor's own API, because slides are painted to
 * canvas and there is no DOM text to read or click.
 *
 * The API is exposed by the harness (`harness/main.tsx` passes `onReady` into
 * the same `EditorRoute` production uses).
 */

export const PPTX_EDITOR_PATH = `/?fileId=3&fileName=betteroffice-demo.pptx&format=pptx&relayUrl=${encodeURIComponent(TEST_RELAY_URL)}`;

/** The deck's own title, so an edit lands in a story that exists in the fixture. */
const ANCHOR_TEXT = 'BETTEROFFICE';

interface PptxStory {
	storyId: string;
	slideId: string;
	shapeId: string;
	text: string;
}

interface PptxRead {
	ok: boolean;
	version: string;
	stories: PptxStory[];
}

interface PptxApi {
	readContent: () => Promise<unknown>;
	applyEdits: (request: unknown) => Promise<Record<string, unknown>>;
	findText: (request: { text: string; limit?: number }) => Promise<unknown>;
}

/**
 * Reads the deck's stories through the editor.
 *
 * Like the DOCX handle's reads, these are serialised in the editor's worker
 * and a read still in flight is rejected with "Worker read was superseded" --
 * typically because an update from the relay started the editor's own read.
 * That is the editor's race, not what the collaboration specs assert, so it is
 * retried; anything else fails.
 */
async function readDeck(page: Page): Promise<PptxRead | null> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await page.evaluate(async () => {
				const api = (window as unknown as { __betteroffice?: { pptxApi?: PptxApi } }).__betteroffice?.pptxApi;
				if (!api) return null;
				const result = (await api.readContent()) as PptxRead | null;
				return result && result.ok === true ? result : null;
			});
		} catch (error) {
			const superseded = error instanceof Error && error.message.includes('superseded');
			if (!superseded || attempt >= 4) throw error;
			await page.waitForTimeout(50);
		}
	}
}

/**
 * Opens the deck with collaboration on and waits until it is connected and
 * synced. `readOnly` mirrors what the page passes for a file the viewer may
 * not update, so the same app path is exercised for viewers and writers.
 */
export async function openPptxEditor(page: Page, { readOnly = false } = {}): Promise<void> {
	await page.goto(`${PPTX_EDITOR_PATH}${readOnly ? '&readOnly=1' : ''}`);
	await expect(page.getByRole('application', { name: 'Presentation slide editor' })).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('[data-collaboration-synced="1"]')).toBeVisible({ timeout: 30_000 });
	await expect.poll(async () => (await readDeck(page)) !== null, { timeout: 30_000 }).toBe(true);
}

/** Whether the deck's own model contains `text` -- what a peer edit has to change. */
export async function deckHasText(page: Page, text: string): Promise<boolean> {
	try {
		return await page.evaluate(async (needle) => {
			const api = (window as unknown as { __betteroffice?: { pptxApi?: PptxApi } }).__betteroffice?.pptxApi;
			if (!api) return false;
			const result = (await api.findText({ text: needle, limit: 5 })) as {
				ok?: boolean;
				matches?: unknown[];
			} | null;
			return result?.ok === true && (result.matches?.length ?? 0) > 0;
		}, text);
	} catch (error) {
		// A find can lose the same race a read can; a retry by the caller is
		// cheaper than duplicating the retry loop here.
		if (error instanceof Error && error.message.includes('superseded')) return false;
		throw error;
	}
}

interface WriteOutcome {
	ok: boolean;
	/** Why the write did not land: an edit refusal code, or a local failure. */
	reason: string;
}

/**
 * One attempt to append `marker` to the paragraph containing the deck's title,
 * through the editor's own `applyEdits` -- the edit goes down the
 * collaboration path, not into local state only.
 *
 * The story is found through `readDeck`, so a read superseded by an update
 * from the relay is retried there rather than failing the write.
 */
async function writeMarker(page: Page, marker: string): Promise<WriteOutcome> {
	const read = await readDeck(page);
	if (read === null) return { ok: false, reason: 'unreadable' };
	const story = read.stories.find((candidate) => candidate.text.includes(ANCHOR_TEXT));
	if (story === undefined) return { ok: false, reason: 'no anchor story' };

	try {
		return await page.evaluate(
			async ({ anchor, marker, target }) => {
				const api = (window as unknown as { __betteroffice?: { pptxApi?: PptxApi } }).__betteroffice?.pptxApi;
				if (!api) return { ok: false, reason: 'no api' };
				const current = (await api.readContent()) as PptxRead | null;
				if (!current || current.ok !== true) return { ok: false, reason: 'unreadable' };
				const result = (await api.applyEdits({
					expectVersion: current.version,
					steps: [
						{
							op: 'insertText',
							target: { kind: 'search', within: target, text: anchor },
							at: 'end',
							text: marker,
						},
					],
				})) as { ok?: boolean; failure?: { code?: string } };
				if (result?.ok === true) return { ok: true, reason: 'applied' };
				return { ok: false, reason: result?.failure?.code ?? JSON.stringify(result) };
			},
			{
				anchor: ANCHOR_TEXT,
				marker,
				target: { slideId: story.slideId, shapeId: story.shapeId, storyId: story.storyId },
			},
		);
	} catch (error) {
		// An update landing mid-request can reject the call itself; the caller
		// retries, which is cheaper than duplicating the retry loop here.
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Appends `marker` to the paragraph containing the deck's title, through the
 * editor's own `applyEdits`.
 *
 * `applyEdits` refuses with `stale-version` when the deck changed between the
 * read and the write -- which is exactly what a peer's update does -- so the
 * read and the edit are retried together rather than failing the run.
 */
export async function appendToTitle(page: Page, marker: string): Promise<void> {
	for (let attempt = 0; attempt <= 6; attempt++) {
		const outcome = await writeMarker(page, marker);
		if (outcome.ok) return;
		if (attempt === 6) throw new Error(`could not write the marker: ${outcome.reason}`);
		await page.waitForTimeout(100);
	}
}

/**
 * Tries the same edit once and reports how the editor refused it, so a spec
 * can assert that a viewer's refusal is the editor's own `read-only` code
 * rather than a missing button.
 */
export async function writeRefusal(page: Page, marker: string): Promise<string> {
	return (await writeMarker(page, marker)).reason;
}
