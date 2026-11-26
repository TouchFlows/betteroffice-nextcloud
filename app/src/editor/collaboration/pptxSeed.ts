import { initWasm, openPresentation } from '@betteroffice/pptx';

/**
 * The presentation half of room seeding (PLAN.md §8.2 steps 3-6).
 *
 * `openPresentation` builds the deck's CRDT document from the file bytes and
 * `encodeStateAsUpdate` serialises it -- the same create-if-absent seed every
 * format needs, produced with this format's engine
 * (poc/RECONNAISSANCE.md §3: XLSX uses `openWorkbook({collaborative: true})`,
 * DOCX uses `createYrsSession().seedFromDocx()`, and PPTX this).
 *
 * The wasm engine is initialised first: seeding happens in the host page
 * before the editor mounts, so nothing else has loaded it yet.
 */
export async function generatePptxSeed(bytes: Uint8Array | ArrayBuffer, clientId: number): Promise<Uint8Array> {
	await initWasm();
	const presentation = openPresentation(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { clientId });
	return presentation.encodeStateAsUpdate();
}
