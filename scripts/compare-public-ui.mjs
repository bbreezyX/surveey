import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = '.superpowers/sdd/2026-10-08-public-map-modernization/ui';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const result = [];
try {
  for (const width of [1280, 390]) {
    const snapshots = {};
    for (const [label, url] of [['original', 'http://127.0.0.1:8126/'], ['migrated', 'http://127.0.0.1:8125/']]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      await page.goto(url); await page.locator('.atlas-total__num').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const button = page.getByRole('button', { name: 'Tampilkan pilihan layer', exact: true }); await button.click();
      if (!await page.locator('.layer-switcher').evaluate(element => element.classList.contains('shown'))) await button.click();
      await page.locator('.layer-switcher .panel').waitFor();
      snapshots[label] = await page.evaluate(() => Object.fromEntries(['.masthead', '#sidebar', '.panel-search', '.atlas-total__num', '.atlas-cell', '.layer-switcher', '.layer-switcher > button', '.layer-switcher .panel', '.layer-switcher .panel li.layer', '.ctl-switch__track', '.layer-switcher__watermark', '.ol-zoom', '.map-meta__info'].map(selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, font: style.font, color: style.color, background: style.background, border: style.border, radius: style.borderRadius }];
      })));
      await page.screenshot({ path: `${directory}/${label}-${width}.png` });
      await page.close();
    }
    const differences = Object.keys(snapshots.original).filter(selector => JSON.stringify(snapshots.original[selector]) !== JSON.stringify(snapshots.migrated[selector])).map(selector => ({ selector, original: snapshots.original[selector], migrated: snapshots.migrated[selector] }));
    result.push({ width, differences });
  }
} finally { await browser.close(); }
await writeFile(`${directory}/comparison.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
