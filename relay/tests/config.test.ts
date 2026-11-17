import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

test('loadConfig throws when a required database variable is missing', () => {
	const saved = { ...process.env };
	delete process.env.BETTEROFFICE_RELAY_DB_NAME;
	delete process.env.BETTEROFFICE_RELAY_DB_USER;
	delete process.env.BETTEROFFICE_RELAY_DB_PASSWORD;

	try {
		assert.throws(() => loadConfig(), /BETTEROFFICE_RELAY_DB_NAME/);
	} finally {
		process.env = saved;
	}
});

test('loadConfig applies defaults for host, port and relay port', () => {
	const saved = { ...process.env };
	process.env.BETTEROFFICE_RELAY_DB_NAME = 'betteroffice_relay';
	process.env.BETTEROFFICE_RELAY_DB_USER = 'betteroffice_relay';
	process.env.BETTEROFFICE_RELAY_DB_PASSWORD = 'secret';
	delete process.env.BETTEROFFICE_RELAY_PORT;
	delete process.env.BETTEROFFICE_RELAY_DB_HOST;
	delete process.env.BETTEROFFICE_RELAY_DB_PORT;

	try {
		const config = loadConfig();
		assert.equal(config.port, 8787);
		assert.equal(config.database.host, '127.0.0.1');
		assert.equal(config.database.port, 3306);
		assert.equal(config.database.database, 'betteroffice_relay');
	} finally {
		process.env = saved;
	}
});
