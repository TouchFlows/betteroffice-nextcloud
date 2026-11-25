import axios from '@nextcloud/axios';
import { generateUrl } from '@nextcloud/router';
import { createYrsSession } from '@betteroffice/docx/yrs';

/**
 * The client half of PLAN.md §8.2 (room initialisation) and §8.5 (token):
 * ask the Nextcloud app for this file's room, token and role; adopt the
 * authoritative seed, generating and offering one only if the room has none
 * yet; and build the relay WebSocket URL.
 *
 * The server is the authority for all three: it computes the opaque room id,
 * signs the token, and decides which seed wins (`RoomService`). This module
 * never derives a room id or a permission from anything browser-supplied.
 */

export type CollaborationRole = 'read' | 'write';

export interface CollaborationSession {
	roomId: string;
	token: string;
	role: CollaborationRole;
	/** The authoritative room seed, or null when no client has created one yet. */
	seed: Uint8Array | null;
}

interface SessionResponse {
	roomId?: unknown;
	token?: unknown;
	role?: unknown;
	seed?: unknown;
}

export function collaborationSessionUrl(fileId: number): string {
	return generateUrl('/apps/betteroffice/collab/session/{fileId}', { fileId });
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function assertSeed(value: unknown, what: string): Uint8Array {
	if (typeof value !== 'string' || value === '') {
		throw new Error(`Malformed collaboration response: no ${what}`);
	}
	return decodeBase64(value);
}

export async function requestCollaborationSession(fileId: number): Promise<CollaborationSession> {
	const { data } = await axios.post<SessionResponse>(collaborationSessionUrl(fileId));
	if (
		typeof data?.roomId !== 'string'
		|| typeof data?.token !== 'string'
		|| (data.role !== 'read' && data.role !== 'write')
	) {
		throw new Error('Malformed collaboration session response');
	}

	return {
		roomId: data.roomId,
		token: data.token,
		role: data.role,
		seed: typeof data.seed === 'string' && data.seed !== '' ? decodeBase64(data.seed) : null,
	};
}

/**
 * §8.2 steps 3-6: the seed is created once per room, never independently per
 * client. Seeding the same source bytes under different client ids produces
 * *different* CRDT state (poc/RECONNAISSANCE.md §3), so a client that
 * generated its own seed for an already-seeded room would diverge forever.
 *
 * `PUT .../seed` is create-if-absent: it returns the caller's own bytes when
 * this client won the race, or the winner's bytes when it lost. Either way the
 * response is authoritative and is what this client opens the editor with.
 */
export async function resolveInitialUpdate(
	fileId: number,
	session: CollaborationSession,
	documentBuffer: ArrayBuffer,
	clientId: number,
): Promise<Uint8Array> {
	if (session.seed) return session.seed;

	const years = await createYrsSession({ clientId });
	years.seedFromDocx(new Uint8Array(documentBuffer), { generation: session.roomId });
	const offered = years.encodeState();

	const { data } = await axios.put<{ seed?: unknown }>(
		`${collaborationSessionUrl(fileId)}/seed`,
		offered,
		{ headers: { 'Content-Type': 'application/octet-stream' } },
	);

	return assertSeed(data?.seed, 'seed');
}

/**
 * The relay's WebSocket endpoint for one room, carrying the short-lived token
 * as a query parameter (§8.5 -- never a long-lived credential).
 *
 * Admins naturally configure `https://relay.example.com`; the browser needs
 * `wss://`. Both forms are accepted, plus an explicit ws(s):// value for
 * local development.
 */
export function relaySocketUrl(relayUrl: string, roomId: string, token: string): string {
	const base = relayUrl.trim().replace(/\/+$/, '');
	const wsBase = base.replace(/^http(s?):\/\//i, (_match, secure: string) => (secure ? 'wss://' : 'ws://'));
	if (!/^wss?:\/\//i.test(wsBase)) {
		throw new Error(`Unsupported collaboration relay URL: ${relayUrl}`);
	}
	return `${wsBase}/room/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`;
}
