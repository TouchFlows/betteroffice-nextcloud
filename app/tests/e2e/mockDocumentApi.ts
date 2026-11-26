import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { DEFAULT_E2E_ROOM_ID, roomCookieValue } from './e2eRoom';

/** One fixture a test can open, addressed the way the editor addresses a file. */
export interface MockDocumentSample {
	fileId: number;
	path: string;
	mime: string;
}

interface StoredDocument {
	bytes: Buffer;
	etag: string;
	mime: string;
}

function etagFor(content: Buffer): string {
	return `"${createHash('sha1').update(content).digest('hex')}"`;
}

/**
 * The room a request belongs to: `?room=` when the caller is Playwright's
 * standalone `request` context (which does not carry the browser context's
 * cookies), otherwise the cookie the harness set on the context.
 */
function requestedRoom(request: IncomingMessage): string {
	const explicit = new URL(request.url ?? '', 'http://localhost').searchParams.get('room')?.trim() ?? '';
	return explicit || roomCookieValue(request.headers.cookie) || DEFAULT_E2E_ROOM_ID;
}

const DOCUMENT_PATH = /^\/index\.php\/apps\/betteroffice\/document\/(\d+)$/;

/**
 * Stands in for DocumentController (app/lib/Controller/DocumentController.php)
 * against a real browser, so the editors' fetch/save wiring is exercised for
 * real rather than only unit-tested against PHP mocks (no Nextcloud/Docker
 * available in this environment to test the real controller end to end --
 * see the Phase 2 report for what this does and doesn't cover).
 *
 * Keyed by room *and* file id: the harness gives every test execution its own
 * room (`fixtures.ts`) and each format its own file id, so a repeated,
 * parallel or other-format run can never inherit a saved document or ETag.
 */
export function mockDocumentApi(samples: MockDocumentSample[]): Plugin {
	const fixtures = new Map<number, StoredDocument>(
		samples.map((sample) => {
			const bytes = readFileSync(sample.path);
			return [sample.fileId, { bytes, etag: etagFor(bytes), mime: sample.mime }];
		}),
	);
	const saved = new Map<string, StoredDocument>();
	const forcedConflicts = new Set<string>();

	const key = (room: string, fileId: number): string => `${room}:${fileId}`;
	const current = (room: string, fileId: number): StoredDocument | undefined =>
		saved.get(key(room, fileId)) ?? fixtures.get(fileId);

	return {
		name: 'mock-betteroffice-document-api',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url ?? '', 'http://localhost');
				const match = DOCUMENT_PATH.exec(url.pathname);
				if (!match) {
					next();
					return;
				}

				const fileId = Number(match[1]);
				const room = requestedRoom(req);
				const document = current(room, fileId);
				if (document === undefined) {
					res.statusCode = 404;
					res.end();
					return;
				}

				if (req.method === 'GET') {
					res.statusCode = 200;
					res.setHeader('Content-Type', document.mime);
					res.setHeader('Etag', document.etag);
					res.end(document.bytes);
					return;
				}
				if (req.method === 'PUT') {
					const chunks: Buffer[] = [];
					req.on('data', (chunk: Buffer) => chunks.push(chunk));
					req.on('end', () => {
						const ifMatch = req.headers['if-match'];
						if (forcedConflicts.has(key(room, fileId)) || ifMatch !== document.etag) {
							res.statusCode = 409;
							res.setHeader('Content-Type', 'application/json');
							res.end(JSON.stringify({ message: 'conflict' }));
							return;
						}
						const bytes = Buffer.concat(chunks);
						const etag = etagFor(bytes);
						saved.set(key(room, fileId), { bytes, etag, mime: document.mime });
						res.statusCode = 200;
						res.setHeader('Content-Type', 'application/json');
						res.end(JSON.stringify({ etag }));
					});
					return;
				}
				res.statusCode = 405;
				res.end();
			});

			// Test-only control channel, not part of the real app: lets a
			// Playwright test force the next save to hit a conflict, simulating
			// an external modification between read and save. Room and file id
			// are both required, so a conflict can never land on another test's
			// (or another format's) document.
			server.middlewares.use('/__test__/force-conflict', (req, res) => {
				const params = new URL(req.url ?? '', 'http://localhost').searchParams;
				const room = params.get('room')?.trim() ?? '';
				const fileId = Number(params.get('fileId') ?? '1');
				if (room === '') {
					res.statusCode = 400;
					res.end();
					return;
				}
				forcedConflicts.add(key(room, fileId));
				res.statusCode = 204;
				res.end();
			});

			// Same idea, read side: what the mock actually stored, so a spec can
			// assert that a save reached the API with a real file body rather
			// than trusting the editor's own "saved" label.
			server.middlewares.use('/__test__/document-state', (req, res) => {
				const params = new URL(req.url ?? '', 'http://localhost').searchParams;
				const room = params.get('room')?.trim() ?? '';
				const fileId = Number(params.get('fileId') ?? '1');
				if (room === '') {
					res.statusCode = 400;
					res.end();
					return;
				}
				const stored = current(room, fileId);
				if (stored === undefined) {
					res.statusCode = 404;
					res.end();
					return;
				}
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({
					fileId,
					mime: stored.mime,
					etag: stored.etag,
					bytes: stored.bytes.length,
					saved: saved.has(key(room, fileId)),
					// First four bytes tell a real OOXML zip container (PK\x03\x04)
					// from an empty or truncated body without shipping the file.
					signature: stored.bytes.subarray(0, 4).toString('latin1'),
				}));
			});
		},
	};
}
