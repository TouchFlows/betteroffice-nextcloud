import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function etagFor(content: Buffer): string {
	return `"${createHash('sha1').update(content).digest('hex')}"`;
}

/**
 * Stands in for DocumentController (app/lib/Controller/DocumentController.php)
 * against a real browser, so EditorApp's fetch/save wiring is exercised for
 * real rather than only unit-tested against PHP mocks (no Nextcloud/Docker
 * available in this environment to test the real controller end to end --
 * see the Phase 2 report for what this does and doesn't cover).
 */
export function mockDocumentApi(sampleDocxPath: string): Plugin {
	let content = readFileSync(sampleDocxPath);
	let etag = etagFor(content);
	let forceConflict = false;

	return {
		name: 'mock-betteroffice-document-api',
		configureServer(server) {
			server.middlewares.use('/index.php/apps/betteroffice/document/1', (req, res) => {
				if (req.method === 'GET') {
					res.statusCode = 200;
					res.setHeader('Content-Type', DOCX_MIME);
					res.setHeader('Etag', etag);
					res.end(content);
					return;
				}
				if (req.method === 'PUT') {
					const chunks: Buffer[] = [];
					req.on('data', (chunk: Buffer) => chunks.push(chunk));
					req.on('end', () => {
						const ifMatch = req.headers['if-match'];
						if (forceConflict || ifMatch !== etag) {
							res.statusCode = 409;
							res.setHeader('Content-Type', 'application/json');
							res.end(JSON.stringify({ message: 'conflict' }));
							return;
						}
						content = Buffer.concat(chunks);
						etag = etagFor(content);
						res.statusCode = 200;
						res.setHeader('Content-Type', 'application/json');
						res.end(JSON.stringify({ etag }));
					});
					return;
				}
				res.statusCode = 405;
				res.end();
			});

			// Test-only control channel, not part of the real app: lets the
			// Playwright test force the next save to hit a conflict, simulating
			// an external modification between read and save.
			server.middlewares.use('/__test__/force-conflict', (req, res) => {
				forceConflict = true;
				res.statusCode = 204;
				res.end();
			});
		},
	};
}
