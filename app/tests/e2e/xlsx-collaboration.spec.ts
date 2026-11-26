import { expect } from '@playwright/test';
import { E2E_ORIGIN } from './e2eRoom';
import { newContext, test } from './fixtures';
import { appendToTitle, openXlsxEditor, workbookHasText, writeRefusal } from './xlsxDriver';

/**
 * XLSX collaboration, end to end: two independent browser sessions open the
 * same workbook in the real `XlsxEditorApp`, connect through the real relay
 * backed by a real MariaDB, and converge.
 *
 * This is the format-specific half of the wiring the DOCX and PPTX specs
 * cover. The spreadsheet's async editor never calls
 * `collaboration.onReplica`; the host reads the replica from
 * `onReady(api).collaboration` and adapts it with
 * `createAsyncCollaborationReplica` before handing it to the provider
 * (poc/RECONNAISSANCE.md §3). An editor wired the DOCX way still opens and
 * still saves -- it just never connects -- so this spec asserts convergence
 * and presence, not merely that the editor rendered.
 *
 * Only Nextcloud is mocked (`mockDocumentApi.ts`, `mockCollaborationApi.ts`),
 * as in the other collaboration specs: no live Nextcloud exists here.
 */
test.describe('xlsx: two browsers through the real relay', () => {
	test('cell text and presence converge between two sessions', async ({ browser, room }) => {
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
			await openXlsxEditor(alice);

			// Alice edits before Bob joins, so Bob's copy can only come from
			// the seed plus the relay's persisted state.
			await appendToTitle(alice, '[from-alice]');
			await expect.poll(() => workbookHasText(alice, '[from-alice]'), { timeout: 20_000 }).toBe(true);

			await openXlsxEditor(bob);
			await expect.poll(() => workbookHasText(bob, '[from-alice]'), { timeout: 30_000 }).toBe(true);

			// And a live update the other way, from Bob into Alice's already-open
			// editor.
			await appendToTitle(bob, '[from-bob]');
			await expect.poll(() => workbookHasText(alice, '[from-bob]'), { timeout: 20_000 }).toBe(true);
			expect(await workbookHasText(bob, '[from-bob]')).toBe(true);

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
			await openXlsxEditor(writer);
			// `readOnly` is what the page passes for a file the user may not
			// update; the viewer joins the same room regardless, and the mock
			// session endpoint signs it a `read` token.
			await openXlsxEditor(viewer, { readOnly: true });

			// A live edit by the writer reaches the viewer, so the share is
			// useful rather than merely connected.
			await appendToTitle(writer, '[for-viewer]');
			await expect.poll(() => workbookHasText(viewer, '[for-viewer]'), { timeout: 30_000 }).toBe(true);

			// The viewer's own edits are refused by the editor, with its own
			// code -- not by a hidden button.
			expect(await writeRefusal(viewer, '[from-viewer]')).toBe('read-only');
			expect(await workbookHasText(viewer, '[from-viewer]')).toBe(false);
			expect(await workbookHasText(writer, '[from-viewer]')).toBe(false);

			// No save affordance, and a save gesture anyway writes nothing.
			await expect(viewer.getByRole('button', { name: /^Save$/ })).toHaveCount(0);
			await viewer.keyboard.press('ControlOrMeta+s');
			await viewer.waitForTimeout(1_500);
			await expect(viewer.locator('.betteroffice-save-status--saved')).toHaveCount(0);
			const state = (await (await request.get(`/__test__/document-state?room=${room}&fileId=2`)).json()) as {
				saved: boolean;
			};
			expect(state.saved).toBe(false);

			// And the writer sees the viewer as a read-only participant, from the
			// role the server signed -- the same roster path the two-writer spec
			// asserts.
			await expect(writer.locator('[data-collaboration-role="read"]')).toContainText('Carol', {
				timeout: 30_000,
			});

			// The regression this spec was written for. The spreadsheet provider
			// publishes a whole-state update when it joins, which the relay refuses
			// from a read token by closing the socket (1008) -- so before the
			// transport dropped those frames, the viewer was disconnected and
			// reconnected about once a second: it flickered in and out of the
			// roster and only caught up between reconnects. A viewer that is in the
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
});
