import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const [baseline, migrated] = process.argv.slice(2);
if (!baseline || !migrated) throw new Error('Provide baseline and migrated URLs');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (let run = 0; run < 3; run++) for (const [label, url] of [['baseline', baseline], ['migrated', migrated]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage(); const sizes = []; let externalFailures = 0;
    page.on('response', response => { if (response.url().startsWith(url) && /\.js(?:\?|$)/.test(response.url())) sizes.push(response.body().then(body => body.length)); });
    page.on('requestfailed', request => { if (!request.url().startsWith(url)) externalFailures++; });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.atlas-total__num').getByText('500', { exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const usableMs = await page.evaluate(() => performance.now());
    const encodedScriptBytes = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.js(?:\?|$)/.test(entry.name) && new URL(entry.name).origin === location.origin).reduce((sum, entry) => sum + (entry instanceof PerformanceResourceTiming ? entry.encodedBodySize : 0), 0));
    const scriptBytes = (await Promise.all(sizes)).reduce((total, value) => total + value, 0);
    results.push({ label, run: run + 1, usableMs: Math.round(usableMs), scriptBytes, encodedScriptBytes, externalFailures }); await context.close();
  }
} finally { await browser.close(); }
await mkdir('.superpowers/sdd/2026-10-08-public-map-modernization', { recursive: true });
await writeFile('.superpowers/sdd/2026-10-08-public-map-modernization/performance.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
