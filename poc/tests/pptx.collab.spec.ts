import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import '../app/debug';

async function waitSynced(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => window.__bo?.collab?.synced === true, { timeout });
}

async function firstStoryText(page: Page): Promise<{ version: string; story: any; text: string }> {
  const access = await page.evaluate(async () => {
    const api = window.__bo!.ref as any;
    const handle = await api.handleAsync();
    return handle.readContent();
  });
  expect(access.ok).toBe(true);
  const [story] = access.stories;
  return { version: access.version, story, text: story.text };
}

async function appendText(page: Page, text: string) {
  const access = await page.evaluate(async () => {
    const api = window.__bo!.ref as any;
    const handle = await api.handleAsync();
    return handle.readContent();
  });
  const story = access.stories[0];
  const result = await page.evaluate(
    async ({ version, story, text }) => {
      const api = window.__bo!.ref as any;
      const handle = await api.handleAsync();
      return handle.applyEdits({
        expectVersion: version,
        steps: [
          {
            op: 'insertText',
            target: { kind: 'search', within: { slideId: story.slideId, shapeId: story.shapeId, storyId: story.storyId }, text: story.text },
            at: 'end',
            text,
          },
        ],
      });
    },
    { version: access.version, story, text },
  );
  expect(result.ok, `applyEdits failed: ${JSON.stringify(result)}`).toBe(true);
}

test('pptx: two-client collaboration through the self-hosted relay', async ({ browser }) => {
  const room = randomUUID();

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await pageA.goto(`/?format=pptx&room=${room}&seed=1&clientId=1&user=alice`);
  await pageA.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
  await waitSynced(pageA);

  const before = await firstStoryText(pageA);
  await appendText(pageA, ' [from-alice]');

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(`/?format=pptx&room=${room}&seed=0&clientId=2&user=bob`);
  await pageB.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
  await waitSynced(pageB);

  await expect
    .poll(async () => (await firstStoryText(pageB)).text, { timeout: 10_000 })
    .toContain('[from-alice]');

  expect((await firstStoryText(pageB)).text).not.toBe(before.text);

  const exported: number[] = await pageA.evaluate(async () => {
    const buffer = await (window.__bo!.ref as any).save();
    return Array.from(buffer as Uint8Array);
  });
  expect(exported.length).toBeGreaterThan(0);

  await contextA.close();
  await contextB.close();
});
