import { test, expect, type Page } from '@playwright/test';
import { loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
// Reuse the PNG reader shipped with this pinned Playwright version.
const { PNG } = createRequire(resolve('package.json'))('playwright-core/lib/utilsBundle') as { PNG: { sync: { read(input: Buffer): { data: Buffer } } } };
// The bundle carries a Google key only when the build saw one in .env.local or the environment.
const googleKey = !!(process.env.VITE_GOOGLE_MAPS_KEY || loadEnv('production', process.cwd(), 'VITE_').VITE_GOOGLE_MAPS_KEY);
// Google is stubbed so browser runs never spend the tile quota or depend on the key's referrers.
async function stubGoogle(page: Page, session: number) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
  const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://tile.googleapis.com/**', route => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.includes('/createSession')) return session === 200 ? route.fulfill({ headers: cors, json: { session: 'e2e', expiry: String(Math.floor(Date.now() / 1000) + 14 * 86400) } }) : route.fulfill({ status: session, headers: cors, json: { error: { code: session } } });
    if (url.includes('/viewport')) return route.fulfill({ headers: cors, json: { copyright: 'Imagery ©2026 E2E' } });
    return route.fulfill({ headers: cors, contentType: 'image/png', body: tile });
  });
}

test('retains the original layer switches, symbols, grouping and basemap capsules', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await page.getByRole('button', { name: 'Tampilkan pilihan layer' }).click();
  const panel = page.locator('#top-right-container .layer-switcher .panel');
  await expect(panel.locator('.ctl-switch')).toHaveCount(6);
  await expect(panel.locator('li.group > .layer-group-title')).toHaveText(['Data Lapangan', 'Peta Dasar']);
  expect((await panel.locator('li.layer > label').allTextContents()).map(text => text.trim().replace(/\s+/g, ' '))).toEqual(['Titik PUTS', 'Lokasi Belum Ditetapkan', 'Titik Cadangan 50 titik', 'Batas Kabupaten/Kota', 'Area Cakupan', 'Fokus Provinsi', 'Google Satelit', 'Esri Satelit']);
  await expect(panel.locator('img')).toHaveCount(3);
  expect(await panel.evaluate(element => getComputedStyle(element).borderRadius)).toBe('22px');
  expect(await panel.locator('.ctl-switch__track').first().evaluate(element => element.getBoundingClientRect().width)).toBe(36);
  // The yellow pin explains itself, so the key never names it; its verification ring goes with the layer.
  await expect(page.locator('.map-legend__item').filter({ hasText: 'Titik PUTS' })).toHaveCount(0);
  await expect(page.locator('.map-legend__item').filter({ hasText: 'Perlu konfirmasi' })).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Titik PUTS', exact: true }).uncheck();
  await expect(page.locator('.map-legend__item').filter({ hasText: 'Perlu konfirmasi' })).toHaveCount(0);
  await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await page.getByRole('checkbox', { name: 'Titik PUTS', exact: true }).check();
  await page.locator('label[for="layer-esri"]').click(); await expect(page.getByLabel('Esri Satelit', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Tutup pilihan layer' }).click();
  await page.getByRole('button', { name: /Kota Jambi, 72 titik/ }).click();
  await expect(page.locator('.atlas-pills')).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', 'Cari dalam Kota Jambi…');
  await page.getByRole('searchbox').fill('TANJUNG RADEN-007'); await expect(page.locator('.atlas-pt')).toHaveCount(1);
  await page.getByRole('button', { name: 'Kembali ke semua wilayah' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue(''); await expect(page.locator('.atlas-cell')).toHaveCount(10);
});

test('shows a stage reported on esdm.cloud/lapangan when the reader returns, without a hard refresh', async ({ page }) => {
  let stage = 1, nomor = '';
  // Playwright routing turns the HTTP cache off and Chrome adds the cache header below what routing sees,
  // so the fetch's own cache mode is what proves esdm.cloud's 60 s browser copy is skipped.
  await page.addInitScript(() => {
    const seen: (string | undefined)[] = (window as Window & { progressCache?: typeof seen }).progressCache = [], original = window.fetch;
    window.fetch = (input, init) => { if (String(input).includes('/api/public/survey-progress')) seen.push(init?.cache); return original(input, init); };
  });
  await page.route('https://www.esdm.cloud/api/public/survey-progress', route => {
    return route.fulfill({ headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' }, json: { stages: { [nomor]: stage } } });
  });
  await page.goto('/'); await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await page.getByRole('searchbox').fill('TANJUNG RADEN-007');
  const point = page.locator('.atlas-pt'); await expect(point).toHaveCount(1);
  nomor = (await point.getAttribute('data-item-id'))!;
  // The first answer came before the Nomor was known; ask again the way a returning reader does.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(point.locator('.atlas-pt__stage')).toHaveText('Galian Selesai');
  stage = 4;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(point.locator('.atlas-pt__stage')).toHaveText('Terpasang');
  const modes = await page.evaluate(() => (window as Window & { progressCache?: string[] }).progressCache);
  expect(modes?.length).toBeGreaterThanOrEqual(3);
  for (const mode of modes!) expect(mode).toBe('no-cache');
});

test('keeps the chosen marker visible while its ordinary point layer is hidden', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.getByRole('button', { name: 'Tampilkan pilihan layer' }).click();
  await page.getByRole('checkbox', { name: 'Titik PUTS', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Tutup pilihan layer' }).click();
  await page.getByRole('searchbox').fill('TANJUNG RADEN-007'); await page.locator('.atlas-pt').click();
  await expect(page.locator('#popup')).toBeVisible();
  await expect.poll(async () => {
    const coordinates = await page.locator('#popup').evaluate(element => element.parentElement!.style.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)$/)?.slice(1).map(Number));
    if (!coordinates) return 0;
    const screenshot = await page.screenshot({ clip: { x: Math.round(coordinates[0] - 16), y: Math.round(coordinates[1] - 46), width: 32, height: 44 } });
    const { data } = PNG.sync.read(screenshot); let pixels = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] > 230 && data[index + 1] > 190 && data[index + 2] < 70 && data[index + 3] > 190) pixels++;
    return pixels;
  }).toBeGreaterThan(10);
  const scale = await page.locator('.ol-scale-line-inner').textContent();
  await page.getByRole('button', { name: 'Tutup info titik' }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('.ol-scale-line-inner')).toHaveText(scale!);
});

test('selects one reserve without turning on the whole reserve layer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = JSON.parse(readFileSync('data/points.geojson', 'utf8'));
  const reserve = data.features.find((feature: { properties: { Status: string } }) => feature.properties.Status === 'Cadangan');
  expect(reserve).toBeTruthy(); await page.goto('/');
  await page.getByRole('searchbox').fill(reserve.properties.Nomor); await page.locator('.atlas-pt').click();
  await expect(page.locator('#popup')).toBeVisible(); await page.getByRole('button', { name: 'Tampilkan pilihan layer' }).click();
  await expect(page.getByRole('checkbox', { name: 'Titik Cadangan 50 titik', exact: true })).not.toBeChecked();
});

test('serves the emitted manifest launch URL and every app icon', async ({ page, request }) => {
  await page.goto('/'); const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const url = new URL(href!, page.url()); const response = await request.get(url.href); expect(response.ok()).toBe(true);
  const manifest = await response.json();
  for (const target of [manifest.start_url, ...manifest.icons.map((icon: { src: string }) => icon.src)]) {
    expect((await request.get(new URL(target, url).href)).ok()).toBe(true);
  }
});

test('keeps mobile region search in the collapsed sheet peek', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.getByRole('button', { name: 'Lihat daftar titik', exact: true }).click();
  await page.getByRole('button', { name: /Kota Jambi, 72 titik/ }).click();
  await page.getByRole('button', { name: 'Tutup daftar titik', exact: true }).click();
  await expect.poll(() => page.getByRole('searchbox').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(844);
});

test('keeps the point total in the collapsed mobile sheet peek', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await expect(page.getByRole('button', { name: 'Lihat daftar titik', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.atlas-total').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(844);
});

test('restores keyboard focus across region and sidebar navigation', async ({ page }) => {
  await page.goto('/'); const region = page.getByRole('button', { name: /Kota Jambi, 72 titik/ });
  await region.focus(); await page.keyboard.press('Enter');
  const back = page.getByRole('button', { name: 'Kembali ke semua wilayah' }); await expect(back).toBeFocused();
  await back.press('Enter'); await expect(region).toBeFocused();
  await page.getByRole('button', { name: 'Sembunyikan daftar' }).click();
  await expect(page.locator('#panel-toggle')).toBeFocused(); await page.keyboard.press('Tab');
  expect(await page.locator('#sidebar').evaluate(element => element.contains(document.activeElement))).toBe(false);
  await page.locator('#panel-toggle').click(); await expect(page.getByRole('searchbox')).toBeFocused();
});

test('loads map when optional documentation dates are malformed', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const data = JSON.parse(readFileSync('data/points.geojson', 'utf8'));
  data.features[0].properties['Tanggal Dokumentasi'] = '32/13/2026';
  data.features[1].properties['Tanggal Dokumentasi'] = '31/02/9999';
  await page.route('**/data/points.geojson', route => route.fulfill({ json: data }));
  await page.goto('/'); await expect(page.locator('.ol-viewport')).toHaveCount(1);
  await expect(page.getByText('500', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.sidebar-footer')).not.toContainText('9999'); expect(errors).toEqual([]);
});
test('keeps the selected mobile pole below its fixed photo card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('searchbox', { name: 'Cari titik PUTS', exact: true }).fill('TANJUNG RADEN-007');
  await page.getByRole('button', { name: 'Titik 007. RT 04 Tanjung Raden, Kec. Danau Teluk', exact: true }).click();
  await expect.poll(() => page.locator('#popup').evaluate(element => {
    const match = element.parentElement!.style.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)$/);
    return Number(match?.[2]) - element.getBoundingClientRect().bottom;
  })).toBeGreaterThan(30);
  await expect.poll(() => page.locator('#popup').evaluate(element => Number(element.parentElement!.style.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)$/)?.[2]))).toBeLessThan(784);
});
test('preserves counts, point search, photo evidence and route coordinates', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('500', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Kota Jambi, 72 titik/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Cari titik PUTS', exact: true }).fill('TANJUNG RADEN-007');
  await page.getByRole('button', { name: 'Titik 007. RT 04 Tanjung Raden, Kec. Danau Teluk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'RT 04 Tanjung Raden, Kec. Danau Teluk' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Buka foto lokasi/ })).toHaveAttribute('href', '/images/Tanjung-Raden-007-2026-10-06.jpeg');
  await expect(page.getByRole('link', { name: /Rute ke titik ini/ })).toHaveAttribute('href', /destination=-1.584248%2C103.586442/);
  await expect(page.locator('#popup img').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps the selected pin visible after crossing the responsive threshold and returns focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('searchbox', { name: 'Cari titik PUTS', exact: true }).fill('TANJUNG RADEN-007');
  const point = page.getByRole('button', { name: 'Titik 007. RT 04 Tanjung Raden, Kec. Danau Teluk', exact: true });
  await point.click(); await expect(page.locator('#popup')).toBeVisible();
  for (const width of [375, 1280, 960, 959, 390, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expect.poll(async () => page.locator('#popup').evaluate(element => Number((element.parentElement!.style.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)$/) ?? [])[1]))).toBeGreaterThan(24);
    await expect.poll(async () => page.locator('#popup').evaluate(element => Number((element.parentElement!.style.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)$/) ?? [])[1]))).toBeLessThan(width - 24);
    await expect(page.locator('.ol-viewport')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Tutup info titik' }).click();
  await expect(point).toBeFocused();
});

test('opens photo-less unplaced records without offering routes to estimated coordinates', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Kab. Batanghari, 70 titik/ }).click();
  await page.getByRole('button', { name: /Belum Ditetapkan/ }).first().click();
  await expect(page.locator('.atlas-pt')).toHaveCount(1); await page.locator('.atlas-pt').click();
  await expect(page.locator('#popup')).toContainText('Koordinat Perkiraan');
  await expect(page.locator('#popup img')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Rute ke titik ini/ })).toHaveCount(0);
});

