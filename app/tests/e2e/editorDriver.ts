import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_RELAY_URL } from './testRelay';

/**
 * Drives the real `EditorApp` in a browser: opens the editor, reads and edits
 * the document through the editor's own imperative handle, and saves through
 * the app's own Ctrl+S path.
 *
 * Shared by the collaboration specs, which each cover one behaviour of the
 * same wiring -- convergence, reconnect, roles, presence. They are separate
 * files so Playwright can put them on different workers; one file holding
 * every two-browser test made that file the whole run's critical path.
 *
 * The edit driver reads and edits through the editor's imperative handle, the
 * same way poc/tests/docx.collab.spec.ts does: the editor paints to a canvas,
 * so its content cannot be asserted from the DOM, and driving it by keystrokes
 * would make convergence depend on caret placement rather than on the
 * collaboration wiring those tests are about.
 */

export const DOCUMENT_PATH = '/index.php/apps/betteroffice/document/1';
export const EDITOR_PATH = `/?fileId=1&fileName=demo.docx&relayUrl=${encodeURIComponent(TEST_RELAY_URL)}`;

interface ParagraphRead {
	ok: boolean;
	version: string;
	paragraphs: Array<{ paraId: string; text: string }>;
}

/**
 * Reads the first paragraph through the editor's imperative handle.
 *
 * The handle's reads are serialised in the editor's worker, and a read still
 * in flight when another starts is rejected with "Worker read was superseded"
 * -- typically because an update arriving from the relay triggered the
 * editor's own read. That is a race in the editor, not a failure of what these
 * tests assert, so a superseded read is retried; anything else still fails.
 */
async function readFirstParagraph(page: Page): Promise<ParagraphRead | null> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await page.evaluate(() => {
				const ref = (window as unknown as { __betteroffice?: { editorRef?: { current?: unknown } } })
					.__betteroffice?.editorRef?.current as { readParagraphs?: (options: unknown) => unknown } | undefined;
				if (!ref || typeof ref.readParagraphs !== 'function') return null;
				try {
					return ref.readParagraphs({ view: 'accepted' }) as ParagraphRead;
				} catch {
					return null;
				}
			});
		} catch (error) {
			const superseded = error instanceof Error && error.message.includes('Worker read was superseded');
			if (!superseded || attempt >= 4) throw error;
			await page.waitForTimeout(50);
		}
	}
}

/** Waits until the editor's handle is live and has actually opened the document. */
export async function waitForEditor(page: Page): Promise<void> {
	await expect
		.poll(async () => (await readFirstParagraph(page))?.ok ?? false, { timeout: 30_000 })
		.toBe(true);
}

export async function firstParagraphText(page: Page): Promise<string> {
	const read = await readFirstParagraph(page);
	expect(read?.ok, 'the editor handle did not return a readable document').toBe(true);
	return read!.paragraphs[0].text;
}

export async function appendText(page: Page, text: string): Promise<void> {
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

/**
 * Opens the editor and waits until its collaboration session is live and
 * synced. `readOnly` mirrors what the page passes for a file the viewer may
 * not update, so the same app path is exercised for viewers and writers.
 */
export async function openEditor(page: Page, { readOnly = false } = {}): Promise<void> {
	await page.goto(`${EDITOR_PATH}${readOnly ? '&readOnly=1' : ''}`);
	// A read-only viewer gets no menu bar at all, so the menu is the writer's
	// readiness signal only; a viewer's is the collaboration status plus a
	// document it can read, both waited for below.
	if (!readOnly) {
		await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible({ timeout: 30_000 });
	}
	await expect(page.locator('[data-collaboration-status="connected"]')).toBeVisible({ timeout: 30_000 });
	await waitForEditor(page);
}

export async function saveThroughApp(page: Page): Promise<void> {
	// The editor captures keyboard input through this hidden proxy textbox;
	// without focus the shortcut never reaches its own handler.
	await page.getByRole('textbox', { name: 'Document input' }).focus();
	await page.keyboard.press('ControlOrMeta+s');
	await expect(page.locator('.betteroffice-save-status--saved')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.betteroffice-save-status--error')).toHaveCount(0);
	await expect(page.locator('.betteroffice-save-status--conflict')).toHaveCount(0);
}

/** The `exp` claim of a collaboration token, in Unix seconds. */
export function tokenExpiry(token: string): number {
	const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: number };
	return payload.exp;
}

/**
 * Reads what was actually written to the (mock) Nextcloud file and unzips its
 * body. The room is named explicitly: Playwright's standalone `request`
 * context does not carry the browser context's cookies, so without it the
 * read would answer for a different room than the page saved into.
 */
export async function savedDocumentXml(request: APIRequestContext, room: string): Promise<string> {
	const response = await request.get(`${DOCUMENT_PATH}?room=${room}`);
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
