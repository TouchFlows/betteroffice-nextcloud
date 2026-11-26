import { expect } from '@playwright/test';
import { E2E_ORIGIN } from './e2eRoom';
import { appendText, firstParagraphText, openEditor, waitForEditor } from './editorDriver';
import { newContext, test } from './fixtures';

/**
 * PLAN.md §8.5/§13: the role in the collaboration token is enforced by the
 * relay, not by the editor UI -- a client that ignores its read-only role must
 * still be unable to change the document. The viewer here is exactly such a
 * client: it opens with a read-only token but a writable editor, so its edit is
 * really sent, and the relay is what has to stop it.
 */
test.describe('docx: read-only participant', () => {
	test('a viewer receives the document and the relay rejects its edit', async ({ browser, room }) => {
		test.setTimeout(120_000);

		const writerContext = await newContext(browser, room);
		const viewerContext = await newContext(browser, room);
		// The real app derives the role and display name from the user's file
		// permissions and account; the mock has no Nextcloud to consult, so
		// per-context cookies tell it which of these two sessions is the
		// read-only viewer, and who they are (PLAN.md §8.6).
		await viewerContext.addCookies([
			{ name: 'betteroffice-e2e-role', value: 'read', url: E2E_ORIGIN },
			{ name: 'betteroffice-e2e-user', value: 'Bob', url: E2E_ORIGIN },
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

	/**
	 * The other half of the same role: the test above proves the relay stops a
	 * read token's edits, while this one proves the page does not ask for a save
	 * in the first place. Both matter -- a viewer that could not write into the
	 * room but could still overwrite the file through a save would be no better
	 * off, and that save would go through Nextcloud rather than the relay.
	 *
	 * The viewer therefore opens the way the page opens a file the user may not
	 * update (`readOnly=1`), not the deliberately-writable editor of the test
	 * above: the save path is what is under test here, so it must be the real
	 * one. A save gesture is pressed anyway, and what is asserted is that
	 * nothing reached the document API -- not merely that the banner stayed
	 * quiet.
	 */
	test('a read-only viewer is offered no save and writes nothing', async ({ browser, room, request }) => {
		test.setTimeout(120_000);

		const writerContext = await newContext(browser, room);
		const viewerContext = await newContext(browser, room);
		await viewerContext.addCookies([
			{ name: 'betteroffice-e2e-role', value: 'read', url: E2E_ORIGIN },
			{ name: 'betteroffice-e2e-user', value: 'Carol', url: E2E_ORIGIN },
		]);

		const writer = await writerContext.newPage();
		const viewer = await viewerContext.newPage();

		try {
			await openEditor(writer);
			await appendText(writer, ' [for-viewer]');

			await openEditor(viewer, { readOnly: true });
			await waitForEditor(viewer);
			// The share is still worth opening: the viewer sees the writer's
			// edit even though it may not make one.
			await expect.poll(() => firstParagraphText(viewer), { timeout: 20_000 }).toContain('[for-viewer]');

			// No save affordance -- the read-only page renders no menu bar at
			// all -- and a save gesture anyway writes nothing.
			await expect(viewer.getByRole('menuitem', { name: 'File' })).toHaveCount(0);
			await expect(viewer.getByRole('button', { name: /^Save$/ })).toHaveCount(0);
			await expect(viewer.getByRole('menuitem', { name: /^Save$/ })).toHaveCount(0);
			await viewer.getByRole('textbox', { name: 'Document input' }).focus();
			await viewer.keyboard.press('ControlOrMeta+s');
			await viewer.waitForTimeout(1_500);
			await expect(viewer.locator('.betteroffice-save-status--saved')).toHaveCount(0);

			// And the file itself is untouched: `saved` is the mock's record of
			// a PUT, so this fails if a save reached the API at all.
			const state = (await (await request.get(`/__test__/document-state?room=${room}&fileId=1`)).json()) as {
				saved: boolean;
			};
			expect(state.saved).toBe(false);
		} finally {
			await writerContext.close();
			await viewerContext.close();
		}
	});
});
