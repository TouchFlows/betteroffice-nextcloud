import type { CollaborationRole } from './session';

/**
 * The client half of PLAN.md §8.6: who else is in the room, with the display
 * name, avatar and read-only/editing role the Nextcloud app signed into their
 * collaboration token.
 *
 * Deliberately not read from the awareness channel: that payload is written
 * by each browser about itself, so a client could claim any name it liked.
 * The relay stamps identity from the token it verified instead, and this
 * endpoint is where it reports it -- to a caller holding a token for the same
 * room, and nobody else.
 */

export interface PresenceParticipant {
	name: string;
	avatar: string | null;
	role: CollaborationRole;
	/** True for the caller's own entry, so the editor can list only the others. */
	self: boolean;
}

/**
 * The relay serves plain HTTP(S) on the same origin as its WebSocket
 * endpoint, so an admin's `wss://relay.example.com` maps to
 * `https://relay.example.com/room/…/presence`.
 */
export function presenceUrl(relayUrl: string, roomId: string): string {
	const base = relayUrl
		.trim()
		.replace(/\/+$/, '')
		.replace(/^ws(s?):\/\//i, (_match, secure: string) => (secure ? 'https://' : 'http://'));
	if (!/^https?:\/\//i.test(base)) {
		throw new Error(`Unsupported collaboration relay URL: ${relayUrl}`);
	}
	return `${base}/room/${encodeURIComponent(roomId)}/presence`;
}

export async function fetchPresence(
	relayUrl: string,
	roomId: string,
	token: string,
): Promise<PresenceParticipant[]> {
	const response = await fetch(`${presenceUrl(relayUrl, roomId)}?token=${encodeURIComponent(token)}`, {
		// The token is the whole authorisation; no Nextcloud session cookie may
		// be sent to the relay.
		credentials: 'omit',
		headers: { Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(`Presence request failed: ${response.status}`);
	}

	const body = (await response.json()) as { participants?: unknown };
	if (!Array.isArray(body.participants)) {
		throw new Error('Malformed presence response');
	}

	return body.participants.flatMap((entry): PresenceParticipant[] => {
		if (typeof entry !== 'object' || entry === null) return [];
		const { name, avatar, role, self } = entry as Record<string, unknown>;
		if (typeof name !== 'string' || (role !== 'read' && role !== 'write')) return [];
		return [{
			name,
			avatar: typeof avatar === 'string' && avatar !== '' ? avatar : null,
			role,
			self: self === true,
		}];
	});
}
