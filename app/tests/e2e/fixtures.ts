import { test as base, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { E2E_ORIGIN, E2E_ROOM_COOKIE } from './e2eRoom';

/**
 * Every test execution gets its own room: both mocks key their state by the
 * room a request asks for, so a repeated or parallel run cannot inherit
 * another run's collaboration seed, saved document or ETag.
 *
 * `auto` so a test that never mentions `room` still gets one -- otherwise it
 * would fall back to the mock's process-wide default and share state again.
 */
export const test = base.extend<{ room: string }>({
	room: [
		async ({ context }, use) => {
			const room = `e2e-room-${randomUUID()}`;
			await context.addCookies([{ name: E2E_ROOM_COOKIE, value: room, url: E2E_ORIGIN }]);
			await use(room);
		},
		{ auto: true },
	],
});

/** Another context in the same test, joining the same room. */
export async function newContext(browser: Browser, room: string): Promise<BrowserContext> {
	const context = await browser.newContext();
	await context.addCookies([{ name: E2E_ROOM_COOKIE, value: room, url: E2E_ORIGIN }]);
	return context;
}
