import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_RELAY_URL } from './testRelay';

/**
 * The real thing, end to end: two independent browser sessions open the same
 * document in the real `EditorApp`, connect through a real relay process
 * (started by playwright.config.ts) backed by a real MariaDB, edit it, and
 * converge -- and either one can save the merged result.
 *
 * Only Nextcloud itself is mocked (mockDocumentApi.ts and
 * mockCollaborationApi.ts stand in for DocumentController and
 * CollaborationController, which need a live Nextcloud this environment does
 * not have). The collaboration path under test -- EditorApp's session/seed
 * handshake, WsCollaborationTransport, CollaborationProvider, the relay's
 * sync/awareness protocol and its persistence -- is real.
 *
 * The edit driver reads and edits the document through the editor's own
 * imperative handle, the same way poc/tests/docx.collab.spec.ts does: the
 * editor paints to a canvas, so its content cannot be asserted from the DOM,
 * and driving it by keystrokes would make convergence depend on caret
 * placement rather than on the collaboration wiring this test is about.
 */

const DOCUMENT_PATH = '/index.php/apps/betteroffice/document/1';
const EDITOR_PATH = `/?fileId=1&fileName=demo.docx&relayUrl=${encodeURIComponent(TEST_RELAY_URL)}`;
// Matches playwright.config.ts's baseURL; needed as an absolute origin to
// scope a browser context's cookie to the harness.
const ORIGIN = 'http://localhost:5184';

interface ParagraphRead {
	ok: boolean;
	version: string;
	paragraphs: Array<{ paraId: string; text: string }>;
}

async function readFirstParagraph(page: Page): Promise<ParagraphRead | null> {
	return page.evaluate(() => {
		const ref = (window as unknown as { __betteroffice?: { editorRef?: { current?: unknown } } })
			.__betteroffice?.editorRef?.current as { readParagraphs?: (options: unknown) => unknown } | undefined;
		if (!ref || typeof ref.readParagraphs !== 'function') return null;
		try {
			return ref.readParagraphs({ view: 'accepted' }) as ParagraphRead;
		} catch {
			return null;
		}
	});
}

/** Waits until the editor's handle is live and has actually opened the document. */
async function waitForEditor(page: Page): Promise<void> {
	await expect
		.poll(async () => (await readFirstParagraph(page))?.ok ?? false, { timeout: 30_000 })
		.toBe(true);
}

async function firstParagraphText(page: Page): Promise<string> {
	const read = await readFirstParagraph(page);
	expect(read?.ok, 'the editor handle did not return a readable document').toBe(true);
	return read!.paragraphs[0].text;
}

async function appendText(page: Page, text: string): Promise<void> {
	const read = await readFirstParagraph(page);
	expect(read?.ok, 'the editor handle did not return a readable document').toBe(true);
	const first = read!.paragraphs[0];
	const result = await page.evaluate(
		({ version, paraId, text }) => {
			const ref = (window as unknown as { __betteroffice: { editorRef: { current: any } } })
				.__betteroffice.editorRef.current;
			return ref.applyEdits({
				expectVersion: version,
				steps: [{ op: 'insertText', target: { kind: 'paragraph', story: 'body', paraId }, at: 'end', text }],
			});
		},
		{ version: read!.version, paraId: first.paraId, text },
	);
	expect(result.ok, `applyEdits failed: ${JSON.stringify(result)}`).toBe(true);
}

/** Opens the editor and waits until its collaboration session is live and synced. */
async function openEditor(page: Page): Promise<void> {
	await page.goto(EDITOR_PATH);
	await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });
	await waitForEditor(page);
}

async function saveThroughApp(page: Page): Promise<void> {
	// The editor captures keyboard input through this hidden proxy textbox;
	// without focus the shortcut never reaches its own handler.
	await page.getByRole('textbox', { name: 'Document input' }).focus();
	await page.keyboard.press('ControlOrMeta+s');
	await expect(page.locator('.betteroffice-save-status--saved')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.betteroffice-save-status--error')).toHaveCount(0);
	await expect(page.locator('.betteroffice-save-status--conflict')).toHaveCount(0);
}

/** The `exp` claim of a collaboration token, in Unix seconds. */
function tokenExpiry(token: string): number {
	const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: number };
	return payload.exp;
}

