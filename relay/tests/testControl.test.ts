import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest, type Server } from 'node:http';
import { createHealthServer } from '../src/app.js';
import { createTokenRevocationControl } from '../src/testControl.js';

/**
 * The harness-only control route (`testControl.ts`): it is how the e2e mock
 * withdraws a token it issued, because a signature cannot be un-signed. It is
 * only mounted when `BETTEROFFICE_RELAY_TEST_CONTROL=1`; these tests exercise
 * the handler directly, so they need no database.
 */

interface Reply {
	status: number;
	body: string;
}

function call(port: number, path: string, method: string, body?: string): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const request = httpRequest({ host: '127.0.0.1', port, method, path }, (response) => {
			const chunks: Buffer[] = [];
			response.on('data', (chunk: Buffer) => chunks.push(chunk));
			response.on('end', () =>
				resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
			);
		});
		request.on('error', reject);
		request.end(body);
	});
}

async function withControl(run: (port: number, revokedJtis: Set<string>) => Promise<void>): Promise<void> {
	const revokedJtis = new Set<string>();
	const control = createTokenRevocationControl(revokedJtis);
	const server: Server = createHealthServer(control);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('expected a TCP address');
	try {
		await run(address.port, revokedJtis);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

test('POSTing token ids withdraws them', async () => {
	await withControl(async (port, revokedJtis) => {
		const first = await call(port, '/__test__/revoke-token', 'POST', JSON.stringify({ jtis: ['a', 'b'] }));
		assert.equal(first.status, 204);
		assert.deepEqual([...revokedJtis].sort(), ['a', 'b']);

		// Called again later in a test, with the ids issued since.
		assert.equal((await call(port, '/__test__/revoke-token', 'POST', JSON.stringify({ jtis: ['c'] }))).status, 204);
		assert.deepEqual([...revokedJtis].sort(), ['a', 'b', 'c']);
	});
});

test('a body that names no token ids revokes nothing', async () => {
	await withControl(async (port, revokedJtis) => {
		for (const body of ['', 'not json', '{}', '{"jtis":"a"}', '{"jtis":["a",1]}', '{"jtis":[""]}']) {
			assert.equal(
				(await call(port, '/__test__/revoke-token', 'POST', body)).status,
				400,
				`body ${JSON.stringify(body)} should have been refused`,
			);
		}
		assert.equal(revokedJtis.size, 0);
	});
});

test('only POST is accepted', async () => {
	await withControl(async (port, revokedJtis) => {
		const reply = await call(port, '/__test__/revoke-token', 'GET');
		assert.equal(reply.status, 405);
		assert.equal(revokedJtis.size, 0);
	});
});

test('any other path falls through to the normal server', async () => {
	await withControl(async (port) => {
		assert.equal((await call(port, '/health', 'GET')).status, 200);
		assert.equal((await call(port, '/__test__/other', 'POST', '{}')).status, 404);
	});
});
