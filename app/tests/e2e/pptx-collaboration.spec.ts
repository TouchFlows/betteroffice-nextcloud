import { expect } from '@playwright/test';
import { E2E_ORIGIN } from './e2eRoom';
import { newContext, test } from './fixtures';
import { appendToTitle, deckHasText, openPptxEditor, writeRefusal } from './pptxDriver';

/**
 * PPTX collaboration, end to end: two independent browser sessions open the
 * same deck in the real `PptxEditorApp`, connect through the real relay backed
 * by a real MariaDB, and converge.
 *
 * This is the format-specific half of the wiring that the DOCX specs cover:
 * the presentation package hands its replica over through `onReplica` typed as
 * an `AsyncCollaborationReplica` (no adapter), its provider takes that
 * directly, and its roster arrives through `onPresence`
 * (poc/RECONNAISSANCE.md §3). The transport and the status/presence chrome are
 * shared modules, tested here through this format rather than re-implemented.
 *
 * Only Nextcloud is mocked (`mockDocumentApi.ts`, `mockCollaborationApi.ts`),
 * as in the DOCX specs: no live Nextcloud exists in this environment.
 */
test.describe('pptx: two browsers through the real relay', () => {
	test('deck text and presence converge between two sessions', async ({ browser, room }) => {
		test.setTimeout(180_000);

		const aliceContext = await newContext(browser, room);
		const bobContext = await newContext(browser, room);
		// Two distinguishable participants: the relay marks an entry `self` by
		// comparing the token's subject with the reader's, so two sessions with
		// the same identity would each filter the other out of their roster.
		await bobContext.addCookies([{ name: 'betteroffice-e2e-user', value: 'Bob', url: E2E_ORIGIN }]);
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await openPptxEditor(alice);

			// Alice edits before Bob joins, so Bob's copy can only come from the
			// seed plus the relay's persisted state.
			await appendToTitle(alice, ' [from-alice]');
			await expect.poll(() => deckHasText(alice, '[from-alice]'), { timeout: 20_000 }).toBe(true);

			await openPptxEditor(bob);
			await expect.poll(() => deckHasText(bob, '[from-alice]'), { timeout: 30_000 }).toBe(true);

			// And a live update the other way, from Bob into Alice's already-open
			// editor.
			await appendToTitle(bob, ' [from-bob]');
			await expect.poll(() => deckHasText(alice, '[from-bob]'), { timeout: 20_000 }).toBe(true);
			expect(await deckHasText(bob, '[from-bob]')).toBe(true);

			// Presence (PLAN.md §8.6): awareness triggers the roster, but the
			// identity shown is the one the relay signed into each participant's
			// token -- so the display name and role must be Bob's, not whatever a
			// browser chose to call itself in its awareness payload.
			await expect(alice.locator('[data-collaboration-peers]')).toHaveAttribute(
				'data-collaboration-peers',
				'1',
				{ timeout: 30_000 },
			);
			const bobEntry = alice.locator('[data-collaboration-role="write"]');
			await expect(bobEntry).toContainText('Bob', { timeout: 30_000 });
			await expect(alice.locator('[data-collaboration-presence]')).toHaveAttribute(
				'data-collaboration-presence',
				'1',
				{ timeout: 30_000 },
			);
			// The avatar is the URL the token carries, served by the same mock
			// Nextcloud the token's other claims come from.
			await expect
				.poll(() => bobEntry
							.locator('.betteroffice-collaboration-presence__avatar')
							.evaluate((image: HTMLImageElement) => image.naturalWidth),
					{ timeout: 30_000 },
				)
				.toBeGreaterThan(0);
			await expect(bob.locator('[data-collaboration-role="write"]')).toContainText('Alice', {
				timeout: 30_000,
			});
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});

	/**
	 * The role half of the same wiring. A viewer in the room is what makes the
	 * server-issued role mean something: it must receive the writer's edits (so
	 * a share marked read-only is still useful), and it must not be able to
	 * write -- neither through the editor it was given, nor into the file.
	 *
	 * Three separate things are asserted, because each can fail on its own: the
	 * editor refuses the edit with its own `read-only` code, it offers no save
	 * affordance, and a save gesture never reaches the document API. A viewer
	 * that merely hid the toolbar would pass the first half of this spec.
	 *
	 * The last assertion is the reason this spec is not only about roles. The
	 * presentation provider answers the room's handshake with a SyncStep2, which
	 * the relay drops silently for a read token; the spreadsheet provider sends
	 * a whole-state *update* instead, which the relay refuses by closing the
	 * socket (1008), and that used to evict its viewer about once a second
	 * (xlsx-collaboration.spec.ts). Zero closes here pins that this format does
	 * not need the transport's `publishUpdates` option, so a later change that
	 * starts sending an update from a viewer fails loudly rather than only
	 * showing up as a flickering roster.
	 */
	test('a read-only viewer receives the writer\'s edits and cannot write', async ({ browser, room, request }) => {
		test.setTimeout(180_000);

		const writerContext = await newContext(browser, room);
		const viewerContext = await newContext(browser, room);
		// `betteroffice-e2e-role=read` is what the mock's session endpoint signs
		// into the token, standing in for the server's own permission check.
		await viewerContext.addCookies([
			{ name: 'betteroffice-e2e-role', value: 'read', url: E2E_ORIGIN },
			{ name: 'betteroffice-e2e-user', value: 'Carol', url: E2E_ORIGIN },
		]);
		// Every close of the viewer's relay socket, so the spec can prove the
		// session is stable rather than merely connected at one instant.
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
			(window as unknown as { WebSocket: typeof WebSocket }).WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
		});
		const writer = await writerContext.newPage();
		const viewer = await viewerContext.newPage();

		try {
			await openPptxEditor(writer);
			// `readOnly` is what the page passes for a file the user may not
			// update; the viewer joins the same room regardless, and the mock
			// session endpoint signs it a `read` token.
			await openPptxEditor(viewer, { readOnly: true });

			// A live edit by the writer reaches the viewer, so the share is
			// useful rather than merely connected.
			await appendToTitle(writer, ' [for-viewer]');
			await expect.poll(() => deckHasText(viewer, '[for-viewer]'), { timeout: 30_000 }).toBe(true);

			// The viewer's own edits are refused by the editor, with its own
			// code -- not by a hidden button.
			expect(await writeRefusal(viewer, ' [from-viewer]')).toBe('read-only');
			expect(await deckHasText(viewer, '[from-viewer]')).toBe(false);
			expect(await deckHasText(writer, '[from-viewer]')).toBe(false);

			// No save affordance, and a save gesture anyway writes nothing.
			await expect(viewer.getByRole('button', { name: /^Save$/ })).toHaveCount(0);
			await viewer.keyboard.press('ControlOrMeta+s');
			await viewer.waitForTimeout(1_500);
			await expect(viewer.locator('.betteroffice-save-status--saved')).toHaveCount(0);
			const state = (await (await request.get(`/__test__/document-state?room=${room}&fileId=3`)).json()) as {
				saved: boolean;
			};
			expect(state.saved).toBe(false);

			// And the writer sees the viewer as a read-only participant, from the
			// role the server signed -- the same roster path the two-writer spec
			// asserts.
			await expect(writer.locator('[data-collaboration-role="read"]')).toContainText('Carol', {
				timeout: 30_000,
			});

			// The viewer must keep the socket it opened: a viewer that is in the
			// room must not be thrown out by its own handshake.
			const closes = await viewer.evaluate(() =>
				(window as unknown as { __testSocketCloses: Array<{ code: number; reason: string; url: string }> })
					.__testSocketCloses.filter((close) => new URL(close.url).pathname.startsWith('/room/')),
			);
			expect(closes, `the viewer's relay socket was closed: ${JSON.stringify(closes)}`).toEqual([]);
		} finally {
			await writerContext.close();
			await viewerContext.close();
		}
	});

	/**
	 * The same role, from a client that ignores it. The spec above opens the
	 * page's real read-only path (`readOnly=1`), where the editor refuses the
	 * edit itself -- which proves the editor behaves, not that the role is
	 * enforced. Here the session is signed a `read` token but the editor is
	 * opened writable, so the edit really happens and something else has to
	 * stop it.
	 *
	 * For the presentation that something is the relay, exactly as for DOCX:
	 * nothing here suppresses a viewer's updates (`PptxEditorApp` passes no
	 * `publishUpdates`, unlike `XlsxEditorApp`), because the provider's handshake
	 * reply is already dropped for a read token. So the edit goes onto the wire
	 * and `1008` is what has to stop it. Adding `publishUpdates` to this format
	 * would leave the close list empty -- that is the guard this test pins.
	 */
	test('a writable editor on a read token is refused by the relay', async ({ browser, room }) => {
		test.setTimeout(180_000);

		const writerContext = await newContext(browser, room);
		const viewerContext = await newContext(browser, room);
		// The mock's session endpoint signs `read` into this context's token.
		await viewerContext.addCookies([
			{ name: 'betteroffice-e2e-role', value: 'read', url: E2E_ORIGIN },
			{ name: 'betteroffice-e2e-user', value: 'Mallory', url: E2E_ORIGIN },
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
			(window as unknown as { WebSocket: typeof WebSocket }).WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
		});
		const writer = await writerContext.newPage();
		const viewer = await viewerContext.newPage();

		try {
			await openPptxEditor(writer);
			await appendToTitle(writer, ' [from-writer]');

			// No `readOnly`: this is the client that ignores the role it was
			// signed. It still receives the writer's state, so the share is
			// useful -- which is what makes the negative assertion below mean
			// something rather than merely "nothing connected".
			await openPptxEditor(viewer);
			await expect.poll(() => deckHasText(viewer, '[from-writer]'), { timeout: 30_000 }).toBe(true);

			await appendToTitle(viewer, ' [from-hostile]');
			// The edit really landed in the viewer's own deck, so it is the
			// writer's copy that shows the relay refused it.
			await expect.poll(() => deckHasText(viewer, '[from-hostile]'), { timeout: 20_000 }).toBe(true);

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
			expect(await deckHasText(writer, '[from-hostile]')).toBe(false);
		} finally {
			await writerContext.close();
			await viewerContext.close();
		}
	});
});
