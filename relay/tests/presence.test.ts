import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import mariadb from 'mariadb';
import { createHealthServer } from '../src/app.js';
import { loadConfig, type RelayServerConfig } from '../src/config.js';
import { handlePresenceRequest } from '../src/presence.js';
import { RoomRegistry } from '../src/roomRegistry.js';
import type { CollaborationTokenClaims } from '../src/token.js';
import { attachCollaborationServer } from '../src/wsServer.js';

const ALLOWED_ORIGIN = 'https://cloud.example.test';
const SHARED_SECRET = 'presence-test-secret';

const pool = mariadb.createPool(loadConfig().database);
const config: RelayServerConfig = { ...loadConfig(), sharedSecret: SHARED_SECRET, allowedOrigin: ALLOWED_ORIGIN };

function base64Url(buffer: Buffer): string {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(claims: Partial<CollaborationTokenClaims> & Pick<CollaborationTokenClaims, 'roomId' | 'role'>): string {
	const full: CollaborationTokenClaims = {
		iid: 'instance-1',
		sub: 'alice',
		name: 'Alice Anderson',
		avatar: 'https://cloud.example.test/index.php/avatar/alice/64',
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

interface PresenceResponse {
	status: number;
	headers: IncomingHttpHeaders;
	body: string;
}

/** Plain `node:http` rather than `fetch`, so the Origin header is exactly what the test sets. */
function getPresence(
	port: number,
	roomId: string,
	query: string,
	headers: Record<string, string> = { origin: ALLOWED_ORIGIN },
): Promise<PresenceResponse> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			{
				host: '127.0.0.1',
				port,
				method: 'GET',
				path: `/room/${encodeURIComponent(roomId)}/presence${query}`,
				headers,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks).toString('utf8'),
					}),
				);
			},
		);
		request.on('error', reject);
		request.end();
	});
}

function participantsOf(body: string): Array<{ name: string; avatar: string | null; role: string; self: boolean }> {
	return (JSON.parse(body) as { participants: Array<{ name: string; avatar: string | null; role: string; self: boolean }> })
		.participants;
}

async function withServer(run: (port: number) => Promise<void>): Promise<void> {
	const registry = new RoomRegistry(pool);
	const server: Server = createHealthServer((request, response) =>
		handlePresenceRequest(registry, config, request, response),
	);
	attachCollaborationServer(server, config, pool, registry);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('expected a TCP address');
	try {
		await run(address.port);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.on('open', () => resolve());
		socket.on('close', (code, reason) => reject(new Error(`closed before opening: ${code} ${reason}`)));
		socket.on('error', reject);
	});
}

async function connect(port: number, roomId: string, collaborationToken: string): Promise<WebSocket> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/room/${roomId}?token=${collaborationToken}`, {
		origin: ALLOWED_ORIGIN,
	});
	await waitForOpen(socket);
	// The room resolves asynchronously (it rehydrates from MariaDB) before the
	// socket is joined, so presence can trail the open event by a tick.
	await new Promise((resolve) => setTimeout(resolve, 250));
	return socket;
}

test('presence reports each connected peer with the identity its token was signed with', async () => {
	await withServer(async (port) => {
		const roomId = `presence-${randomUUID()}`;
		const aliceToken = token({ roomId, role: 'write', sub: 'alice', name: 'Alice Anderson' });
		const bobToken = token({
			roomId,
			role: 'read',
			sub: 'bob',
			name: 'Bob Brown',
			avatar: null,
		});

		const alice = await connect(port, roomId, aliceToken);
		const bob = await connect(port, roomId, bobToken);
		try {
			const response = await getPresence(port, roomId, `?token=${aliceToken}`);
			assert.equal(response.status, 200);
			assert.equal(response.headers['cache-control'], 'no-store');
			assert.equal(response.headers['access-control-allow-origin'], ALLOWED_ORIGIN);

			const participants = participantsOf(response.body);
			assert.deepEqual(
				participants.map((participant) => [participant.name, participant.role, participant.self]),
				[
					['Alice Anderson', 'write', true],
					['Bob Brown', 'read', false],
				],
			);
			assert.equal(
				participants.find((participant) => participant.name === 'Bob Brown')?.avatar,
				null,
			);
			assert.equal(
				participants.find((participant) => participant.name === 'Alice Anderson')?.avatar,
				'https://cloud.example.test/index.php/avatar/alice/64',
			);

			// Presence is a roster, not a directory: Nextcloud user ids stay on
			// the relay, so a participant cannot be mapped back to an account.
			assert.ok(!response.body.includes('"alice"'));
			assert.ok(!response.body.includes('"bob"'));

			// Bob's own view marks *him* as self, not Alice.
			const bobView = participantsOf((await getPresence(port, roomId, `?token=${bobToken}`)).body);
			assert.deepEqual(
				bobView.map((participant) => [participant.name, participant.self]),
				[
					['Alice Anderson', false],
					['Bob Brown', true],
				],
			);

			// Leaving the room removes the participant.
			const bobClosed = new Promise((resolve) => bob.on('close', resolve));
			bob.close();
			await bobClosed;
			await new Promise((resolve) => setTimeout(resolve, 250));
			assert.deepEqual(
				participantsOf((await getPresence(port, roomId, `?token=${aliceToken}`)).body).map(
					(participant) => participant.name,
				),
				['Alice Anderson'],
			);
		} finally {
			alice.terminate();
			bob.terminate();
		}
	});
});

test('a room nobody is connected to answers with an empty roster, not an error', async () => {
	await withServer(async (port) => {
		const roomId = `presence-empty-${randomUUID()}`;
		const response = await getPresence(port, roomId, `?token=${token({ roomId, role: 'write' })}`);

		assert.equal(response.status, 200);
		assert.deepEqual(participantsOf(response.body), []);
	});
});

test('presence requires a token for that room, from the configured origin', async () => {
	await withServer(async (port) => {
		const roomId = `presence-auth-${randomUUID()}`;
		const otherRoom = `presence-other-${randomUUID()}`;

		const anonymous = await getPresence(port, roomId, '');
		assert.equal(anonymous.status, 401);
		assert.equal(anonymous.body, '');

		const wrongRoom = await getPresence(port, roomId, `?token=${token({ roomId: otherRoom, role: 'write' })}`);
		assert.equal(wrongRoom.status, 403);

		const forged = await getPresence(
			port,
			roomId,
			`?token=${token({ roomId, role: 'write' }).split('.').slice(0, 2).join('.')}.forged`,
		);
		assert.equal(forged.status, 401);

		// A page on any other origin must not even be able to read the answer,
		// so it gets no CORS header at all.
		const foreignOrigin = await getPresence(port, roomId, `?token=${token({ roomId, role: 'write' })}`, {
			origin: 'https://evil.example',
		});
		assert.equal(foreignOrigin.status, 403);
		assert.equal(foreignOrigin.headers['access-control-allow-origin'], undefined);
	});
});

test.after(async () => {
	await pool.end();
});
