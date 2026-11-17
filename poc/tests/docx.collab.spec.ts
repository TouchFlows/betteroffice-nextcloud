import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../app/debug';

async function waitSynced(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => window.__bo?.collab?.synced === true, { timeout });
}

async function firstParagraphText(page: Page): Promise<{ version: string; paraId: string; text: string }> {
  const read = await page.evaluate(() => (window.__bo!.ref as any).readParagraphs({ view: 'accepted' }));
  expect(read.ok).toBe(true);
  const [first] = read.paragraphs;
  return { version: read.version, paraId: first.paraId, text: first.text };
}

async function appendText(page: Page, text: string) {
  const read = await page.evaluate(() => (window.__bo!.ref as any).readParagraphs({ view: 'accepted' }));
  expect(read.ok).toBe(true);
  const paraId = read.paragraphs[0].paraId;
  const result = await page.evaluate(
    ({ version, paraId, text }) =>
      (window.__bo!.ref as any).applyEdits({
        expectVersion: version,
        steps: [{ op: 'insertText', target: { kind: 'paragraph', story: 'body', paraId }, at: 'end', text }],
      }),
    { version: read.version, paraId, text },
  );
  expect(result.ok, `applyEdits failed: ${JSON.stringify(result)}`).toBe(true);
}

test.describe('docx: two-client collaboration through the self-hosted relay', () => {
  test('edits converge, export round-trips, relay restart does not lose state', async ({ browser }) => {
    const room = randomUUID();

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto(`/?format=docx&room=${room}&seed=1&clientId=1&user=alice`);
    await pageA.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
    await waitSynced(pageA);

    const before = await firstParagraphText(pageA);
    await appendText(pageA, ' [from-alice]');

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(`/?format=docx&room=${room}&seed=0&clientId=2&user=bob`);
    await pageB.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
    await waitSynced(pageB);

    await expect
      .poll(async () => (await firstParagraphText(pageB)).text, { timeout: 10_000 })
      .toContain('[from-alice]');

    await appendText(pageB, ' [from-bob]');
    await expect
      .poll(async () => (await firstParagraphText(pageA)).text, { timeout: 10_000 })
      .toContain('[from-bob]');

    const finalText = (await firstParagraphText(pageA)).text;
    expect(finalText).not.toBe(before.text);

    const exported: number[] = await pageA.evaluate(async () => {
      const buffer = await (window.__bo!.ref as any).save();
      return Array.from(new Uint8Array(buffer));
    });
    expect(exported.length).toBeGreaterThan(0);

    // Reopen the saved bytes independently of the live editor/collaboration
    // session: unzip the OOXML package and confirm both peers' edits
    // actually landed in word/document.xml, not just in in-memory state.
    const dir = mkdtempSync(join(tmpdir(), 'bo-docx-export-'));
    const docxPath = join(dir, 'exported.docx');
    writeFileSync(docxPath, Buffer.from(exported));
    const documentXml = execFileSync('unzip', ['-p', docxPath, 'word/document.xml']).toString('utf8');
    expect(documentXml).toContain('from-alice');
    expect(documentXml).toContain('from-bob');
    rmSync(dir, { recursive: true, force: true });

    await contextA.close();
    await contextB.close();
  });
});