test('cycles through overlapping mapped units without deleting or hiding them', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const original = JSON.parse(readFileSync('data/points.geojson', 'utf8'));
  const sample = original.features.find((feature: { properties: { Nomor: string } }) => feature.properties.Nomor === 'KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-007');
  const features = ['001', '002', '003'].map(code => ({ ...sample, properties: { ...sample.properties, Nomor: `KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-${code}`, Keterangan: `Lokasi uji ${code}`, Duplikat: true } }));
  await page.route('**/data/points.geojson', route => route.fulfill({ json: { type: 'FeatureCollection', features } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('searchbox', { name: 'Cari titik PUTS', exact: true }).fill('TANJUNG RADEN');
  await expect(page.locator('.atlas-pt')).toHaveCount(3);
  await page.locator('.atlas-pt').first().click(); await expect(page.locator('#popup')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const first = await page.locator('.atlas-pt[aria-pressed="true"]').getAttribute('data-item-id');
  const coordinate = await page.locator('#popup').evaluate(element => { const match = element.parentElement!.style.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)$/); return { x: Number(match?.[1]), y: Number(match?.[2]) - 16 }; });
  expect(coordinate.y).toBeLessThan(700);
  await page.mouse.click(coordinate.x, coordinate.y);
  await expect.poll(() => page.locator('.atlas-pt[aria-pressed="true"]').getAttribute('data-item-id')).not.toBe(first);
  await expect(page.locator('.atlas-pt')).toHaveCount(3);
});

test('serves only public artifacts with production cache and security headers', async ({ page, request }) => {
  test.skip(!process.env.PUBLIC_TEST_URL, 'Run against Caddy with PUBLIC_TEST_URL to verify serving headers.');
  const response = await request.get('/'); await expect(response).toBeOK();
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const html = await response.text(), script = html.match(/src="(\/assets\/index-[\w-]+\.js)"/)?.[1];
  expect(script).toBeTruthy(); const asset = await request.get(script!);
  expect(asset.headers()['cache-control']).toContain('immutable');
  expect((await request.get('/data/points.geojson')).headers()['cache-control']).toContain('no-cache');
  for (const url of ['/package.json', '/.env', '/docs/', '/scripts/dev-server.py', '/legacy.html', '/custom.js', '/api/flag']) expect((await request.get(url)).status()).toBe(404);
  const violations: string[] = []; page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|violat/.test(message.text())) violations.push(message.text()); });
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await page.getByRole('button', { name: 'Tampilkan pilihan layer' }).click(); await page.locator('label[for="layer-esri"]').click(); await expect(page.getByLabel('Esri Satelit', { exact: true })).toBeChecked();
  expect(violations).toEqual([]);
});
test('keeps the mobile popup within the viewport and supports keyboard closure', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('searchbox', { name: 'Cari titik PUTS', exact: true }).fill('TANJUNG RADEN-007');
  await expect(page.getByRole('button', { name: 'Tutup daftar titik', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Titik 007. RT 04 Tanjung Raden, Kec. Danau Teluk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'RT 04 Tanjung Raden, Kec. Danau Teluk' })).toBeVisible();
  const bounds = await page.locator('#popup').boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0); expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(375);
  await page.keyboard.press('Escape'); await expect(page.locator('#popup')).not.toBeVisible();
});
test('handles data failure, retry and empty successful data', async ({ page }) => {
  let fail = true;
  await page.route('**/data/points.geojson', route => fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue());
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await expect(page.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
  fail = false; await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByText('500', { exact: true }).first()).toBeVisible();
  await page.unroute('**/data/points.geojson');
  await page.route('**/data/points.geojson', route => route.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
  await page.reload(); await expect(page.getByText('Belum ada titik untuk ditampilkan.')).toBeVisible();
});
test('opens regions, filters, and layer options without mounting duplicate maps', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: /Kab. Batanghari, 70 titik/ }).click();
  await expect(page.getByRole('heading', { name: 'Kab. Batanghari' })).toBeVisible();
  await page.getByRole('button', { name: /Perlu Konfirmasi/ }).first().click();
  await expect(page.locator('.atlas-pt')).toHaveCount(1);
  await page.getByRole('button', { name: 'Kembali ke semua wilayah' }).click();
  await page.getByRole('button', { name: 'Tampilkan pilihan layer' }).click();
  await expect(page.getByLabel('Esri Satelit', { exact: true })).toBeVisible();
  await page.locator('label[for="layer-esri"]').click(); await expect(page.getByLabel('Esri Satelit', { exact: true })).toBeChecked();
  await expect(page.locator('.ol-viewport')).toHaveCount(1);
});

