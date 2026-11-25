import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import mariadb from 'mariadb';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync.js';
import { loadConfig, type RelayServerConfig } from '../src/config.js';
import { attachCollaborationServer } from '../src/wsServer.js';
import type { CollaborationTokenClaims } from '../src/token.js';

const ALLOWED_ORIGIN = 'https://cloud.example.test';
const SHARED_SECRET = 'wsserver-test-secret';

const pool = mariadb.createPool(loadConfig().database);
const config: RelayServerConfig = { ...loadConfig(), sharedSecret: SHARED_SECRET, allowedOrigin: ALLOWED_ORIGIN };

function base64Url(buffer: Buffer): string {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(claims: Partial<CollaborationTokenClaims> & Pick<CollaborationTokenClaims, 'roomId' | 'role'>): string {
	const full: CollaborationTokenClaims = {
		iid: 'instance-1',
		sub: 'alice',
		fid: 1,
		format: 'docx',
		exp: Math.floor(Date.now() / 1000) + 300,
		jti: randomUUID(),
		...claims,
	};
	const header = base64Url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const payload = base64Url(Buffer.from(JSON.stringify(full)));
	const signature = base64Url(createHmac('sha256', SHARED_SECRET).update(`${header}.${payload}`).digest());
	return `${header}.${payload}.${signature}`;
}

async function withServer(run: (port: number) => Promise<void>): Promise<void> {
	const server: Server = createServer();
	attachCollaborationServer(server, config, pool);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('expected a TCP address');
	try {
		await run(address.port);
	} finally {
		// A test that fails mid-way can leave a socket open, and `close()` waits
		// for every connection to end -- so drop them first instead of hanging.
		server.closeAllConnections?.();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

function waitForClose(socket: WebSocket): Promise<{ code: number }> {
	return new Promise((resolve) => socket.on('close', (code) => resolve({ code })));
}

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.on('open', () => resolve());
		socket.on('close', (code, reason) => reject(new Error(`closed before opening: ${code} ${reason}`)));
		// A destroyed pre-handshake socket (origin/token rejection) surfaces
		// as an 'error', not a 'close' -- and an EventEmitter throws if an
		// 'error' event has no listener at all, so this must handle it even
		// though these tests only care that the connection never opened.
		socket.on('error', (error) => reject(error));
	});
}

test('a connection from an unexpected Origin is destroyed without a WebSocket handshake', async () => {
	await withServer(async (port) => {
		const roomId = `room-${randomUUID()}`;
		const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=irrelevant`, {
			origin: 'https://evil.example',
		});
		await assert.rejects(waitForOpen(socket));
		socket.terminate();
	});
});

test('a connection with no token is rejected', async () => {
	await withServer(async (port) => {
		const roomId = `room-${randomUUID()}`;
		const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}`, {
			origin: ALLOWED_ORIGIN,
		});
		await assert.rejects(waitForOpen(socket));
		socket.terminate();
	});
});

test('a connection with a token for a different room is rejected', async () => {
	await withServer(async (port) => {
		const roomId = `room-${randomUUID()}`;
		const mismatchedToken = token({ roomId: `other-${randomUUID()}`, role: 'write' });
		const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=${mismatchedToken}`, {
			origin: ALLOWED_ORIGIN,
		});
		await assert.rejects(waitForOpen(socket));
		socket.terminate();
	});
});

test('a connection with a validly signed token for the right room is accepted', async () => {
	await withServer(async (port) => {
		const roomId = `room-${randomUUID()}`;
		const validToken = token({ roomId, role: 'write' });
		const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=${validToken}`, {
			origin: ALLOWED_ORIGIN,
		});
		await waitForOpen(socket);
		socket.close();
		await waitForClose(socket);
		socket.terminate();
	});
});

