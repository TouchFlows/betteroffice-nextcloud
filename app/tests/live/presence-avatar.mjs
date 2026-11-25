#!/usr/bin/env node
/**
 * Live two-user presence check (PLAN.md §8.6) against a *real* Nextcloud.
 *
 * The automated suites mock Nextcloud (`app/tests/e2e`), so they cannot catch
 * anything that only breaks inside it: the editor page's Content-Security-
 * Policy, the avatar route, the collaboration routes, two real accounts in one
 * room. This script is that check, made repeatable:
 *
 * - both accounts log in through Nextcloud's own login form, in separate
 *   browser contexts, as two different users;
 * - each opens the same shared document in the real editor;
 * - each must list the *other* participant with an avatar image that actually
 *   painted (non-zero `naturalWidth`) and came from Nextcloud's avatar route;
 * - the editor must reach `connected` at all -- which it cannot if the page's
 *   CSP is missing, so a CSP regression fails here too, and the message names
 *   the violation rather than just timing out.
 *
 * Everything it needs is in the environment (see docs/development.md,
 * "Running against a real Nextcloud"); it starts nothing itself, so it works
 * against a throwaway install and against a staging instance alike:
 *
 *   BETTEROFFICE_LIVE_URL            Nextcloud origin, e.g. http://127.0.0.1:8099
 *   BETTEROFFICE_LIVE_FILE_ID        id of a DOCX the two users share
 *   BETTEROFFICE_LIVE_USER           first user's id
 *   BETTEROFFICE_LIVE_PASSWORD       first user's password
 *   BETTEROFFICE_LIVE_PEER           second user's id
 *   BETTEROFFICE_LIVE_PEER_PASSWORD  second user's password
 *
 * Exit status is 0 only when every check passed.
 */

import { chromium } from '@playwright/test';

const LOGIN_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 90_000;
const PRESENCE_TIMEOUT_MS = 45_000;

function required(name) {
	const value = process.env[name];
	if (typeof value !== 'string' || value === '') {
		throw new Error(`Missing required environment variable ${name} (see docs/development.md, "Running against a real Nextcloud")`);
	}
	return value;
}

const origin = required('BETTEROFFICE_LIVE_URL').trim().replace(/\/+$/, '');
const fileId = required('BETTEROFFICE_LIVE_FILE_ID').trim();
if (!/^\d+$/.test(fileId)) {
	throw new Error(`BETTEROFFICE_LIVE_FILE_ID must be a numeric file id, got "${fileId}"`);
}

const accounts = [
	{
		label: 'first',
		user: required('BETTEROFFICE_LIVE_USER'),
		password: required('BETTEROFFICE_LIVE_PASSWORD'),
	},
	{
		label: 'second',
		user: required('BETTEROFFICE_LIVE_PEER'),
		password: required('BETTEROFFICE_LIVE_PEER_PASSWORD'),
	},
];

const failures = [];

function check(ok, message) {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
	if (!ok) failures.push(message);
}

/** The identity Nextcloud itself reports for the logged-in session. */
async function identityOf(page) {
	return page.evaluate(() => {
		const current = window.OC?.getCurrentUser?.();
		return { uid: current?.uid ?? null, displayName: current?.displayName ?? null };
	});
}

/**
 * Logs one account in, opens the document, and waits for collaboration to go
 * live. Returns the page plus everything observed about avatar requests, so
 * the caller can check the bytes really came from Nextcloud.
 */
