import { expect } from '@playwright/test';
import { test } from './fixtures';

/**
 * Proof that the spreadsheet format is actually supported, not merely
 * accepted by the server: the real `XlsxEditor` opens the PoC's
 * `showcase.xlsx` through the app's own format dispatch, and a save reaches
 * the document API as a real OOXML container.
 *
 * The assertions on the editor's own roles and on the sheet's title exist
 * because an editor that fails to parse the bytes still mounts an empty
 * shell; only the fixture's text proves the workbook was parsed. The save is
 * asserted against the mock's stored state, not the editor's label, so a save
 * that silently writes nothing cannot pass.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('xlsx: the spreadsheet editor opens a real workbook and saves it through the document API', async ({ page, request, room }) => {
	await page.goto('/?fileId=2&fileName=showcase.xlsx&format=xlsx');

	const editor = page.getByRole('application', { name: 'Spreadsheet editor' });
	await expect(editor).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('grid', { name: 'Spreadsheet grid' })).toBeVisible();
	// Text that exists only inside the fixture's sheet.
	await expect(editor).toContainText('Q3 Sales Dashboard');

	const stateFor = async () =>
		(await request.get(`/__test__/document-state?room=${room}&fileId=2`)).json() as Promise<{
			mime: string;
			bytes: number;
			saved: boolean;
			signature: string;
		}>;

	const before = await stateFor();
	expect(before.mime).toBe(XLSX_MIME);
	expect(before.signature).toBe('PK\u0003\u0004');
	expect(before.saved).toBe(false);

	// The editor owns the save gesture; the host only supplies `onSave`. This
	// is the same shortcut the DOCX spec uses.
	await editor.click();
	await page.keyboard.press('ControlOrMeta+s');

	await expect(page.locator('.betteroffice-save-status--saved')).toBeVisible({ timeout: 20_000 });
	await expect(page.locator('.betteroffice-save-status--error, .betteroffice-save-status--conflict')).toHaveCount(0);

	const after = await stateFor();
	expect(after.saved).toBe(true);
	expect(after.mime).toBe(XLSX_MIME);
	expect(after.signature).toBe('PK\u0003\u0004');
	// A serialised workbook, not a truncated write of the fixture header.
	expect(after.bytes).toBeGreaterThan(5_000);
});

/**
 * The ETag refusal, which is the branch `SaveStatusLine` renders as
 * `--conflict` rather than `--error`: a save whose `If-Match` no longer
 * matches must say "reload", not "broken", and must not overwrite.
 */
test('xlsx: a stale ETag surfaces the conflict message instead of overwriting', async ({ page, request, room }) => {
	await page.goto('/?fileId=2&fileName=showcase.xlsx&format=xlsx');
	const editor = page.getByRole('application', { name: 'Spreadsheet editor' });
	await expect(editor).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('grid', { name: 'Spreadsheet grid' })).toBeVisible();

	// Someone else writes the file between this load and its save.
	await request.post(`/__test__/force-conflict?room=${room}&fileId=2`);
	// The canvas sits over the grid, so focus the editor's own container
	// rather than the grid element (same click target as the save test above).
	await editor.click();
	await page.keyboard.press('ControlOrMeta+s');

	await expect(page.locator('.betteroffice-save-status--conflict')).toBeVisible({ timeout: 20_000 });
	await expect(page.locator('.betteroffice-save-status--saved')).toHaveCount(0);

	const state = (await (await request.get(`/__test__/document-state?room=${room}&fileId=2`)).json()) as { saved: boolean };
	expect(state.saved).toBe(false);
});

/**
 * `readOnly` has to reach the editor, not just the host: the server already
 * reports `readOnly` for a file the user may not update, and an editor that
 * ignores it would offer a save whose write the API then refuses.
 */
test('xlsx: a read-only editor offers no save and never writes', async ({ page, request, room }) => {
	await page.goto('/?fileId=2&fileName=showcase.xlsx&format=xlsx&readOnly=1');
	await expect(page.getByRole('grid', { name: 'Spreadsheet grid' })).toBeVisible({ timeout: 30_000 });

	// The editor drops its own save affordance when read-only is set.
	await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(0);

	// And a save gesture anyway must not reach the document API.
	await page.keyboard.press('ControlOrMeta+s');
	await page.waitForTimeout(1_500);
	await expect(page.locator('.betteroffice-save-status--saved')).toHaveCount(0);

	const state = (await (await request.get(`/__test__/document-state?room=${room}&fileId=2`)).json()) as { saved: boolean };
	expect(state.saved).toBe(false);
});
