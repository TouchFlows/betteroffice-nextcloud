import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RELAY_PORT = 8788;
const RELAY_URL = `ws://localhost:${RELAY_PORT}`;

function startRelay(dataDir: string): Promise<ChildProcess> {
  const root = new URL('..', import.meta.url).pathname;
  console.log('[test] spawning relay', { root, dataDir, port: RELAY_PORT });
  const child = spawn(join(root, 'node_modules/.bin/tsx'), ['relay/server.ts'], {
    cwd: root,
    env: {
      ...process.env,
      BETTEROFFICE_RELAY_PORT: String(RELAY_PORT),
      BETTEROFFICE_RELAY_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay did not start in time')), 15_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      console.log('[relay stdout]', chunk.toString());
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => console.error('[relay stderr]', chunk.toString()));
    child.on('error', (err) => {
      console.error('[test] relay spawn error', err);
      reject(err);
    });
    child.on('exit', (code) => {
      console.log('[test] relay exited', code);
      if (code !== 0 && code !== null) reject(new Error(`relay exited with code ${code}`));
    });
  });
}

async function stopRelay(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

async function firstParagraphText(page: Page): Promise<{ version: string; paraId: string; text: string }> {
  const read = await page.evaluate(() => (window.__bo!.ref as any).readParagraphs({ view: 'accepted' }));
  expect(read.ok).toBe(true);
  const [first] = read.paragraphs;
  return { version: read.version, paraId: first.paraId, text: first.text };
}

async function appendText(page: Page, text: string) {
  const read = await page.evaluate(() => (window.__bo!.ref as any).readParagraphs({ view: 'accepted' }));
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

async function waitSynced(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => window.__bo?.collab?.synced === true, { timeout });
}

test('docx: relay restart does not lose accepted updates', async ({ browser }) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bo-relay-restart-'));
  const room = randomUUID();
  let relay = await startRelay(dataDir);

  try {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    pageA.on('console', (m) => console.log('[A]', m.type(), m.text()));
    pageA.on('pageerror', (e) => console.log('[A pageerror]', e));
    await pageA.goto(`/?format=docx&room=${room}&seed=1&clientId=1&user=alice&relayUrl=${encodeURIComponent(RELAY_URL)}`);
    await pageA.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
    console.log('[test] A ready, collab =', await pageA.evaluate(() => window.__bo?.collab));
    await waitSynced(pageA);
    console.log('[test] A synced');
    await appendText(pageA, ' [persisted-edit]');
    console.log('[test] A appended text');

    // Give the relay a beat to flush the accepted update to its file-backed log
    // before we pull the rug out from under it.
    await pageA.waitForTimeout(500);
    await ctxA.close();

    await stopRelay(relay);
    relay = await startRelay(dataDir);

    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await pageC.goto(`/?format=docx&room=${room}&seed=0&clientId=3&user=carol&relayUrl=${encodeURIComponent(RELAY_URL)}`);
    await pageC.waitForFunction(() => window.__bo?.ready === true, { timeout: 20_000 });
    await waitSynced(pageC);

    const recovered = await firstParagraphText(pageC);
    expect(recovered.text).toContain('[persisted-edit]');

    await ctxC.close();
  } finally {
    await stopRelay(relay).catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  }
});