async function openEditor(browser, account) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const avatarResponses = [];
	const cspViolations = [];

	page.on('console', (message) => {
		const text = message.text();
		if (/content[- ]security[- ]policy/i.test(text)) cspViolations.push(text.slice(0, 300));
	});
	page.on('response', (response) => {
		if (!response.url().includes('/avatar/')) return;
		avatarResponses.push({
			url: response.url(),
			status: response.status(),
			contentType: response.headers()['content-type'] ?? '',
		});
	});

	await page.goto(`${origin}/index.php/login`, { waitUntil: 'domcontentloaded' });
	await page.fill('input[name="user"]', account.user);
	await page.fill('input[name="password"]', account.password);
	await Promise.all([
		page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT_MS }),
		page.click('#submit-form, button[type="submit"]'),
	]);

	const identity = await identityOf(page);
	if (!identity.uid) {
		throw new Error(`${account.user}: Nextcloud did not report a logged-in user after the login form was submitted`);
	}

	await page.goto(`${origin}/index.php/apps/betteroffice/editor/${fileId}`, { waitUntil: 'domcontentloaded' });
	try {
		await page.waitForSelector('[data-collaboration-status="connected"]', { timeout: CONNECT_TIMEOUT_MS });
	} catch {
		const status = await page
			.locator('.betteroffice-collaboration-status')
			.getAttribute('data-collaboration-status')
			.catch(() => null);
		const csp = cspViolations.length > 0 ? ` CSP violations seen: ${cspViolations.join(' | ')}` : '';
		throw new Error(
			`${account.user}: the editor never reached "connected" (status: ${status ?? 'no status bar'}).${csp} `
			+ 'Check that the relay is running, that betteroffice relay_url points at it, and that '
			+ 'EditorContentSecurityPolicy is in place (docs/development.md).',
		);
	}

	return { context, page, identity, avatarResponses };
}

/** The other participant's entry, with the avatar image as the browser rendered it. */
async function peerAvatar(page, displayName) {
	const entry = page.locator('.betteroffice-collaboration-presence__participant', { hasText: displayName });
	await entry.waitFor({ timeout: PRESENCE_TIMEOUT_MS });
	const image = entry.locator('img.betteroffice-collaboration-presence__avatar');
	await image.waitFor({ timeout: PRESENCE_TIMEOUT_MS });

	const src = await image.getAttribute('src');
	const size = await image.evaluate((node) => ({
		complete: node.complete,
		width: node.naturalWidth,
		height: node.naturalHeight,
	}));
	return { src, ...size };
}

function avatarPath(url) {
	try {
		return new URL(url, origin).pathname;
	} catch {
		return '';
	}
}

/**
 * One direction of the check: `observer` must list `peer` with an avatar that
 * painted, whose URL is Nextcloud's own avatar route for the peer's user id.
 */
async function assertPeerAvatar(observer, peer) {
	const avatar = await peerAvatar(observer.page, peer.identity.displayName);
	console.log(`${observer.identity.uid} sees ${peer.identity.uid}:`, JSON.stringify(avatar));

	const expectedPath = `/avatar/${encodeURIComponent(peer.identity.uid)}/64`;
	check(
		avatarPath(avatar.src ?? '').endsWith(expectedPath),
		`${observer.identity.uid}'s roster uses Nextcloud's avatar route for ${peer.identity.uid} (${avatar.src})`,
	);
	check(
		avatar.complete && avatar.width > 0 && avatar.height > 0,
		`${peer.identity.uid}'s avatar painted in ${observer.identity.uid}'s editor (${avatar.width}x${avatar.height})`,
	);

	// The image element can paint from cache without a new response, so only a
	// request that *was* seen is required to have succeeded.
	const failed = observer.avatarResponses.filter(
		(response) => avatarPath(response.url) === avatarPath(avatar.src ?? '') && response.status >= 400,
	);
	check(
		failed.length === 0,
		`no avatar request failed in ${observer.identity.uid}'s session${failed.length > 0 ? `: ${JSON.stringify(failed)}` : ''}`,
	);
}

const browser = await chromium.launch();
try {
	const [firstAccount, secondAccount] = accounts;
	console.log(`opening ${origin}/index.php/apps/betteroffice/editor/${fileId} as ${firstAccount.user} and ${secondAccount.user}`);

	const first = await openEditor(browser, firstAccount);
	const second = await openEditor(browser, secondAccount);

	await assertPeerAvatar(first, second);
	await assertPeerAvatar(second, first);

	await first.context.close();
	await second.context.close();
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.log(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
