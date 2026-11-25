import { expect } from '@playwright/test';
import { E2E_ORIGIN } from './e2eRoom';
import { appendText, firstParagraphText, openEditor } from './editorDriver';
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
});
