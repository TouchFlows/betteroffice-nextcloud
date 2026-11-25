/**
 * Shared settings for the two-browser collaboration e2e test: the real relay
 * process `playwright.config.ts` starts, and the mock of the Nextcloud
 * endpoints it talks to (`mockCollaborationApi.ts`).
 *
 * Only test values live here -- the shared secret below signs tokens this
 * suite's own mock app issues to this suite's own throwaway relay.
 */
export const TEST_RELAY_PORT = 8788;
export const TEST_RELAY_ORIGIN = 'http://localhost:5184';
export const TEST_RELAY_URL = `ws://127.0.0.1:${TEST_RELAY_PORT}`;
export const TEST_SHARED_SECRET = 'e2e-only-collaboration-secret';

/**
 * The relay needs a real MariaDB (PLAN.md §5.2 -- its tests and runtime both
 * speak to an actual schema, never a mock). Defaults match the documented
 * local test database; CI overrides them with its service container.
 */
export function relayEnvironment(): Record<string, string> {
	return {
		BETTEROFFICE_RELAY_PORT: String(TEST_RELAY_PORT),
		BETTEROFFICE_RELAY_DB_HOST: process.env.BETTEROFFICE_RELAY_DB_HOST ?? '127.0.0.1',
		BETTEROFFICE_RELAY_DB_PORT: process.env.BETTEROFFICE_RELAY_DB_PORT ?? '3306',
		BETTEROFFICE_RELAY_DB_NAME: process.env.BETTEROFFICE_RELAY_DB_NAME ?? 'betteroffice_relay_test',
		BETTEROFFICE_RELAY_DB_USER: process.env.BETTEROFFICE_RELAY_DB_USER ?? 'betteroffice_relay_test',
		BETTEROFFICE_RELAY_DB_PASSWORD: process.env.BETTEROFFICE_RELAY_DB_PASSWORD ?? 'test_only_password',
		BETTEROFFICE_RELAY_SHARED_SECRET: TEST_SHARED_SECRET,
		BETTEROFFICE_RELAY_ALLOWED_ORIGIN: TEST_RELAY_ORIGIN,
	};
}
