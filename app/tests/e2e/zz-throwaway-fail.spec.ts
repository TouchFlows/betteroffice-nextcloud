import { expect, test } from '@playwright/test';

/**
 * Throwaway, lives only on the tmp/prove-upload-artifact-v7 branch: fails on
 * purpose so the "Upload Playwright traces" step (upload-artifact@v7) runs
 * against real trace files. It keeps a page fixture so Playwright creates a
 * browser context -- without one, retain-on-failure has nothing to write and
 * the artifact step would prove nothing.
 */
test('deliberate failure to exercise the trace upload', async ({ page }) => {
	await page.goto('about:blank');
	await expect(page.getByTestId('never-rendered')).toBeVisible({ timeout: 1_000 });
});
