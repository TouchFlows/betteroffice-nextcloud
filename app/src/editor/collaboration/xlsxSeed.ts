import { initWasm, openWorkbook } from '@betteroffice/xlsx';

/**
 * The spreadsheet half of room seeding (PLAN.md §8.2 steps 3-6).
 *
 * `openWorkbook` with `collaborative: true` builds the workbook's CRDT
 * document from the file bytes and `encodeStateAsUpdate` serialises it -- the
 * same create-if-absent seed every format needs, produced with this format's
 * engine (poc/RECONNAISSANCE.md §3: XLSX uses `openWorkbook({collaborative:
 * true, clientId})`, DOCX uses `createYrsSession().seedFromDocx()`, PPTX uses
 * `openPresentation()`).
 *
 * `collaborative: true` is not optional here: without it the handle is a plain
 * document with no replica, and `encodeStateAsUpdate` has no state to encode.
 *
 * The handle is disposed once the update is taken. It was opened only to
 * produce the seed; the editor opens its own, and leaving this one alive would
 * keep a second wasm workbook (and its client id) in memory for the page's
 * lifetime.
 */
export async function generateXlsxSeed(bytes: Uint8Array | ArrayBuffer, clientId: number): Promise<Uint8Array> {
	await initWasm();
	const workbook = openWorkbook(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {
		collaborative: true,
		clientId,
	});
	try {
		return workbook.encodeStateAsUpdate();
	} finally {
		workbook.dispose();
	}
}
