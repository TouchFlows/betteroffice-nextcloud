import { randomUUID } from 'node:crypto';

/**
 * Each test execution gets its own room, so a repeated or parallel run cannot
 * inherit another run's state. The harness sets `E2E_ROOM_COOKIE` on every
 * context it opens (`fixtures.ts`), and both mocks key what they keep -- the
 * collaboration seed and token lifetime, the document's saved bytes and ETag
 * -- by the room a request asks for.
 *
 * A cookie rather than a header on purpose: the presence roster is fetched
 * cross-origin from the relay, and a custom header would make that request
 * non-simple, so the browser would preflight it and the relay would refuse it.
 */
export const E2E_ROOM_COOKIE = 'betteroffice-e2e-room';

/** Matches playwright.config.ts's baseURL; needed as an absolute cookie origin. */
export const E2E_ORIGIN = 'http://localhost:5184';

/** Only for a request that names no room at all (Vite's own dev client, say). */
export const DEFAULT_E2E_ROOM_ID = `e2e-room-default-${randomUUID()}`;

/** The value of `E2E_ROOM_COOKIE` in a Cookie header, if it carries one. */
export function roomCookieValue(cookieHeader: string | undefined): string | null {
	const prefix = `${E2E_ROOM_COOKIE}=`;
	const cookie = (cookieHeader ?? '')
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(prefix));
	const value = cookie?.slice(prefix.length).trim() ?? '';
	return value === '' ? null : value;
}