/** Reads what was actually written to the (mock) Nextcloud file and unzips its body. */
async function savedDocumentXml(request: APIRequestContext): Promise<string> {
	const response = await request.get(DOCUMENT_PATH);
	expect(response.ok()).toBe(true);
	const bytes = await response.body();

	const dir = mkdtempSync(join(tmpdir(), 'bo-collab-save-'));
	try {
		const path = join(dir, 'saved.docx');
		writeFileSync(path, bytes);
		return execFileSync('unzip', ['-p', path, 'word/document.xml']).toString('utf8');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test.describe('docx: two browsers through the real relay', () => {
	test('edits converge in both sessions and either session can save the merged document', async ({
		browser,
		request,
	}) => {
		test.setTimeout(180_000);

		// Explicit, not order-dependent: the reconnect test lowers this.
		await request.post('/__test__/token-ttl?seconds=300');

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await openEditor(alice);
			const baseline = await firstParagraphText(alice);

			// Alice's edit must reach Bob as a *live* update, not via a save:
			// Bob joins afterwards and gets the relay's persisted state.
			await appendText(alice, ' [from-alice]');

			await openEditor(bob);
			await expect.poll(() => firstParagraphText(bob), { timeout: 20_000 }).toContain('[from-alice]');
			expect(await firstParagraphText(bob)).not.toContain('[from-bob]');

			await appendText(bob, ' [from-bob]');
			await expect.poll(() => firstParagraphText(alice), { timeout: 20_000 }).toContain('[from-bob]');

			// Both replicas now hold the same merged paragraph, and it is not
			// what either started from.
			const aliceText = await firstParagraphText(alice);
			const bobText = await firstParagraphText(bob);
			expect(aliceText).toBe(bobText);
			expect(aliceText).not.toBe(baseline);

			// Saving is a real save through EditorApp's own path, and the
			// bytes on the "server" are a real DOCX: unzip it and check that
			// both peers' edits are in the document body itself.
			await saveThroughApp(alice);
			let documentXml = await savedDocumentXml(request);
			expect(documentXml).toContain('from-alice');
			expect(documentXml).toContain('from-bob');

			// The other session can save the same merged result too: reload
			// (a fresh ETag, since Alice's save moved it) and save again.
			await bob.reload();
			await expect(bob.getByRole('menuitem', { name: 'File' })).toBeVisible({ timeout: 30_000 });
			await expect(bob.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });
			await waitForEditor(bob);
			await saveThroughApp(bob);

			documentXml = await savedDocumentXml(request);
			expect(documentXml).toContain('from-alice');
			expect(documentXml).toContain('from-bob');
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});

	/**
	 * The relay verifies a token's `exp` when a connection is admitted, and the
	 * app issues five-minute tokens (`RoomService::TOKEN_TTL_SECONDS`). A
	 * reconnect after that must ask for a new token: reusing the one the editor
	 * opened with leaves every attempt rejected, and the editor stuck on
	 * "Reconnecting…" forever.
	 */
	test('a reconnect after the token expires asks for a fresh one and rejoins', async ({ page, request }) => {
		test.setTimeout(120_000);

		// Short-lived tokens, so "expired" is reachable inside a test.
		await request.post('/__test__/token-ttl?seconds=5');

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

/**
 * Opening a document resolves a collaboration session once, to seed the room.
 * The provider's first connection must reuse that session's token rather than
 * asking for a second one moments later; only a reconnect -- which can come
 * after the token expired -- needs a fresh token.
 */
test.describe('docx: collaboration session lifecycle', () => {
	test('the first connection reuses the session resolved for the seed', async ({ page, request }) => {
		await request.post('/__test__/token-ttl?seconds=300');

		const sessionRequests: string[] = [];
		page.on('request', (outgoing) => {
			if (outgoing.method() === 'POST' && outgoing.url().includes('/apps/betteroffice/collab/session/')) {
				sessionRequests.push(outgoing.url());
			}
		});

		await openEditor(page);

		expect(
			sessionRequests,
			'the first connection asked for a second collaboration session instead of reusing the one the seed handshake resolved',
		).toHaveLength(1);
	});
});

/**
 * PLAN.md §8.5/§13: the role in the collaboration token is enforced by the
 * relay, not by the editor UI -- a client that ignores its read-only role must
 * still be unable to change the document. The viewer here is exactly such a
 * client: it opens with a read-only token but a writable editor, so its edit is
 * really sent, and the relay is what has to stop it.
 */
test.describe('docx: read-only participant', () => {
	test('a viewer receives the document and the relay rejects its edit', async ({ browser, request }) => {
		test.setTimeout(120_000);

		await request.post('/__test__/token-ttl?seconds=300');

		const writerContext = await browser.newContext();
		const viewerContext = await browser.newContext();
		// The real app derives the role and display name from the user's file
		// permissions and account; the mock has no Nextcloud to consult, so
		// per-context cookies tell it which of these two sessions is the
		// read-only viewer, and who they are (PLAN.md §8.6).
		await viewerContext.addCookies([
			{ name: 'betteroffice-e2e-role', value: 'read', url: ORIGIN },
			{ name: 'betteroffice-e2e-user', value: 'Bob', url: ORIGIN },
		]);
		// A rejection is the relay closing this viewer's socket, and the close
		// code is the only place that is observable from the page.
		await viewerContext.addInitScript(() => {
			const closes: Array<{ code: number; reason: string; url: string }> = [];
			(window as unknown as { __testSocketCloses: typeof closes }).__testSocketCloses = closes;
			const Native = window.WebSocket;
			class TrackingWebSocket extends Native {
				constructor(url: string | URL, protocols?: string | string[]) {
					super(url, protocols);
					this.addEventListener('close', (event) => {
						closes.push({ code: event.code, reason: event.reason, url: String(url) });
					});
				}
			}
			(window as unknown as { WebSocket: typeof WebSocket }).WebSocket = TrackingWebSocket;
		});

		const writer = await writerContext.newPage();
		const viewer = await viewerContext.newPage();

		try {
			await openEditor(writer);
			const baseline = await firstParagraphText(writer);
			await appendText(writer, ' [from-writer]');

			// The viewer's seed predates the writer's edit, so seeing it can only
			// mean the relay delivered the update to a read-only token.
			await openEditor(viewer);
			await expect.poll(() => firstParagraphText(viewer), { timeout: 20_000 }).toContain('[from-writer]');

			// Presence (PLAN.md §8.6): each side lists the *other* participant
			// with the display name and role signed into that participant's
			// token, and renders the avatar the token carries.
			const bob = writer.locator('[data-collaboration-role="read"]');
			await expect(bob).toContainText('Bob', { timeout: 20_000 });
			await expect(writer.locator('[data-collaboration-presence]')).toHaveAttribute('data-collaboration-presence', '1');
			await expect(viewer.locator('[data-collaboration-role="write"]')).toContainText('Alice', {
				timeout: 20_000,
			});
			await expect
				.poll(
					() =>
						bob
							.locator('.betteroffice-collaboration-presence__avatar')
							.evaluate((image: HTMLImageElement) => image.naturalWidth),
					{ timeout: 20_000 },
				)
				.toBeGreaterThan(0);

			await appendText(viewer, ' [from-viewer]');
			expect(await firstParagraphText(viewer), 'the viewer never attempted an edit').toContain('[from-viewer]');

			await expect
				.poll(
					() =>
						viewer.evaluate(() =>
							(window as unknown as { __testSocketCloses: Array<{ code: number; url: string }> })
								.__testSocketCloses.filter((close) => new URL(close.url).pathname.startsWith('/room/'))
								.map((close) => close.code),
						),
					{ timeout: 20_000 },
				)
				.toContain(1008);

			// Rejected means it never reached the room.
			await writer.waitForTimeout(1_000);
			expect(await firstParagraphText(writer)).not.toContain('[from-viewer]');
			expect(await firstParagraphText(writer)).toContain('[from-writer]');
			expect(baseline).not.toContain('[from-writer]');
		} finally {
			await writerContext.close();
			await viewerContext.close();
		}
	});
});
