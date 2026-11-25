import { defineConfig } from '@playwright/test';
import { TEST_RELAY_PORT, relayEnvironment } from './testRelay';

export default defineConfig({
	testDir: '.',
	timeout: 30_000,
	fullyParallel: false,
	// Two workers: files run side by side, tests inside a file stay serial
	// because each drives its own browser pair. Safe because every execution
	// gets its own room and its own document-mock state (fixtures.ts), which is
	// what the --repeat-each=2 guard in CI keeps honest.
	workers: 2,
	use: {
		baseURL: 'http://localhost:5184',
		// Kept only for the run that failed: a trace is the DOM, network and
		// console timeline around the assertion, which a diff alone cannot show.
		trace: 'retain-on-failure',
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
