import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mariadb from 'mariadb';

/**
 * Exercises the actual `migrate.ts` CLI as a subprocess (it runs `up()`/
 * `down()` as a side effect of being imported, driven by `process.argv`, so
 * importing it directly isn't an option) against its own dedicated,
 * disposable database -- never the shared fixture DB `store.test.ts`/
 * `room.test.ts`/`wsServer.test.ts` assume is already migrated.
 */
const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const migrateScript = join(here, '..', 'src', 'migrate.ts');

const env = {
	...process.env,
	BETTEROFFICE_RELAY_DB_HOST: process.env.BETTEROFFICE_RELAY_DB_HOST ?? '127.0.0.1',
	BETTEROFFICE_RELAY_DB_PORT: process.env.BETTEROFFICE_RELAY_DB_PORT ?? '3306',
	BETTEROFFICE_RELAY_DB_NAME: 'betteroffice_relay_migrate_test',
	BETTEROFFICE_RELAY_DB_USER: process.env.BETTEROFFICE_RELAY_DB_USER ?? 'betteroffice_relay_test',
	BETTEROFFICE_RELAY_DB_PASSWORD: process.env.BETTEROFFICE_RELAY_DB_PASSWORD ?? 'test_only_password',
};

function runMigrate(command?: 'up' | 'down'): ReturnType<typeof execFileAsync> {
	const args = command ? [migrateScript, command] : [migrateScript];
	return execFileAsync('node', ['--import', 'tsx', ...args], { env });
}

async function tableNames(): Promise<string[]> {
	const pool = mariadb.createPool({
		host: env.BETTEROFFICE_RELAY_DB_HOST,
		port: Number(env.BETTEROFFICE_RELAY_DB_PORT),
		database: env.BETTEROFFICE_RELAY_DB_NAME,
		user: env.BETTEROFFICE_RELAY_DB_USER,
		password: env.BETTEROFFICE_RELAY_DB_PASSWORD,
	});
	try {
		const rows: Array<Record<string, string>> = await pool.query('SHOW TABLES');
		return rows.map((row) => Object.values(row)[0]).sort();
	} finally {
		await pool.end();
	}
}

async function reset(): Promise<void> {
	const pool = mariadb.createPool({
		host: env.BETTEROFFICE_RELAY_DB_HOST,
		port: Number(env.BETTEROFFICE_RELAY_DB_PORT),
		database: env.BETTEROFFICE_RELAY_DB_NAME,
		user: env.BETTEROFFICE_RELAY_DB_USER,
		password: env.BETTEROFFICE_RELAY_DB_PASSWORD,
		multipleStatements: true,
	});
	try {
		await pool.query(
			'SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS room_checkpoints, room_updates, rooms, schema_migrations; SET FOREIGN_KEY_CHECKS=1;',
		);
	} finally {
		await pool.end();
	}
}

test('up creates the relay schema and tracks it in schema_migrations', async () => {
	await reset();
	await runMigrate();
	const tables = await tableNames();
	assert.deepEqual(tables, ['room_checkpoints', 'room_updates', 'rooms', 'schema_migrations']);
});

test('up is idempotent -- re-running it applies nothing new', async () => {
	await reset();
	await runMigrate();
	// A second run must not error (checksum matches) and must leave the schema as-is.
	await runMigrate();
	const tables = await tableNames();
	assert.deepEqual(tables, ['room_checkpoints', 'room_updates', 'rooms', 'schema_migrations']);
});

test('down rolls back the most recently applied migration', async () => {
	await reset();
	await runMigrate();
	await runMigrate('down');
	const tables = await tableNames();
	// down() removes the migration's own tables but leaves schema_migrations
	// itself (the tracking table, not part of any migration) in place.
	assert.deepEqual(tables, ['schema_migrations']);
});

test('down with nothing applied is a no-op, not an error', async () => {
	await reset();
	const { stdout } = await runMigrate('down');
	assert.match(stdout.toString(), /nothing to roll back/);
});
