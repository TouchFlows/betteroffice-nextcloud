import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Pool } from 'mariadb';
import type { RelayServerConfig } from './config.js';
import { RoomRegistry } from './roomRegistry.js';
import type { Room } from './room.js';
import { verifyCollaborationToken, TokenVerificationError } from './token.js';

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * Wires the collaboration WebSocket endpoint (`/room/:roomId`) into an
 * existing HTTP server: Origin allow-list and token verification (§8.5,
 * §13) on the upgrade request, then hands the socket to its `Room` (§8).
 * The room-seed endpoint lives on the Nextcloud app, not here (per
 * `poc/app/roomSeed.ts`'s own note) -- this relay only ever sees an opaque
 * room id and an already-seeded `Room`.
 */
export function attachCollaborationServer(httpServer: Server, config: RelayServerConfig, pool: Pool): WebSocketServer {
	const registry = new RoomRegistry(pool);
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

		let role: 'read' | 'write';
		try {
			const claims = verifyCollaborationToken(token, config.sharedSecret);
			if (claims.roomId !== roomId) {
				socket.destroy();
				return;
			}
			role = claims.role;
		} catch (error) {
			const reason = error instanceof TokenVerificationError ? error.reason : 'malformed';
			console.warn(`[relay] room ${roomId}: rejected connection (token ${reason})`);
			socket.destroy();
			return;
		}

		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, roomId, role);
		});
	});

	function rejectFrame(socket: WebSocket, roomId: string, role: 'read' | 'write', data: Buffer): false | undefined {
		if (data.byteLength > MAX_FRAME_BYTES) {
			socket.close(1009, `Frame exceeds ${MAX_FRAME_BYTES} bytes`);
			return false;
		}
		// §8.5/§13: a read-only token must never be allowed to submit an
		// editing update. Awareness (presence) traffic is not an edit, so
		// read-only participants may still broadcast cursor/selection state
		// -- only sync-protocol frames (message type 0) are gated.
		if (role === 'read' && data.byteLength > 0 && data[0] === 0) {
			socket.close(1008, 'Read-only token cannot submit edits');
			return false;
		}
		return undefined;
	}

	wss.on('connection', (socket: WebSocket, roomId: string, role: 'read' | 'write') => {
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
			if (rejectFrame(socket, roomId, role, data) === false) return;
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
			resolved.join(socket);
			room = resolved;
			for (const { data, isBinary } of pending) processOne(data, isBinary);
		})();
	});

	return wss;
}
