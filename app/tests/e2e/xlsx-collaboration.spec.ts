import { expect } from '@playwright/test';
import { E2E_ORIGIN } from './e2eRoom';
import { newContext, test } from './fixtures';
import { appendToTitle, openXlsxEditor, workbookHasText } from './xlsxDriver';

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
});
