import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import mariadb from 'mariadb';
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
		// Message type 0 (sync) is an edit attempt; byte 0 is the varint-encoded message type.
		socket.send(new Uint8Array([0, 1, 2]));
		const { code } = await closed;
		assert.equal(code, 1008);
		socket.terminate();
	});
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
