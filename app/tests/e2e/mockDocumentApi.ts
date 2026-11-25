import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { DEFAULT_E2E_ROOM_ID, roomCookieValue } from './e2eRoom';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

/**
 * Stands in for DocumentController (app/lib/Controller/DocumentController.php)
 * against a real browser, so EditorApp's fetch/save wiring is exercised for
 * real rather than only unit-tested against PHP mocks (no Nextcloud/Docker
 * available in this environment to test the real controller end to end --
 * see the Phase 2 report for what this does and doesn't cover).
 *
 * Everything it keeps -- the document's bytes, its ETag and a forced conflict
 * -- is keyed by room, not per process: the harness gives every test execution
 * its own (`fixtures.ts`), so a repeated or parallel run starts from the
 * pristine sample instead of the previous run's saved text and ETag.
 */
export function mockDocumentApi(sampleDocxPath: string): Plugin {
	const sample = readFileSync(sampleDocxPath);
	const sampleEtag = etagFor(sample);
	const contents = new Map<string, Buffer>();
	const etags = new Map<string, string>();
	const forcedConflicts = new Set<string>();

	return {
		name: 'mock-betteroffice-document-api',
		configureServer(server) {
			server.middlewares.use('/index.php/apps/betteroffice/document/1', (req, res) => {
				const room = requestedRoom(req);
				const current = contents.get(room) ?? sample;
				const etag = etags.get(room) ?? sampleEtag;

				if (req.method === 'GET') {
					res.statusCode = 200;
					res.setHeader('Content-Type', DOCX_MIME);
					res.setHeader('Etag', etag);
					res.end(current);
					return;
				}
				if (req.method === 'PUT') {
					const chunks: Buffer[] = [];
					req.on('data', (chunk: Buffer) => chunks.push(chunk));
					req.on('end', () => {
						const ifMatch = req.headers['if-match'];
						if (forcedConflicts.has(room) || ifMatch !== etag) {
							res.statusCode = 409;
							res.setHeader('Content-Type', 'application/json');
							res.end(JSON.stringify({ message: 'conflict' }));
							return;
						}
						const saved = Buffer.concat(chunks);
						const savedEtag = etagFor(saved);
						contents.set(room, saved);
						etags.set(room, savedEtag);
						res.statusCode = 200;
						res.setHeader('Content-Type', 'application/json');
						res.end(JSON.stringify({ etag: savedEtag }));
					});
					return;
				}
				res.statusCode = 405;
				res.end();
			});

			// Test-only control channel, not part of the real app: lets the
			// Playwright test force the next save to hit a conflict, simulating
			// an external modification between read and save. The room is
			// required, for the same reason the collaboration mock's token-ttl
			// endpoint requires one: a conflict without it would silently apply
			// to some other test's room.
			server.middlewares.use('/__test__/force-conflict', (req, res) => {
				const room = new URL(req.url ?? '', 'http://localhost').searchParams.get('room')?.trim() ?? '';
				if (room === '') {
					res.statusCode = 400;
					res.end();
					return;
				}
				forcedConflicts.add(room);
				res.statusCode = 204;
				res.end();
			});
		},
	};
}
