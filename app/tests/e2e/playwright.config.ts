import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: 'http://localhost:5184',
	},
	webServer: {
		command: 'npx vite --config tests/e2e/vite.harness.config.ts',
		cwd: '../..',
		url: 'http://localhost:5184',
		reuseExistingServer: false,
		timeout: 20_000,
	},
});
