import { expect } from '@playwright/test';
import { newContext, test } from './fixtures';
import { appendToTitle, deckHasText, openPptxEditor } from './pptxDriver';

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

			// Presence (PLAN.md §8.6) through `onPresence`: each session lists the
			// other. Names come from awareness for this format, which carries no
			// role or avatar, so only the counts are asserted here.
			await expect(alice.locator('[data-collaboration-peers]')).toHaveAttribute(
				'data-collaboration-peers',
				'1',
				{ timeout: 30_000 },
			);
			await expect(alice.locator('[data-collaboration-presence]')).toHaveAttribute(
				'data-collaboration-presence',
				'1',
				{ timeout: 30_000 },
			);
			await expect(bob.locator('[data-collaboration-presence]')).toHaveAttribute(
				'data-collaboration-presence',
				'1',
				{ timeout: 30_000 },
			);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});
