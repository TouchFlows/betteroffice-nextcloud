import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/** Returns true when it handled the request; false to fall through to health/404. */
export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => boolean;

/** Wiring only — no listening, no process lifecycle — so tests can exercise it directly. */
export function createHealthServer(handleRequest?: RequestHandler): Server {
	return createServer((request, response) => {
		if (handleRequest?.(request, response)) return;
		if (request.url === '/health') {
			response.writeHead(200, { 'content-type': 'text/plain' });
			response.end('ok');
			return;
		}
		response.writeHead(404);
		response.end();
	});
}
