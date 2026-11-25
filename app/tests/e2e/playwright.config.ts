import { defineConfig } from '@playwright/test';
import { TEST_RELAY_PORT, relayEnvironment } from './testRelay';

export default defineConfig({
	testDir: '.',
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: 'http://localhost:5184',
	},
	webServer: [
		{
			command: 'npx vite --config tests/e2e/vite.harness.config.ts',
			cwd: '../..',
			url: 'http://localhost:5184',
			reuseExistingServer: false,
			timeout: 20_000,
		},
		{
			// The real relay, against a real MariaDB -- the collaboration spec
			// proves convergence through the actual service, not a stand-in.
			// Its schema must already be migrated (relay/README.md); CI does
			// that before running these tests.
			command: 'npx tsx src/server.ts',
			cwd: '../../../relay',
			url: `http://127.0.0.1:${TEST_RELAY_PORT}/health`,
			reuseExistingServer: false,
			timeout: 60_000,
			env: { ...(process.env as Record<string, string>), ...relayEnvironment() },
		},
	],
});
