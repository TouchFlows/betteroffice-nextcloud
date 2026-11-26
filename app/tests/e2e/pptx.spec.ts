import { expect } from '@playwright/test';
import { test } from './fixtures';

/**
 * Proof that the presentation format is actually supported, not merely
 * accepted by the server: the real `PptxEditor` opens the PoC's
 * `betteroffice-demo.pptx` through the app's own format dispatch, and a save
 * reaches the document API as a real OOXML container.
 *
 * Unlike the DOCX and XLSX editors, this one paints slides to canvas and
 * exposes no DOM text at all, so "the deck's own text renders" cannot be
 * asserted from the accessibility tree. The strongest available check is the
 * editor's own document model: `findText` for the title of slide 1, which a
 * deck that failed to parse would not contain. The save is still asserted
 * against the mock's stored bytes rather than the editor's label.
 */

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface PptxApiProbe {
	findText: (request: { text: string; limit?: number }) => Promise<{
		ok?: boolean;
		matches?: { text: string }[];
	}>;
}

test('pptx: the presentation editor opens a real deck and saves it through the document API', async ({ page, request, room }) => {
	await page.goto('/?fileId=3&fileName=betteroffice-demo.pptx&format=pptx');

	const editor = page.getByRole('application', { name: 'Presentation slide editor' });
	await expect(editor).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('toolbar', { name: 'Presentation formatting toolbar' })).toBeVisible();
	// The slide surface itself: an editor that mounted but never drew a deck
	// has nothing to show here.
	await expect(page.locator('canvas').first()).toBeVisible();

	const titleMatches = await page.evaluate(async () => {
		const holder = window as unknown as { __betteroffice?: { pptxApi?: PptxApiProbe } };
		const api = holder.__betteroffice?.pptxApi;
		if (!api) {
			return null;
		}
		const result = await api.findText({ text: 'BETTEROFFICE', limit: 5 });
		return result.ok === true ? (result.matches ?? []).map((match) => match.text) : null;
	});
	expect(titleMatches).not.toBeNull();
	expect((titleMatches ?? []).join(' ')).toContain('BETTEROFFICE');

	const stateFor = async () =>
		(await request.get(`/__test__/document-state?room=${room}&fileId=3`)).json() as Promise<{
			mime: string;
			bytes: number;
			saved: boolean;
			signature: string;
		}>;

	const before = await stateFor();
	expect(before.mime).toBe(PPTX_MIME);
	expect(before.signature).toBe('PK\u0003\u0004');
	expect(before.saved).toBe(false);

	// The editor owns the save gesture (its own File ▸ Save); the host only
	// supplies `onSave`, which posts the serialised bytes back.
	await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save' }).click();

	await expect(page.locator('.betteroffice-save-status--saved')).toBeVisible({ timeout: 20_000 });
	await expect(page.locator('.betteroffice-save-status--error, .betteroffice-save-status--conflict')).toHaveCount(0);

	const after = await stateFor();
	expect(after.saved).toBe(true);
	expect(after.mime).toBe(PPTX_MIME);
	expect(after.signature).toBe('PK\u0003\u0004');
	// A serialised deck, not a truncated write of the fixture header.
	expect(after.bytes).toBeGreaterThan(5_000);
});

/** The ETag refusal: `--conflict`, not `--error`, and no overwrite. */
test('pptx: a stale ETag surfaces the conflict message instead of overwriting', async ({ page, request, room }) => {
	await page.goto('/?fileId=3&fileName=betteroffice-demo.pptx&format=pptx');
	const editor = page.getByRole('application', { name: 'Presentation slide editor' });
	await expect(editor).toBeVisible({ timeout: 30_000 });

	await request.post(`/__test__/force-conflict?room=${room}&fileId=3`);
	await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save' }).click();

	await expect(page.locator('.betteroffice-save-status--conflict')).toBeVisible({ timeout: 20_000 });
	await expect(page.locator('.betteroffice-save-status--saved')).toHaveCount(0);

	const state = (await (await request.get(`/__test__/document-state?room=${room}&fileId=3`)).json()) as { saved: boolean };
	expect(state.saved).toBe(false);
});

/** `readOnly` must reach the editor, which then offers no save at all. */
test('pptx: a read-only editor offers no save and never writes', async ({ page, request, room }) => {
	await page.goto('/?fileId=3&fileName=betteroffice-demo.pptx&format=pptx&readOnly=1');
	await expect(page.getByRole('application', { name: 'Presentation slide editor' })).toBeVisible({ timeout: 30_000 });

	await expect(page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save' })).toHaveCount(0);

	await page.keyboard.press('ControlOrMeta+s');
	await page.waitForTimeout(1_500);
	await expect(page.locator('.betteroffice-save-status--saved')).toHaveCount(0);

	const state = (await (await request.get(`/__test__/document-state?room=${room}&fileId=3`)).json()) as { saved: boolean };
	expect(state.saved).toBe(false);
});
