import { expect } from '@playwright/test';
import { E2E_ORIGIN } from './e2eRoom';
import { openEditor } from './editorDriver';
import { newContext, test } from './fixtures';

/**
 * Presence reads the roster with a collaboration token and reuses the one the
 * session handshake resolved for four minutes (`PRESENCE_TOKEN_REUSE_MS`). A
 * token only lives five minutes (`RoomService::TOKEN_TTL_SECONDS`), so once it
 * has expired the relay answers 401 and that token can never work again:
 * retrying it until the reuse window ran out would leave the editor listing no
 * collaborators for minutes. A refusal must drop it and resolve a new session
 * straight away.
 *
 * Reaching that refusal means waiting out a token lifetime, and nothing in the
 * page exposes the token's `exp`, so the room is given a two-second lifetime:
 * certainly expired by the roster re-read five seconds later
 * (`PRESENCE_REFRESH_MS`), but long enough for the WebSocket to be admitted
 * with it. The test then polls for the observable consequence -- a second
 * session resolved -- instead of sleeping past the lifetime, so it costs one
 * roster refresh and does not depend on how loaded the machine is.
 */
test.describe('docx: presence token refresh', () => {
	test('a token the relay refuses is replaced instead of retried', async ({ browser, request, room }) => {
		test.setTimeout(120_000);

		// Short-lived tokens, so "expired" is reachable inside a test.
		const TOKEN_TTL_SECONDS = 2;
		await request.post(`/__test__/token-ttl?seconds=${TOKEN_TTL_SECONDS}&room=${room}`);

		const aliceContext = await newContext(browser, room);
		const bobContext = await newContext(browser, room);
		// A second, distinguishable participant (PLAN.md §8.6).
		await bobContext.addCookies([{ name: 'betteroffice-e2e-user', value: 'Bob', url: E2E_ORIGIN }]);
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			// Every session the page resolves, so "asked for a new token" is
			// observed directly rather than inferred from the roster alone.
			const sessionRequests: string[] = [];
			alice.on('request', (outgoing) => {
				if (outgoing.method() === 'POST' && outgoing.url().includes('/apps/betteroffice/collab/session/')) {
					sessionRequests.push(outgoing.url());
				}
			});

			await openEditor(alice);
			// Counted here, not after Bob opens: the two-second token has expired
			// by the first roster re-read, so the refresh that follows the refusal
			// can land while Bob is still opening. Counting afterwards would take
			// that one as the baseline and then wait a whole refresh for a second.
			const sessionsBefore = sessionRequests.length;

			await openEditor(bob);

			const bobEntry = alice.locator('[data-collaboration-role="write"]');

			// Without the refresh every read after the first refusal fails, so the
			// roster stays empty until the four-minute reuse window ends. Poll the
			// observable consequence -- a second session resolved -- instead of
			// asserting on the roster after a fixed wait.
			await expect
				.poll(() => sessionRequests.length, {
					timeout: 30_000,
					message: 'the editor kept retrying the refused token instead of resolving a new session',
				})
				.toBeGreaterThan(sessionsBefore);

			await expect(bobEntry, 'presence stayed blind after its token expired').toContainText('Bob', {
				timeout: 10_000,
			});
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});
