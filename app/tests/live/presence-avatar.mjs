#!/usr/bin/env node
/**
 * Live two-user presence check (PLAN.md §8.6) against a *real* Nextcloud.
 *
 * The automated suites mock Nextcloud (`app/tests/e2e`), so they cannot catch
 * anything that only breaks inside it: the editor page's Content-Security-
 * Policy, the avatar route, the collaboration routes, real share permissions,
 * two real accounts in one room. This script is that check, made repeatable:
 *
 * - both accounts log in through Nextcloud's own login form, in separate
 *   browser contexts, as two different users;
 * - each opens the same document in the real editor;
 * - each must list the *other* participant with an avatar image that actually
 *   painted (non-zero `naturalWidth`) and came from Nextcloud's avatar route;
 * - the role shown for the other participant must be the one Nextcloud's
 *   share permissions gave them: `write` for a shared-with-editing document,
 *   and `read` plus the "read-only" badge when the share is read-only;
 * - the editor must reach `connected` at all -- which it cannot if the page's
 *   CSP is missing or the relay is down, so those regressions fail here too,
 *   with the status, any CSP violation and the relay's own health named
 *   rather than just timing out.
 *
 * Everything it needs is in the environment (see docs/development.md,
 * "Running against a real Nextcloud"); it starts nothing itself, so it works
 * against a throwaway install and against a staging instance alike:
 *
 *   BETTEROFFICE_LIVE_URL                    Nextcloud origin, e.g. http://127.0.0.1:8099
 *   BETTEROFFICE_LIVE_FILE_ID                id of a DOCX the two users share with editing
 *   BETTEROFFICE_LIVE_USER                   first (owning) user's id
 *   BETTEROFFICE_LIVE_PASSWORD               first user's password
 *   BETTEROFFICE_LIVE_PEER                   second user's id
 *   BETTEROFFICE_LIVE_PEER_PASSWORD          second user's password
 *   BETTEROFFICE_LIVE_READONLY_FILE_ID       optional: id of a DOCX shared with the
 *                                            second user read-only; when set, the
 *                                            read-only badge is checked too
 *
 * Every failure is reported as a `FAIL` line and summarised at the end; the
 * exit status is 0 only when every check passed.
 */

import { chromium } from '@playwright/test';

const LOGIN_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 90_000;
const PRESENCE_TIMEOUT_MS = 45_000;
const HEALTH_TIMEOUT_MS = 2_000;

/** @type {string} */
let origin = '';
/** @type {Array<{ label: string, user: string, password: string }>} */
let accounts = [];
/** @type {Array<{ label: string, fileId: string, peerRole: 'read' | 'write' }>} */
let scenarios = [];
let readOnlyFileId = '';
let configured = false;

const failures = [];

function check(ok, message) {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
	if (!ok) failures.push(message);
}

function required(name) {
	const value = process.env[name];
	if (typeof value !== 'string' || value === '') {
		throw new Error(`Missing required environment variable ${name} (see docs/development.md, "Running against a real Nextcloud")`);
	}
	return value;
}

function fileIdFrom(name, value) {
	if (!/^\d+$/.test(value)) {
		throw new Error(`${name} must be a numeric file id, got "${value}"`);
	}
	return value;
}

/**
 * One document both accounts open. `peerRole` is the role Nextcloud's share
 * permissions give the *second* account, which is what the first account's
 * roster must report; the first account owns the document, so it is always
 * `write`.
 */