test('falls back to Esri and says so in the layer panel when Google refuses the key', async ({ page }) => {
  await stubGoogle(page, 403);
  const tiles: string[] = []; page.on('request', request => { if (/tile.googleapis.com\/v1\/2dtiles|arcgisonline.com/.test(request.url())) tiles.push(request.url()); });
  await page.goto('/'); await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await expect.poll(() => tiles.filter(url => url.includes('arcgisonline.com')).length).toBeGreaterThan(0);
  expect(tiles.filter(url => url.includes('tile.googleapis.com'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Tampilkan pilihan layer' }).click();
  await expect(page.getByLabel('Esri Satelit', { exact: true })).toBeChecked();
});

test('starts on Google, preserves original mobile controls and drags the sheet without a second toggle', async ({ page }) => {
  test.skip(!googleKey, 'Build with VITE_GOOGLE_MAPS_KEY to exercise the Google basemap.');
  await stubGoogle(page, 200);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const tiles: string[] = [];
  page.on('request', request => { if (/tile.googleapis.com\/v1\/2dtiles|arcgisonline.com/.test(request.url())) tiles.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.atlas-total__num')).toHaveText('500');
  await expect.poll(() => tiles.filter(url => url.includes('session=e2e')).length).toBeGreaterThan(0);
  expect(tiles.filter(url => url.includes('arcgisonline.com'))).toHaveLength(0);
  await expect(page.locator('.bottom-attribution')).toBeHidden();
  // Fonts and the introductory motion can move the handle after raw coordinates are read.
  // Avoid hover's automatic scrolling and keep the entire drag inside the viewport.
  await page.evaluate(() => document.fonts.ready);
  const handle = page.locator('#sheet-handle'); const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 12); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, Math.max(20, box!.y - 300), { steps: 10 }); await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
});
