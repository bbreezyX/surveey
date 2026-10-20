import { test, expect } from '@playwright/test';
test.describe('with the service worker', () => {
  // The rest of the suite blocks the worker so page.route keeps seeing data requests.
  test.use({ serviceWorkers: 'allow' });
  test('reopens offline from the stored copy and refreshes in place when the connection returns', async ({ page, context, browserName }) => {
    // Playwright drives service workers and offline emulation together only in Chromium.
    test.skip(browserName !== 'chromium', 'Service worker offline emulation is Chromium-only in Playwright');
    await page.goto('/'); await expect(page.locator('.atlas-total__num')).toHaveText('500');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // Online and controlled: fresh data, no notice.
    await page.reload(); await expect(page.locator('.atlas-total__num')).toHaveText('500');
    await expect(page.locator('.sidebar-footer__stored')).toHaveCount(0);
    await context.setOffline(true);
    try {
      await page.reload(); await expect(page.locator('.atlas-total__num')).toHaveText('500');
      await expect(page.locator('.sidebar-footer__stored')).toContainText('Data tersimpan');
      // No imagery offline: the map says so rather than showing a blank field.
      await expect(page.locator('.connection-chip')).toContainText('Tidak ada internet');
      await expect(page.locator('#map')).toHaveClass(/is-imagery-offline/);
      await page.getByRole('button', { name: /Kota Jambi, 72 titik/ }).click();
      await page.getByRole('searchbox').fill('TANJUNG RADEN-007'); await expect(page.locator('.atlas-pt')).toHaveCount(1);
    } finally { await context.setOffline(false); }
    // Back online: the notice clears by itself and the reader's place is untouched.
    await expect(page.locator('.sidebar-footer__stored')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.connection-chip')).toHaveCount(0);
    await expect(page.locator('#map')).not.toHaveClass(/is-imagery-offline/);
    await expect(page.getByRole('heading', { name: 'Kota Jambi' })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveValue('TANJUNG RADEN-007');
    await expect(page.locator('.atlas-pt')).toHaveCount(1);
  });
});
test('loads by itself once the connection comes back after a failed first load', async ({ page }) => {
  let fail = true;
  await page.route('**/data/points.geojson', route => fail ? route.abort('internetdisconnected') : route.continue());
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await expect(page.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
  fail = false; await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('.atlas-total__num')).toHaveText('500');
});
test('tells a phone reader the data is loading, then that the signal is weak', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/points.geojson', async route => { await held; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.connection-chip')).toHaveText('Memuat data titik…');
  // Past the slow threshold the wait is explained as weak signal, not left looking stuck.
  await expect(page.locator('.connection-chip')).toContainText('Sinyal lemah. Memuat data titik…', { timeout: 6000 });
  release();
  await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await expect(page.locator('.connection-chip')).toHaveCount(0);
});
