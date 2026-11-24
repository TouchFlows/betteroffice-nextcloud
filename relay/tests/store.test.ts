import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import mariadb from 'mariadb';
import { loadConfig } from '../src/config.js';
import { RoomStore } from '../src/store.js';

/**
 * Exercises `RoomStore` against a real MariaDB instance (CI provides one as
 * a service container; locally, point `BETTEROFFICE_RELAY_DB_*` at a test
 * database with `migrations/0001_create_rooms.sql` already applied, same as
 * `npm run migrate` requires). A fake/in-memory double would not catch a SQL
 * mistake like the one this schema exists to avoid.
 */
const pool = mariadb.createPool(loadConfig().database);

test('ensureRoom is idempotent', async () => {
	const store = new RoomStore(pool, `test-${randomUUID()}`);
	await store.ensureRoom();
	await store.ensureRoom();
	assert.deepEqual(await store.readUpdates(), []);
});

test('appendUpdate then readUpdates returns updates in insertion order', async () => {
	const store = new RoomStore(pool, `test-${randomUUID()}`);
	await store.ensureRoom();
	await store.appendUpdate(new Uint8Array([1, 2, 3]));
	await store.appendUpdate(new Uint8Array([4, 5]));

	const frames = await store.readUpdates();
	assert.deepEqual(
		frames.map((f) => Array.from(f)),
		[
			[1, 2, 3],
			[4, 5],
		],
	);
});

test('checkpoint atomically replaces the update log with one frame', async () => {
	const store = new RoomStore(pool, `test-${randomUUID()}`);
	await store.ensureRoom();
	await store.appendUpdate(new Uint8Array([1]));
	await store.appendUpdate(new Uint8Array([2]));

	await store.checkpoint(new Uint8Array([9, 9]));

	const frames = await store.readUpdates();
	assert.equal(frames.length, 1);
	assert.deepEqual(Array.from(frames[0]), [9, 9]);

	// A second checkpoint replaces the first rather than accumulating.
	await store.appendUpdate(new Uint8Array([3]));
	await store.checkpoint(new Uint8Array([7]));
	const second = await store.readUpdates();
	assert.equal(second.length, 1);
	assert.deepEqual(Array.from(second[0]), [7]);
});

test.after(async () => {
	await pool.end();
});
