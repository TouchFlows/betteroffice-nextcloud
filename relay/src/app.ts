import { createServer, type Server } from 'node:http';

/** Wiring only — no listening, no process lifecycle — so tests can exercise it directly. */
export function createHealthServer(): Server {
	return createServer((request, response) => {
		if (request.url === '/health') {
			response.writeHead(200, { 'content-type': 'text/plain' });
			response.end('ok');
			return;
		}
		response.writeHead(404);
		response.end();
	});
}
