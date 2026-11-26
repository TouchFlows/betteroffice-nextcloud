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

/** Opens the deck with collaboration on and waits until it is connected and synced. */
export async function openPptxEditor(page: Page): Promise<void> {
	await page.goto(PPTX_EDITOR_PATH);
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

/**
 * Appends `marker` to the paragraph containing the deck's title, through the
 * editor's own `applyEdits` -- the edit goes down the collaboration path, not
 * into local state only.
 */
export async function appendToTitle(page: Page, marker: string): Promise<void> {
	const read = await readDeck(page);
	expect(read, 'the presentation editor did not return a readable deck').not.toBeNull();
	const story = read!.stories.find((candidate) => candidate.text.includes(ANCHOR_TEXT));
	expect(story, `the fixture deck has no story containing "${ANCHOR_TEXT}"`).toBeDefined();

	const result = await page.evaluate(
		async ({ anchor, marker, target }) => {
			const api = (window as unknown as { __betteroffice: { pptxApi: PptxApi } }).__betteroffice.pptxApi;
			const current = (await api.readContent()) as PptxRead | null;
			if (!current || current.ok !== true) return { ok: false, reason: 'unreadable' };
			return api.applyEdits({
				expectVersion: current.version,
				steps: [
					{
						op: 'insertText',
						target: { kind: 'search', within: target, text: anchor },
						at: 'end',
						text: marker,
					},
				],
			});
		},
		{
			anchor: ANCHOR_TEXT,
			marker,
			target: { slideId: story!.slideId, shapeId: story!.shapeId, storyId: story!.storyId },
		},
	);
	expect(result.ok, `applyEdits failed: ${JSON.stringify(result)}`).toBe(true);
}
