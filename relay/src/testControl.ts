import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from './app.js';

const REVOKE_PATH = '/__test__/revoke-token';

function readJsonBody(request: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch (error) {
				reject(error);
			}
		});
		request.on('error', reject);
	});
}

/**
 * Harness-only control route: `POST /__test__/revoke-token` with `{ jtis }`
 * makes this process refuse those token ids from then on, exactly as if they
 * had expired.
 *
 * A signature cannot be un-signed, so withdrawing a token is state the relay
 * has to hold -- which is why the e2e mock, the thing that issued the token,
 * cannot revoke it by itself (`app/tests/e2e/mockCollaborationApi.ts` calls
 * this route). It exists so a test can reach "the relay refuses this token"
 * without waiting out a five-minute lifetime.
 *
 * Wired only when `BETTEROFFICE_RELAY_TEST_CONTROL=1` (`server.ts`,
 * `RelayServerConfig.testControl`): it is a mutation endpoint with no
 * authentication of its own, so a deployment must never expose it.
 */
export function createTokenRevocationControl(revokedJtis: Set<string>): RequestHandler {
	return (request, response) => {
		const url = new URL(request.url ?? '', 'http://relay.invalid');
		if (url.pathname !== REVOKE_PATH) return false;

		if (request.method !== 'POST') {
			response.writeHead(405);
			response.end();
			return true;
		}

		void readJsonBody(request).then(
			(body) => {
				const jtis = (body as { jtis?: unknown } | null)?.jtis;
				if (!Array.isArray(jtis) || jtis.some((jti) => typeof jti !== 'string' || jti === '')) {
					response.writeHead(400);
					response.end();
					return;
				}
				for (const jti of jtis as string[]) revokedJtis.add(jti);
				console.log(`[relay] revoked ${jtis.length} token(s)`);
				response.writeHead(204);
				response.end();
			},
			() => {
				response.writeHead(400);
				response.end();
			},
		);
		return true;
	};
}