test('a read-only token may connect but has its sync (edit) frames rejected', async () => {
	await withServer(async (port) => {
		const roomId = `room-${randomUUID()}`;
		const readToken = token({ roomId, role: 'read' });
		const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=${readToken}`, {
			origin: ALLOWED_ORIGIN,
		});
		await waitForOpen(socket);

		const closed = waitForClose(socket);
		// Message type 0 (sync), subtype 2 (Update) is an edit attempt; both
		// leading bytes are single-byte varints.
		socket.send(new Uint8Array([0, 2, 1, 2]));
		const { code } = await closed;
		assert.equal(code, 1008);
		socket.terminate();
	});
});

test('a read-only token may complete the sync handshake so it can receive the document', async () => {
	await withServer(async (port) => {
		const roomId = `room-${randomUUID()}`;
		const readToken = token({ roomId, role: 'read' });
		const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=${readToken}`, {
			origin: ALLOWED_ORIGIN,
		});
		await waitForOpen(socket);

		// Message type 0 (sync), subtype 0 (SyncStep1), then a length-1
		// state vector holding a single varint 0 ("no clients") -- exactly
		// what a read-only client sends on open. Gating every
		// message-type-0 frame would close this connection before it could
		// ever receive the document, so this must stay open.
		socket.send(new Uint8Array([0, 0, 1, 0]));
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.equal(socket.readyState, WebSocket.OPEN);

		socket.close();
		await waitForClose(socket);
		socket.terminate();
	});
});

/** The frame a client answers the room's SyncStep1 with: its whole state. */
function syncStep2Frame(doc: Y.Doc): Uint8Array {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, 0);
	syncProtocol.writeSyncStep2(encoder, doc);
	return encoding.toUint8Array(encoder);
}

function docWithText(text: string): Y.Doc {
	const doc = new Y.Doc();
	doc.getText('body').insert(0, text);
	return doc;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connects and records every frame from the moment the socket exists, so the
 * room's own join frames cannot arrive before the recording starts.
 */
async function openRoomSocket(
	port: number,
	roomId: string,
	role: 'read' | 'write',
): Promise<{ socket: WebSocket; received: Buffer[] }> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=${token({ roomId, role })}`, {
		origin: ALLOWED_ORIGIN,
	});
	const received: Buffer[] = [];
	socket.on('message', (data: Buffer) => received.push(Buffer.from(data)));
	await waitForOpen(socket);
	return { socket, received };
}

test("a read-only token's SyncStep2 answer is dropped instead of merged into the room", async () => {
	const marker = 'READONLY-MARKER';
	const opened: WebSocket[] = [];
	try {
		await withServer(async (port) => {
			// Control: from a write peer the very same frame does reach the room,
			// so the assertion below fails if the frame is not actually dropped.
			const controlRoom = `room-${randomUUID()}`;
			const writer = await openRoomSocket(port, controlRoom, 'write');
			opened.push(writer.socket);
			writer.socket.send(syncStep2Frame(docWithText(marker)));
			await sleep(100);
			const observer = await openRoomSocket(port, controlRoom, 'write');
			opened.push(observer.socket);
			await sleep(400);
			assert.ok(
				Buffer.concat(observer.received).includes(marker),
				"a write peer's SyncStep2 must reach the room (control)",
			);

			// A read peer answers the room's own SyncStep1 the moment it joins, so
			// that answer must be dropped rather than close the connection -- but
			// it must not reach the room either, or a participant whose edit was
			// just rejected could push it in by reconnecting.
			const roomId = `room-${randomUUID()}`;
			const reader = await openRoomSocket(port, roomId, 'read');
			opened.push(reader.socket);
			reader.socket.send(syncStep2Frame(docWithText(marker)));
			await sleep(200);
			assert.equal(reader.socket.readyState, WebSocket.OPEN);
			const peer = await openRoomSocket(port, roomId, 'write');
			opened.push(peer.socket);
			await sleep(400);
			assert.ok(!Buffer.concat(peer.received).includes(marker));

			// Closed before the server does, so its `close()` has nothing to wait
			// for even when an assertion above throws.
			for (const socket of opened) socket.terminate();
		});
	} finally {
		for (const socket of opened) socket.terminate();
	}
});

test('a text frame is rejected -- binary only', async () => {
	await withServer(async (port) => {
		const roomId = `room-${randomUUID()}`;
		const validToken = token({ roomId, role: 'write' });
		const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=${validToken}`, {
			origin: ALLOWED_ORIGIN,
		});
		await waitForOpen(socket);
		const closed = waitForClose(socket);
		socket.send('not binary');
		const { code } = await closed;
		assert.equal(code, 1003);
		socket.terminate();
	});
});

test.after(async () => {
	await pool.end();
});
