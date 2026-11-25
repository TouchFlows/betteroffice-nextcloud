import { expect } from '@playwright/test';
import {
	appendText,
	firstParagraphText,
	openEditor,
	saveThroughApp,
	savedDocumentXml,
	waitForEditor,
} from './editorDriver';
import { newContext, test } from './fixtures';

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
 * The rest of that wiring has a spec file of its own, one behaviour each
 * (collaboration-reconnect, collaboration-roles, collaboration-presence), so
 * Playwright can spread them over its workers: one file holding every
 * two-browser test made that file the whole run's critical path while the
 * other worker sat idle. `editorDriver.ts` holds what they all share.
 */

test.describe('docx: two browsers through the real relay', () => {
	test('edits converge in both sessions and either session can save the merged document', async ({
		browser,
		request,
		room,
	}) => {
		test.setTimeout(180_000);

		const aliceContext = await newContext(browser, room);
		const bobContext = await newContext(browser, room);
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
			let documentXml = await savedDocumentXml(request, room);
			expect(documentXml).toContain('from-alice');
			expect(documentXml).toContain('from-bob');

			// The other session can save the same merged result too: reload
			// (a fresh ETag, since Alice's save moved it) and save again.
			await bob.reload();
			await expect(bob.getByRole('menuitem', { name: 'File' })).toBeVisible({ timeout: 30_000 });
			await expect(bob.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });
			await waitForEditor(bob);
			await saveThroughApp(bob);

			documentXml = await savedDocumentXml(request, room);
			expect(documentXml).toContain('from-alice');
			expect(documentXml).toContain('from-bob');
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});

/**
 * Opening a document resolves a collaboration session once, to seed the room.
 * The provider's first connection must reuse that session's token rather than
 * asking for a second one moments later; only a reconnect -- which can come
 * after the token expired -- needs a fresh token.
 */
test.describe('docx: collaboration session lifecycle', () => {
	test('the first connection reuses the session resolved for the seed', async ({ page, room }) => {
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
