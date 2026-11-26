import { expect, type Page } from '@playwright/test';
import { TEST_RELAY_URL } from './testRelay';

/**
 * Drives the real spreadsheet editor the way `editorDriver.ts` and
 * `pptxDriver.ts` drive the other two: through the editor's own API, because
 * the grid is painted to canvas and there is no DOM text to read or click.
 *
 * The API is exposed by the harness (`harness/main.tsx` passes `onReady` into
 * the same `EditorRoute` production uses), and `findText`/`applyEdits` are the
 * editor's own read and edit paths -- an edit made here goes through the
 * collaboration replica, not into local state only.
 */

export const XLSX_EDITOR_PATH = `/?fileId=2&fileName=showcase.xlsx&format=xlsx&relayUrl=${encodeURIComponent(TEST_RELAY_URL)}`;

/** The fixture workbook's own title cell, so an edit lands in a cell that exists. */
const ANCHOR_TEXT = 'Q3 Sales Dashboard';

interface XlsxCellAddress {
	sheetId: string;
	row: number;
	col: number;
	a1: string;
}

interface XlsxFindResult {
	ok?: boolean;
	version?: string;
	matches?: { cell: XlsxCellAddress; text: string }[];
}

interface XlsxEditResult {
	ok?: boolean;
	failure?: { code?: string; message?: string };
}

interface XlsxApi {
	findText: (request: { text: string; limit?: number }) => Promise<XlsxFindResult>;
	applyEdits: (request: unknown) => Promise<XlsxEditResult>;
}

function apiIn(page: Page): Promise<boolean> {
	return page.evaluate(() => (window as unknown as { __betteroffice?: { xlsxApi?: XlsxApi } }).__betteroffice?.xlsxApi !== undefined);
}

/**
 * Opens the workbook with collaboration on and waits until it is connected and
 * synced. `readOnly` mirrors what the page passes for a file the viewer may
 * not update, so the same app path is exercised for viewers and writers.
 */
export async function openXlsxEditor(page: Page, { readOnly = false } = {}): Promise<void> {
	await page.goto(`${XLSX_EDITOR_PATH}${readOnly ? '&readOnly=1' : ''}`);
	await expect(page.getByRole('application', { name: 'Spreadsheet editor' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('grid', { name: 'Spreadsheet grid' })).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('[data-collaboration-synced="1"]')).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => apiIn(page), { timeout: 30_000 }).toBe(true);
}

/**
 * Whether the workbook's own model contains `text` -- what a peer edit has to
 * change.
 *
 * A read can lose a race with an update arriving from the relay (the edit is
 * being applied while the read runs), so a failure is reported as "not yet"
 * and the caller's poll retries, rather than failing the test.
 */
export async function workbookHasText(page: Page, text: string): Promise<boolean> {
	try {
		return await page.evaluate(async (needle) => {
			const api = (window as unknown as { __betteroffice?: { xlsxApi?: XlsxApi } }).__betteroffice?.xlsxApi;
			if (!api) return false;
			const result = await api.findText({ text: needle, limit: 5 });
			return result?.ok === true && (result.matches?.length ?? 0) > 0;
		}, text);
	} catch {
		return false;
	}
}

interface WriteOutcome {
	ok: boolean;
	/** Why the write did not land: an edit refusal code, or a local failure. */
	reason: string;
}

/**
 * One attempt to append `marker` to the cell holding the workbook's title,
 * through the editor's own `applyEdits`. Reads the cell first because the edit
 * needs its address and its current text, and the version it was read at.
 */
async function writeMarker(page: Page, marker: string): Promise<WriteOutcome> {
	try {
		return await page.evaluate(
			async ({ anchor, marker }) => {
				const api = (window as unknown as { __betteroffice?: { xlsxApi?: XlsxApi } }).__betteroffice?.xlsxApi;
				if (!api) return { ok: false, reason: 'no api' };
				const found = await api.findText({ text: anchor, limit: 5 });
				const match = found?.ok === true ? found.matches?.[0] : undefined;
				if (!match || found?.version === undefined) return { ok: false, reason: 'no anchor cell' };
				const result = await api.applyEdits({
					expectVersion: found.version,
					steps: [
						{
							op: 'setCellInputs',
							target: { sheetId: match.cell.sheetId, range: { kind: 'a1', a1: match.cell.a1 } },
							inputs: [[`${match.text} ${marker}`]],
						},
					],
				});
				if (result?.ok === true) return { ok: true, reason: 'applied' };
				return { ok: false, reason: result?.failure?.code ?? JSON.stringify(result) };
			},
			{ anchor: ANCHOR_TEXT, marker },
		);
	} catch (error) {
		// An update landing mid-request can reject the call itself; the caller
		// retries, which is cheaper than duplicating the retry loop here.
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Appends `marker` to the cell holding the workbook's title, through the
 * editor's own `applyEdits`.
 *
 * `applyEdits` refuses with `stale-version` when the workbook changed between
 * the read and the write -- which is exactly what a peer's update does -- so
 * the read and the edit are retried together rather than failing the run.
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
