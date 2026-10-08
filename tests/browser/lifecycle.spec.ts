import { test, expect } from '@playwright/test';
test('disposes mounted maps, body state and listeners through repeated unmounts', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8127/tests/fixtures/lifecycle.html', { waitUntil: 'domcontentloaded' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(page.locator('.atlas-total__num')).toHaveText('500');
    await expect(page.locator('.ol-viewport')).toHaveCount(1);
    await page.getByRole('button', { name: 'Unmount fixture' }).click();
    await expect(page.locator('.ol-viewport')).toHaveCount(0);
    await expect(page.locator('#app')).toBeEmpty();
    await expect(page.locator('body')).not.toHaveClass(/is-popup-open|is-panel-open|is-data-unavailable/);
    await page.getByRole('button', { name: 'Mount fixture', exact: true }).click();
  }
  await expect(page.locator('.ol-viewport')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('cancels pending data when unmounted and starts a fresh request on remount', async ({ page }) => {
  let hold = true; let requests = 0; const cancelled: string[] = [];
  page.on('requestfailed', request => { if (request.url().endsWith('/data/points.geojson')) cancelled.push(request.failure()?.errorText ?? 'failed'); });
  await page.route('**/data/points.geojson', async route => { requests++; if (!hold) await route.continue(); });
  await page.goto('http://127.0.0.1:8127/tests/fixtures/lifecycle.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => requests).toBe(1); await page.getByRole('button', { name: 'Unmount fixture' }).click();
  await expect.poll(() => cancelled.length).toBe(1);
  hold = false; await page.getByRole('button', { name: 'Mount fixture', exact: true }).click();
  await expect(page.locator('.atlas-total__num')).toHaveText('500'); await expect(page.locator('.ol-viewport')).toHaveCount(1);
});
