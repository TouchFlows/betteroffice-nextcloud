import mariadb from 'mariadb';
import { createHealthServer } from './app.js';
import { loadServerConfig } from './config.js';
import { attachCollaborationServer } from './wsServer.js';

/**
 * Process bootstrap. Room lifecycle, the collaboration WebSocket endpoint
 * and durable persistence (§4.C, §8, §14.2) are wired here; `poc/relay/`
 * remains the Phase 0 proof that informed this implementation.
 */
const config = loadServerConfig();
const pool = mariadb.createPool(config.database);
const server = createHealthServer();
const wss = attachCollaborationServer(server, config, pool);

server.listen(config.port, () => {
	console.log(`[relay] listening on :${config.port}`);
});

function shutdown(): void {
	// close() alone only stops accepting new connections; any still-open
	// WebSocket keeps the event loop alive and the DB pool open, which would
	// leave the process hanging on SIGTERM instead of exiting (PLAN.md §14.2
	// "graceful shutdown").
	wss.clients.forEach((client) => client.terminate());
	server.close(() => {
		void pool.end().finally(() => process.exit(0));
	});
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
