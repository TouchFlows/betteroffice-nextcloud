import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RelayServerConfig } from './config.js';
import type { RoomRegistry } from './roomRegistry.js';
import { verifyCollaborationToken, TokenVerificationError } from './token.js';

const PRESENCE_PATH = /^\/room\/([^/]+)\/presence$/;

export interface PresenceEntry {
	name: string;
	avatar: string | null;
	role: 'read' | 'write';
	/** Whether this entry is the caller, so the editor can list only the others. */
	self: boolean;
}

/**
 * `GET /room/:roomId/presence` (PLAN.md §8.6): who is in the room, with the
 * display name, avatar and read/write role each participant's *signed*
 * collaboration token carries -- never anything the browser claims about
 * itself, and never a Nextcloud user id.
 *
 * Authorised by the same short-lived token that admits the WebSocket, so the
 * roster is only visible to someone Nextcloud already gave access to that
 * document: presence cannot be used to discover a room or enumerate its
 * participants. A token for a different room is refused, and a room nobody is
 * connected to answers with an empty list rather than an error that would
 * reveal whether it exists.
 *
 * The answer is cross-origin by design (the editor runs on the Nextcloud
 * origin, the relay on its own), so it is readable only from the configured
 * Origin, is never cached, and carries no credentials -- the token is the
 * whole authorisation.
 */
export function handlePresenceRequest(
	registry: RoomRegistry,
	config: RelayServerConfig,
	request: IncomingMessage,
	response: ServerResponse,
): boolean {
	const url = new URL(request.url ?? '', 'http://relay.invalid');
	const match = url.pathname.match(PRESENCE_PATH);
	if (!match) return false;

	const roomId = decodeURIComponent(match[1]);
	void respond(registry, config, request, response, roomId, url.searchParams.get('token'));
	return true;
}

async function respond(
	registry: RoomRegistry,
	config: RelayServerConfig,
	request: IncomingMessage,
	response: ServerResponse,
	roomId: string,
	token: string | null,
): Promise<void> {
	// §13 "Strict Origin validation": a page on any other origin must not be
	// able to read this, so the allow-list is applied before anything else and
	// a request from a foreign origin gets no CORS header at all.
	if (request.headers.origin !== config.allowedOrigin) {
		response.writeHead(403);
		response.end();
		return;
	}

	// A refusal *to* the allowed origin is readable by it on purpose: the
	// editor has to tell "this token is dead, resolve a new session" (401/403)
	// apart from a network failure. Without the header the browser turns the
	// status into an opaque CORS error, and the client cannot react to it.
	const refuse = (status: number): void => {
		response.writeHead(status, {
			'cache-control': 'no-store',
			'access-control-allow-origin': config.allowedOrigin,
		});
		response.end();
	};

	if (!token) {
		refuse(401);
		return;
	}

	let userId: string;
	try {
		const claims = verifyCollaborationToken(token, config.sharedSecret);
		if (claims.roomId !== roomId) {
			refuse(403);
			return;
		}
		userId = claims.sub;
	} catch (error) {
		const reason = error instanceof TokenVerificationError ? error.reason : 'malformed';
		console.warn(`[relay] room ${roomId}: presence request rejected (token ${reason})`);
		refuse(401);
		return;
	}

	const room = await registry.peek(roomId);
	const seen = new Set<string>();
	const participants: PresenceEntry[] = [];
	for (const participant of room?.connectedParticipants ?? []) {
		// One person with the editor open twice is one collaborator, not two.
		const key = `${participant.userId}|${participant.role}`;
		if (seen.has(key)) continue;
		seen.add(key);
		participants.push({
			name: participant.name,
			avatar: participant.avatar,
			role: participant.role,
			self: participant.userId === userId,
		});
	}
	participants.sort((a, b) => a.name.localeCompare(b.name));

	response.writeHead(200, {
		'content-type': 'application/json',
		'cache-control': 'no-store',
		'access-control-allow-origin': config.allowedOrigin,
	});
	response.end(JSON.stringify({ participants }));
}
