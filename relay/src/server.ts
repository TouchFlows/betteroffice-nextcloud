import { createHealthServer } from './app.js';

/**
 * Process bootstrap (PLAN.md Phase 1: "Create the relay skeleton"). Room
 * lifecycle, the collaboration WebSocket endpoint and durable persistence
 * are Phase 3 work (§4.C, §8, §14.2) — see poc/relay/ for the Phase 0 proof
 * that informs that implementation. This only proves the process starts,
 * answers a health check, and shuts down cleanly, which is what the
 * systemd unit (deploy/betteroffice-relay.service) needs to supervise it.
 */
const port = Number(process.env.BETTEROFFICE_RELAY_PORT ?? 8787);
const server = createHealthServer();

server.listen(port, () => {
	console.log(`[relay] listening on :${port}`);
});

function shutdown(): void {
	server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
