import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import '../app/debug';

async function waitSynced(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => window.__bo?.collab?.synced === true, { timeout });
}

async function cellA1(page: Page): Promise<{ version: string; sheetId: string; text: string }> {
  const read = await page.evaluate(() => (window.__bo!.ref as any).readCells({ ranges: [] }));
  expect(read.ok).toBe(true);
  const sheetId = read.sheets[0].sheetId;
  const detail = await page.evaluate(
    (sheetId) => (window.__bo!.ref as any).readCells({ ranges: [{ sheetId, range: { kind: 'a1', a1: 'A1' } }] }),
    sheetId,
  );
  expect(detail.ok).toBe(true);
  return { version: detail.version, sheetId, text: detail.ranges[0].cells[0][0].displayText };
}

async function setA1(page: Page, text: string) {
  const read = await page.evaluate(() => (window.__bo!.ref as any).readCells({ ranges: [] }));
  const sheetId = read.sheets[0].sheetId;
  const result = await page.evaluate(
    ({ version, sheetId, text }) =>
      (window.__bo!.ref as any).applyEdits({
        expectVersion: version,
        steps: [
          {
            op: 'setCellInputs',
            target: { sheetId, range: { kind: 'a1', a1: 'A1' } },
            inputs: [[text]],
          },
        ],
      }),
    { version: read.version, sheetId, text },
  );
  expect(result.ok, `applyEdits failed: ${JSON.stringify(result)}`).toBe(true);
}

test('xlsx: two-client collaboration through the self-hosted relay', async ({ browser }) => {
  const room = randomUUID();

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await pageA.goto(`/?format=xlsx&room=${room}&seed=1&clientId=1&user=alice`);
  await pageA.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
  await waitSynced(pageA);

  await setA1(pageA, 'from-alice');

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(`/?format=xlsx&room=${room}&seed=0&clientId=2&user=bob`);
  await pageB.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
  await waitSynced(pageB);

  await expect.poll(async () => (await cellA1(pageB)).text, { timeout: 10_000 }).toBe('from-alice');

  const exported: number[] = await pageA.evaluate(async () => {
    const buffer = await (window.__bo!.ref as any).save();
    return Array.from(buffer as Uint8Array);
  });
  expect(exported.length).toBeGreaterThan(0);

  await contextA.close();
  await contextB.close();
});
