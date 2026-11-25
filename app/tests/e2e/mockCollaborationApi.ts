import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { TEST_SHARED_SECRET } from './testRelay';

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
 */

const ROOM_ID = 'e2e-room-1';
const TOKEN_TTL_SECONDS = 300;
const SESSION_PATH = '/index.php/apps/betteroffice/collab/session';

function base64Url(buffer: Buffer): string {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function issueToken(): string {
	const claims = {
		iid: 'e2e-instance',
		sub: 'alice',
		fid: 1,
		roomId: ROOM_ID,
		format: 'docx',
		role: 'write',
		exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
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

	return {
		name: 'mock-betteroffice-collaboration-api',
		configureServer(server) {
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
				sendJson(response, 200, {
					roomId: ROOM_ID,
					token: issueToken(),
					role: 'write',
					seed: seed === null ? null : seed.toString('base64'),
				});
			});
		},
	};
}
