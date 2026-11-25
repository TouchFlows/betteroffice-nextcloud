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
 * The refusal comes from revoking the room's tokens
 * (`POST /__test__/revoke-token`, mockCollaborationApi.ts) rather than from
 * waiting out a short lifetime: the relay refuses a withdrawn token exactly as
 * it refuses an expired one, so the test costs one presence refresh instead of
 * a five-second expiry plus however the refresh loop then lined up with it.
 */
test.describe('docx: presence token refresh', () => {
	test('a token the relay refuses is replaced instead of retried', async ({ browser, request, room }) => {
		test.setTimeout(120_000);

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
			await openEditor(bob);
			const sessionsBefore = sessionRequests.length;

			// Withdraw the tokens this room has been issued. Presence is reusing
			// one of them, and the relay now refuses it.
			const revoked = await request.post(`/__test__/revoke-token?room=${room}`);
			expect(revoked.status(), 'the harness could not revoke the room’s tokens').toBe(204);

			// Without the refresh every read after the refusal fails, so the
			// roster stays empty until the four-minute reuse window ends. Poll the
			// observable consequence -- a second session resolved -- instead of
			// asserting on the roster after a fixed wait.
			await expect
				.poll(() => sessionRequests.length, {
					timeout: 20_000,
					message: 'the editor kept retrying the refused token instead of resolving a new session',
				})
				.toBeGreaterThan(sessionsBefore);

			await expect(
				alice.locator('[data-collaboration-role="write"]'),
				'presence stayed blind after the relay refused its token',
			).toContainText('Bob', { timeout: 10_000 });
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});
