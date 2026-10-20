import { test, expect } from './connection-fixtures';
import { errors, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const icon = readFileSync('favicon.ico');
const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
function probes(page: Page) {
  const finished: number[] = [];
  page.on('requestfinished', request => {
    const url = new URL(request.url());
    if (url.pathname === '/favicon.ico' && url.searchParams.has('online')) finished.push(request.timing().responseEnd);
  });
  return finished;
}
async function observeWarnings(page: Page) {
  await page.evaluate(() => {
    const state = window as Window & { weakWarningSeen?: boolean };
    state.weakWarningSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.connection-chip')?.textContent?.includes('Sinyal lemah')) state.weakWarningSeen = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
async function record(page: Page, samples: number[]) {
  await test.info().attach('connection-probes', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    responseDurationsMs: samples,
    warningSeen: await page.evaluate(() => (window as Window & { weakWarningSeen?: boolean }).weakWarningSeen ?? null),
    finalNotice: await page.locator('.connection-chip').allTextContents(),
  }, null, 2)) });
}

test('fast application connection never shows weak signal while the imagery server remains stalled', async ({ page, imagery }) => {
  imagery.hold = true;
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', {
    configurable: true, value: Object.assign(new EventTarget(), { effectiveType: '2g', downlink: 0.05, rtt: 2000 }),
  }));
  const samples = probes(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await expect.poll(() => imagery.requests.length).toBeGreaterThan(0);
  await observeWarnings(page);
  await expect.poll(() => samples.length, { timeout: 25_000 }).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.connection-chip')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { weakWarningSeen?: boolean }).weakWarningSeen)).toBe(false);
  await record(page, samples);
});

test('genuinely high latency shows weak signal and one fast sample clears it without waiting for imagery', async ({ page, imagery }) => {
  imagery.hold = true;
  let latency = 3200;
  const samples = probes(page);
  await page.route('**/favicon.ico?online=*', async route => {
    await wait(latency); await route.fulfill({ contentType: 'image/x-icon', body: icon });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.atlas-total__num')).toHaveText('500'); await observeWarnings(page);
  await expect(page.locator('.connection-chip')).toHaveText('Sinyal lemah. Citra peta dimuat pelan…', { timeout: 30_000 });
  expect(samples.length).toBeGreaterThanOrEqual(3);
  latency = 20;
  await expect(page.locator('.connection-chip')).toHaveCount(0, { timeout: 10_000 });
  expect(imagery.hold).toBe(true);
  await record(page, samples);
});

test('actual low-bandwidth browser throttling is detected even though HEAD latency stays low', async ({ page, context, browserName, imagery }) => {
  test.skip(browserName !== 'chromium', 'CDP bandwidth throttling is Chromium-only');
  imagery.hold = true;
  const samples = probes(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await expect.poll(() => imagery.requests.length).toBeGreaterThan(0); await observeWarnings(page);
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 30, downloadThroughput: 4096, uploadThroughput: 65_536 });
  try {
    const headMs = await page.evaluate(async () => {
      const started = performance.now(); await fetch('/favicon.ico?head-baseline', { method: 'HEAD', cache: 'no-store' }); return performance.now() - started;
    });
    expect(headMs).toBeLessThan(1500);
    await expect(page.locator('.connection-chip')).toHaveText('Sinyal lemah. Citra peta dimuat pelan…', { timeout: 30_000 });
    expect(samples.length).toBeGreaterThanOrEqual(3);
    await record(page, samples);
    await test.info().attach('bandwidth-profile', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ downloadBytesPerSecond: 4096, latencyMs: 30, observedHeadMs: headMs })) });
  } finally {
    await session.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await session.detach();
  }
});

test('pending imagery from a hidden basemap stops influencing connection quality', async ({ page, imagery }) => {
  imagery.hold = true;
  const samples = probes(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await expect.poll(() => imagery.requests.length).toBeGreaterThan(0);
  imagery.slowProvider = imagery.requests[0];
  test.skip(imagery.slowProvider !== 'https://tile.googleapis.com', 'This build has no Google basemap key, so the alternate basemap cannot be started');
  await expect.poll(() => samples.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Tampilkan pilihan layer' }).click();
  await page.locator('label[for="layer-esri"]').click();
  await expect(page.getByLabel('Esri Satelit', { exact: true })).toBeChecked();
  // OpenLayers shares 16 loading slots. Finish one old request so Esri can start, while the other
  // Google requests deliberately stay pending in the hidden layer throughout the assertion.
  imagery.releaseOne();
  await expect.poll(() => imagery.requests.includes('https://services.arcgisonline.com')).toBe(true);
  // Observe longer than the five-second quality retry interval; hidden tiles must not restart it.
  const nextProbe = page.waitForRequest(request => new URL(request.url()).pathname === '/favicon.ico' && new URL(request.url()).searchParams.has('online'), { timeout: 6500 })
    .then(() => true, error => { if (error instanceof errors.TimeoutError) return false; throw error; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await nextProbe).toBe(false);
  await expect(page.locator('.connection-chip')).toHaveCount(0);
  await record(page, samples);
});
