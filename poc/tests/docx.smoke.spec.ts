import { test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('docx: seed owner opens, editor renders', async ({ page }) => {
  const room = randomUUID();
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err}`));

  await page.goto(`/?format=docx&room=${room}&seed=1&clientId=1&user=alice`);
  await page.waitForTimeout(8000);

  console.log('--- browser logs ---');
  for (const line of logs) console.log(line);

  const bodyText = await page.locator('body').innerText();
  console.log('--- body text (first 500) ---');
  console.log(bodyText.slice(0, 500));

  await page.screenshot({ path: 'tests/.artifacts/docx-smoke.png' });
});
