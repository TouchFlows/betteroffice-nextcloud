import { createYrsSession } from '@betteroffice/docx/yrs';

/**
 * The DOCX half of room seeding (PLAN.md §8.2 steps 3-6), kept beside the
 * format-neutral seed handshake rather than inside it: seeding a room means
 * constructing that format's CRDT document from the file bytes, and every
 * format does it with its own engine (poc/RECONNAISSANCE.md §3).
 *
 * `generation` tags the seeded state with the room, which is what keeps two
 * different rooms' seeds distinguishable even when both start from identical
 * bytes.
 */
export async function generateDocxSeed(
	bytes: ArrayBuffer,
	clientId: number,
	roomId: string,
): Promise<Uint8Array> {
	const session = await createYrsSession({ clientId });
	session.seedFromDocx(new Uint8Array(bytes), { generation: roomId });
	return session.encodeState();
}
