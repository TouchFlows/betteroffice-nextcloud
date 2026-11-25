import { createHmac, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { TEST_RELAY_ORIGIN, TEST_SHARED_SECRET } from './testRelay';

/**
 * Stands in for `CollaborationController` (app/lib/Controller/CollaborationController.php)
 * and `RoomService`, so the editor's collaboration wiring can be exercised in
 * a real browser against a *real* relay and a *real* MariaDB without a live
 * Nextcloud -- the same trade-off `mockDocumentApi.ts` makes for the document
 * API, and for the same reason (no Nextcloud in this environment).
 *
 * It is deliberately faithful to the server contract, not simpler:
 * - `POST .../session/1` -> `{roomId, token, role, seed}`, `seed` base64 or
 *   null. The token is a real HS256 compact token signed with the shared
 *   secret the relay was started with, with the same claims `RoomService`
 *   issues, so the relay's own verification is what admits the client.
 * - `PUT .../session/1/seed` -> `{seed}`, create-if-absent: the first offer
 *   wins and every later caller gets that same seed back (the PHP side's
 *   atomic `trySetSeed` semantics), which is what makes two clients converge
 *   instead of each seeding their own room.
 *
 * The token lifetime is configurable through a test-only control channel
 * (`POST /__test__/token-ttl?seconds=N`, like mockDocumentApi.ts's
 * `force-conflict`), so a test can reach expiry without waiting five
 * minutes.
 *
 * A browser context that sends the `betteroffice-e2e-role=read` cookie is
 * treated as a viewer: the real app derives the role from the user's file
 * permissions, which this mock has no Nextcloud to consult, and a per-context
 * cookie is what lets one test run a writer and a viewer side by side. The
 * `betteroffice-e2e-user` cookie names that context's user, so two contexts
 * get two distinguishable presence identities (PLAN.md §8.6), and the avatar
 * URL in the token points at this server's own placeholder image.
 */

// Unique per run: the relay persists a room's updates in MariaDB, so a fixed
// id would carry one run's edits (and seed) into the next one's assertions.
const ROOM_ID = `e2e-room-${randomUUID()}`;
const DEFAULT_TOKEN_TTL_SECONDS = 300;
const SESSION_PATH = '/index.php/apps/betteroffice/collab/session';
const ROLE_COOKIE = 'betteroffice-e2e-role';
const USER_COOKIE = 'betteroffice-e2e-user';
const AVATAR_PATH = '/__test__/avatar';

/** 1x1 PNG: enough for the editor's presence avatar to load and be asserted on. */
const AVATAR_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

type CollaborationRole = 'read' | 'write';

function requestedRole(request: IncomingMessage): CollaborationRole {
	const cookies = (request.headers.cookie ?? '').split(';').map((part) => part.trim());
	return cookies.includes(`${ROLE_COOKIE}=read`) ? 'read' : 'write';
}

function requestedName(request: IncomingMessage): string {
	const prefix = `${USER_COOKIE}=`;
	const cookie = (request.headers.cookie ?? '')
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(prefix));
	const name = cookie?.slice(prefix.length).trim();
	return name ? decodeURIComponent(name) : 'Alice';
}

function base64Url(buffer: Buffer): string {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function issueToken(ttlSeconds: number, role: CollaborationRole, name: string): string {
	const claims = {
		iid: 'e2e-instance',
		sub: name.toLowerCase(),
		name,
		avatar: `${TEST_RELAY_ORIGIN}${AVATAR_PATH}/${encodeURIComponent(name)}.png`,
		fid: 1,
		roomId: ROOM_ID,
		format: 'docx',
		role,
		exp: Math.floor(Date.now() / 1000) + ttlSeconds,
		jti: `e2e-${Date.now()}`,
	};
	const header = base64Url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const payload = base64Url(Buffer.from(JSON.stringify(claims)));
	const signature = base64Url(createHmac('sha256', TEST_SHARED_SECRET).update(`${header}.${payload}`).digest());
	return `${header}.${payload}.${signature}`;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json');
	response.end(JSON.stringify(body));
}

export function mockCollaborationApi(): Plugin {
	let seed: Buffer | null = null;
	let tokenTtlSeconds = DEFAULT_TOKEN_TTL_SECONDS;

	return {
		name: 'mock-betteroffice-collaboration-api',
		configureServer(server) {
			// Test-only control channel, not part of the real app: lets a test
			// issue short-lived tokens and so reach expiry quickly.
			server.middlewares.use('/__test__/token-ttl', (request, response) => {
				const seconds = Number(new URL(request.url ?? '', 'http://localhost').searchParams.get('seconds'));
				if (!Number.isFinite(seconds) || seconds <= 0) {
					response.statusCode = 400;
					response.end();
					return;
				}
				tokenTtlSeconds = seconds;
				response.statusCode = 204;
				response.end();
			});

			// The avatar URL the token carries points here; the relay only passes
			// it through, so this stands in for Nextcloud's core avatar route.
			server.middlewares.use(AVATAR_PATH, (_request, response) => {
				response.statusCode = 200;
				response.setHeader('Content-Type', 'image/png');
				response.end(AVATAR_PNG);
			});

			server.middlewares.use(SESSION_PATH, (request, response) => {
				const path = (request.url ?? '').split('?')[0];
				const match = path.match(/^\/1(\/seed)?$/);
				if (!match) {
					response.statusCode = 404;
					response.end();
					return;
				}

				if (match[1]) {
					if (request.method !== 'PUT') {
						response.statusCode = 405;
						response.end();
						return;
					}
					void readBody(request).then((offered) => {
						if (offered.length === 0) {
							sendJson(response, 400, { message: 'A non-empty seed body is required' });
							return;
						}
						// Create-if-absent: a later client's offer is discarded
						// in favour of the one already on record.
						seed ??= offered;
						sendJson(response, 200, { seed: seed.toString('base64') });
					});
					return;
				}

				if (request.method !== 'POST') {
					response.statusCode = 405;
					response.end();
					return;
				}
				const role = requestedRole(request);
				sendJson(response, 200, {
					roomId: ROOM_ID,
					token: issueToken(tokenTtlSeconds, role, requestedName(request)),
					role,
					seed: seed === null ? null : seed.toString('base64'),
				});
			});
		},
	};
}