function loadConfig() {
	origin = required('BETTEROFFICE_LIVE_URL').trim().replace(/\/+$/, '');
	accounts = [
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

	scenarios = [
		{
			label: 'shared with editing',
			fileId: fileIdFrom('BETTEROFFICE_LIVE_FILE_ID', required('BETTEROFFICE_LIVE_FILE_ID').trim()),
			peerRole: 'write',
		},
	];

	readOnlyFileId = (process.env.BETTEROFFICE_LIVE_READONLY_FILE_ID ?? '').trim();
	if (readOnlyFileId !== '') {
		scenarios.push({
			label: 'shared read-only',
			fileId: fileIdFrom('BETTEROFFICE_LIVE_READONLY_FILE_ID', readOnlyFileId),
			peerRole: 'read',
		});
	}

	configured = true;
}

/** The identity Nextcloud itself reports for the logged-in session. */
async function identityOf(page) {
	return page.evaluate(() => {
		const current = window.OC?.getCurrentUser?.();
		return { uid: current?.uid ?? null, displayName: current?.displayName ?? null };
	});
}

/**
 * What the page says about the relay, and whether that relay actually
 * answers, so a timeout says which of the several possible causes it is.
 */
async function relayDiagnosis(page) {
	const relayUrl = await page
		.locator('#betteroffice-editor')
		.getAttribute('data-relay-url')
		.catch(() => null);
	if (relayUrl === null || relayUrl === '') {
		return 'The page carries no relay URL (data-relay-url): set betteroffice relay_url.';
	}

	const httpOrigin = relayUrl.trim().replace(/\/+$/, '').replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
	try {
		const response = await fetch(`${httpOrigin}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
		return response.ok
			? `The relay at ${httpOrigin} answers /health, so the page is not reaching it: check the relay's BETTEROFFICE_RELAY_ALLOWED_ORIGIN and the editor page's Content-Security-Policy.`
			: `The relay at ${httpOrigin} answered /health with HTTP ${response.status}.`;
	} catch {
		return `The relay at ${httpOrigin} did not answer /health — is it running?`;
	}
}

/**
 * Logs one account in, opens the document, and waits for collaboration to go
 * live. Returns the page plus everything observed about avatar requests, so
 * the caller can check the bytes really came from Nextcloud.
 */
async function openEditor(browser, account, fileId) {
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
		await context.close();
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
		const diagnosis = await relayDiagnosis(page);
		await context.close();
		throw new Error(
			`${account.user}: the editor for file ${fileId} never reached "connected" (status: ${status ?? 'no status bar'}).${csp} ${diagnosis}`,
		);
	}

	return { context, page, identity, avatarResponses };
}

function avatarPath(url) {
	try {
		return new URL(url, origin).pathname;
	} catch {
		return '';
	}
}

/**
 * One direction of the check: `observer` must list `peer` with the role
 * Nextcloud's permissions gave them, and with an avatar that painted from
 * Nextcloud's own avatar route.
 */
async function assertPeer(observer, peer, expectedRole) {
	const entry = observer.page.locator('.betteroffice-collaboration-presence__participant', {
		hasText: peer.identity.displayName,
	});
	try {
		await entry.waitFor({ timeout: PRESENCE_TIMEOUT_MS });
	} catch {
		check(false, `${observer.identity.uid}'s roster never listed ${peer.identity.uid} (${peer.identity.displayName})`);
		return;
	}

	const role = await entry.getAttribute('data-collaboration-role');
	check(
		role === expectedRole,
		`${observer.identity.uid} sees ${peer.identity.uid} as ${expectedRole} (reported ${role})`,
	);

	const badge = entry.locator('.betteroffice-collaboration-presence__role');
	const badges = await badge.count();
	if (expectedRole === 'read') {
		const text = badges > 0 ? (await badge.innerText()).trim() : '';
		check(text === 'read-only', `${peer.identity.uid} carries the "read-only" badge in ${observer.identity.uid}'s roster (${text || 'no badge'})`);
	} else {
		check(badges === 0, `${peer.identity.uid} carries no "read-only" badge in ${observer.identity.uid}'s roster`);
	}

	const image = entry.locator('img.betteroffice-collaboration-presence__avatar');
	try {
		await image.waitFor({ timeout: PRESENCE_TIMEOUT_MS });
	} catch {
		check(false, `${peer.identity.uid} was listed in ${observer.identity.uid}'s roster without an avatar image`);
		return;
	}
	const src = await image.getAttribute('src');
	const size = await image.evaluate((node) => ({
		complete: node.complete,
		width: node.naturalWidth,
		height: node.naturalHeight,
	}));
	console.log(`${observer.identity.uid} sees ${peer.identity.uid}:`, JSON.stringify({ src, role, ...size }));

	check(
		avatarPath(src ?? '').endsWith(`/avatar/${encodeURIComponent(peer.identity.uid)}/64`),
		`${observer.identity.uid}'s roster uses Nextcloud's avatar route for ${peer.identity.uid} (${src})`,
	);
	check(
		size.complete && size.width > 0 && size.height > 0,
		`${peer.identity.uid}'s avatar painted in ${observer.identity.uid}'s editor (${size.width}x${size.height})`,
	);

	// The image element can paint from cache without a new response, so only a
	// request that *was* seen is required to have succeeded.
	const failed = observer.avatarResponses.filter(
		(response) => avatarPath(response.url) === avatarPath(src ?? '') && response.status >= 400,
	);
	check(
		failed.length === 0,
		`no avatar request failed in ${observer.identity.uid}'s session${failed.length > 0 ? `: ${JSON.stringify(failed)}` : ''}`,
	);
}

async function run() {
	const browser = await chromium.launch();
	try {
		for (const scenario of scenarios) {
			console.log(`\n[${scenario.label}] ${origin}/index.php/apps/betteroffice/editor/${scenario.fileId} as ${accounts[0].user} and ${accounts[1].user}`);

			const first = await openEditor(browser, accounts[0], scenario.fileId);
			const second = await openEditor(browser, accounts[1], scenario.fileId);
			try {
				await assertPeer(first, second, scenario.peerRole);
				await assertPeer(second, first, 'write');
			} finally {
				await first.context.close();
				await second.context.close();
			}
		}
	} finally {
		await browser.close();
	}
}

try {
	loadConfig();
	await run();
} catch (error) {
	// A hard failure (no login, editor never live, a bad env var) is reported
	// as one FAIL line and summarised with everything else, not as a stack.
	const message = error instanceof Error ? error.message : String(error);
	check(false, message);
}

if (configured && readOnlyFileId === '') {
	console.log('\nSKIP the read-only badge: set BETTEROFFICE_LIVE_READONLY_FILE_ID to a document shared read-only with the second user.');
}

if (failures.length > 0) {
	console.log(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
