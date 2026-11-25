import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Pool } from 'mariadb';
import type { RelayServerConfig } from './config.js';
import { RoomRegistry } from './roomRegistry.js';
import type { Room, RoomParticipant } from './room.js';
import { verifyCollaborationToken, TokenVerificationError } from './token.js';

const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MESSAGE_SYNC = 0;
/** `y-protocols/sync` subtype of an Update frame: carries an edit. */
const SYNC_SUBTYPE_UPDATE = 2;
/** `y-protocols/sync` subtype of the answer to a SyncStep1: also carries state. */
const SYNC_SUBTYPE_SYNC_STEP_2 = 1;

/**
 * Wires the collaboration WebSocket endpoint (`/room/:roomId`) into an
 * existing HTTP server: Origin allow-list and token verification (§8.5,
 * §13) on the upgrade request, then hands the socket to its `Room` (§8).
 * The room-seed endpoint lives on the Nextcloud app, not here (per
 * `poc/app/roomSeed.ts`'s own note) -- this relay only ever sees an opaque
 * room id and an already-seeded `Room`.
 */
export function attachCollaborationServer(
	httpServer: Server,
	config: RelayServerConfig,
	pool: Pool,
	// Injectable so the presence endpoint can share the same live rooms
	// (`presence.ts`); production wiring passes one registry for both.
	registry: RoomRegistry = new RoomRegistry(pool),
): WebSocketServer {
	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (request, socket, head) => {
		if (request.headers.origin !== config.allowedOrigin) {
			socket.destroy();
			return;
		}

		const url = new URL(request.url ?? '', 'http://relay.invalid');
		const match = url.pathname.match(/^\/room\/([^/]+)$/);
		if (!match) {
			socket.destroy();
			return;
		}
		const roomId = decodeURIComponent(match[1]);
		const token = url.searchParams.get('token');
		if (!token) {
			socket.destroy();
			return;
		}

		let participant: RoomParticipant;
		try {
			const claims = verifyCollaborationToken(token, config.sharedSecret);
			if (claims.roomId !== roomId) {
				socket.destroy();
				return;
			}
			// §8.6: presence identity comes from the signed token, never from
			// anything the browser sends, so a client cannot appear to be
			// someone else in the room. `sub` is only a fallback for a token
			// issued before presence shipped; those expire within five minutes.
			participant = {
				userId: claims.sub,
				name: claims.name ?? claims.sub,
				avatar: claims.avatar ?? null,
				role: claims.role,
			};
		} catch (error) {
			const reason = error instanceof TokenVerificationError ? error.reason : 'malformed';
			console.warn(`[relay] room ${roomId}: rejected connection (token ${reason})`);
			socket.destroy();
			return;
		}

		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, roomId, participant);
		});
	});

	function rejectFrame(socket: WebSocket, roomId: string, role: 'read' | 'write', data: Buffer): false | undefined {
		if (data.byteLength > MAX_FRAME_BYTES) {
			socket.close(1009, `Frame exceeds ${MAX_FRAME_BYTES} bytes`);
			return false;
		}
		// §8.5/§13: a read-only token must never be allowed to submit an
		// editing update. Two client frames carry state: an *Update*, and a
		// *SyncStep2* -- the answer to the SyncStep1 the room sends every new
		// peer. The Update is an outright violation, so it closes the
		// connection. The SyncStep2 is dropped instead of closing, because the
		// peer only sends it when the room asks: closing would disconnect every
		// read-only participant at join, and letting it through would let a
		// participant whose edit was just rejected push that edit in by
		// reconnecting (the handshake re-sends its local state). SyncStep1 and
		// awareness (presence) traffic stay allowed, so a read-only participant
		// still receives the document and broadcasts cursor/selection state.
		// Both leading bytes are single-byte varints (the values are well
		// under 128), so reading them positionally is exact.
		if (role === 'read' && data.byteLength >= 2 && data[0] === MESSAGE_SYNC) {
			if (data[1] === SYNC_SUBTYPE_UPDATE) {
				socket.close(1008, 'Read-only token cannot submit edits');
				return false;
			}
			if (data[1] === SYNC_SUBTYPE_SYNC_STEP_2) return false;
		}
		return undefined;
	}

	wss.on('connection', (socket: WebSocket, roomId: string, participant: RoomParticipant) => {
		// `ws` delivers 'message' synchronously as data arrives; a client that
		// sends its first frame immediately on open can beat an async setup
		// step here, and an emitted event with no listener yet is simply
		// lost. So every listener is attached synchronously, in this same
		// tick, and messages that arrive before the room has resolved (an
		// async DB round trip) are queued instead of dropped.
		const pending: Array<{ data: Buffer; isBinary: boolean }> = [];
		let room: Room | undefined;
		let closed = false;

		const processOne = (data: Buffer, isBinary: boolean): void => {
			if (!isBinary) {
				socket.close(1003, 'Binary frames only');
				return;
			}
			if (rejectFrame(socket, roomId, participant.role, data) === false) return;
			try {
				room!.receive(socket, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
			} catch (error) {
				console.error(`[relay] room ${roomId}: malformed frame`, error);
				socket.close(1002, 'Malformed collaboration frame');
			}
		};

		socket.on('message', (data: Buffer, isBinary: boolean) => {
			if (!room) {
				pending.push({ data, isBinary });
				return;
			}
			processOne(data, isBinary);
		});

		const leave = (): void => {
			closed = true;
			if (!room) return; // never finished joining -- nothing to leave
			room.leave(socket);
			if (room.isEmpty || room.isFailed) {
				registry.evict(roomId);
				room.destroy();
			}
		};
		socket.on('close', leave);
		socket.on('error', leave);

		void (async () => {
			let resolved: Room;
			try {
				resolved = await registry.get(roomId);
			} catch (error) {
				console.error(`[relay] room ${roomId}: failed to initialise`, error);
				if (!closed) socket.close(1011, 'Room initialisation failed');
				return;
			}
			if (closed) {
				// The client disconnected before the room finished its async
				// (DB-backed) initialisation, so it was never joined. The room
				// itself still exists in the registry now, though -- if nothing
				// else is using it, it must be evicted and destroyed here, or
				// its registry entry and its Awareness timer leak forever
				// (nothing else will ever call `leave()` for this socket).
				if (resolved.isEmpty || resolved.isFailed) {
					registry.evict(roomId);
					resolved.destroy();
				}
				return;
			}
			resolved.join(socket, participant);
			room = resolved;
			for (const { data, isBinary } of pending) processOne(data, isBinary);
		})();
	});

	return wss;
}
