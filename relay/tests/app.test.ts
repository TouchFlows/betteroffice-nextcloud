import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHealthServer } from '../src/app.js';

test('GET /health responds 200 ok', async () => {
	const server = createHealthServer();
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('expected a TCP address');

	try {
		const response = await fetch(`http://127.0.0.1:${address.port}/health`);
		assert.equal(response.status, 200);
		assert.equal(await response.text(), 'ok');
	} finally {
		server.close();
	}
});

test('an unknown path responds 404', async () => {
	const server = createHealthServer();
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('expected a TCP address');

	try {
		const response = await fetch(`http://127.0.0.1:${address.port}/nope`);
		assert.equal(response.status, 404);
	} finally {
		server.close();
	}
});
