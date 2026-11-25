import { expect } from '@playwright/test';
import { EDITOR_PATH, tokenExpiry } from './editorDriver';
import { test } from './fixtures';

/**
 * The relay verifies a token's `exp` when a connection is admitted, and the
 * app issues five-minute tokens (`RoomService::TOKEN_TTL_SECONDS`). A
 * reconnect after that must ask for a new token: reusing the one the editor
 * opened with leaves every attempt rejected, and the editor stuck on
 * "Reconnecting…" forever.
 */
test.describe('docx: reconnect after the token expires', () => {
	test('a reconnect after the token expires asks for a fresh one and rejoins', async ({ page, request, room }) => {
		test.setTimeout(120_000);

		// Short-lived tokens, so "expired" is reachable inside a test.
		await request.post(`/__test__/token-ttl?seconds=5&room=${room}`);

		// Record every WebSocket the page opens: the drop is then simulated from
		// the page itself (indistinguishable from a network drop) and each
		// attempt's token can be inspected. Only `/room/...` sockets are the
		// relay's -- Vite's own dev client opens one too, with a `token` of its
		// own, so filtering on the path is what keeps this test about ours.
		await page.addInitScript(() => {
			const sockets: WebSocket[] = [];
			(window as unknown as { __testSockets: WebSocket[] }).__testSockets = sockets;
			const Native = window.WebSocket;
			class TrackingWebSocket extends Native {
				constructor(url: string | URL, protocols?: string | string[]) {
					super(url, protocols);
					sockets.push(this);
				}
			}
			(window as unknown as { WebSocket: typeof WebSocket }).WebSocket = TrackingWebSocket;
		});

		await page.goto(EDITOR_PATH);
		await expect(page.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });

		const firstToken = await page.evaluate(() => {
			const socket = (window as unknown as { __testSockets: WebSocket[] }).__testSockets.filter(
				(candidate) => new URL(candidate.url).pathname.startsWith('/room/'),
			)[0];
			return socket ? new URL(socket.url).searchParams.get('token') : null;
		});
		expect(firstToken, 'the editor did not connect with a collaboration token').toBeTruthy();

		// Let that token actually expire, as it would five minutes into a session.
		await expect
			.poll(() => Math.floor(Date.now() / 1000) > tokenExpiry(firstToken!), { timeout: 20_000 })
			.toBe(true);

		await page.evaluate(() => {
			const roomSockets = (window as unknown as { __testSockets: WebSocket[] }).__testSockets.filter(
				(candidate) => new URL(candidate.url).pathname.startsWith('/room/'),
			);
			roomSockets.at(-1)!.close();
		});
		await expect(page.locator('[data-collaboration-status="connected"]')).toHaveCount(0, { timeout: 10_000 });

		// The client reconnects -- and must do so with a *new* token, because the
		// expired one is rejected by the relay.
		await expect
			.poll(
				async () =>
					page.evaluate(
						() =>
							(window as unknown as { __testSockets: WebSocket[] }).__testSockets.filter(
								(candidate) => new URL(candidate.url).pathname.startsWith('/room/'),
							).length,
					),
				{ timeout: 30_000 },
			)
			.toBeGreaterThan(1);
		const tokens = await page.evaluate(() =>
			(window as unknown as { __testSockets: WebSocket[] }).__testSockets
				.filter((candidate) => new URL(candidate.url).pathname.startsWith('/room/'))
				.map((socket) => new URL(socket.url).searchParams.get('token')),
		);
		expect(tokens.at(-1), 'the reconnect reused the expired token').not.toBe(firstToken);

		// And it actually got back in, rather than sitting on "Reconnecting…".
		await expect(page.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });
	});
});
