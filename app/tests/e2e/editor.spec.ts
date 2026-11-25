import { expect } from '@playwright/test';
import { test } from './fixtures';

/**
 * These exercise EditorApp's own wiring (fetch-on-load, the Ctrl+S save
 * path, ETag/conflict handling) against a mock document API
 * (mockDocumentApi.ts) standing in for DocumentController. They do not
 * re-prove that BetterOffice's editor renders or edits a document
 * correctly -- that's covered end to end in poc/tests/docx.collab.spec.ts.
 * Driving the editor's own canvas-painted content via simulated typing
 * isn't attempted here: its visible paint layer and its accessible DOM
 * mirror are separate, and only the latter is addressable by a DOM-level
 * selector.
 */

test('editor opens and renders the real document for real', async ({ page }) => {
	await page.goto('/?fileId=1&fileName=demo.docx');
	await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible({ timeout: 15_000 });
});

test('Ctrl+S saves through the document API and reports saved', async ({ page }) => {
	await page.goto('/?fileId=1&fileName=demo.docx');
	await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible({ timeout: 15_000 });

	// The editor paints to canvas and captures keyboard input through this
	// hidden proxy textbox rather than a contenteditable element -- it needs
	// focus before a keyboard shortcut like Ctrl+S reaches the editor's own
	// handler instead of the browser's native save dialog.
	await page.getByRole('textbox', { name: 'Document input' }).focus();
	await page.keyboard.press('ControlOrMeta+s');

	await expect(page.locator('.betteroffice-save-status--saved')).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.betteroffice-save-status--error')).toHaveCount(0);
});

test('a conflicting save surfaces the conflict message instead of overwriting', async ({ page, request, room }) => {
	await page.goto('/?fileId=1&fileName=demo.docx');
	await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible({ timeout: 15_000 });

	await request.post(`/__test__/force-conflict?room=${room}`);
	await page.getByRole('textbox', { name: 'Document input' }).focus();
	await page.keyboard.press('ControlOrMeta+s');

	await expect(page.locator('.betteroffice-save-status--conflict')).toBeVisible({ timeout: 15_000 });
});
