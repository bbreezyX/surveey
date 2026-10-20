import { test as base, expect } from '@playwright/test';

type Imagery = { hold: boolean; slowProvider: string | null; requests: string[]; releaseOne(): void; release(): void };
export const test = base.extend<{ imagery: Imagery }>({
  imagery: [async ({ page }, use) => {
    const held: (() => void)[] = [];
    const imagery: Imagery = { hold: false, slowProvider: null, requests: [], releaseOne() { held.shift()?.(); }, release() { imagery.hold = false; while (held.length) held.shift()!(); } };
    const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    // No Google quota, third-party availability or live progress data is involved in these tests.
    await page.route(/^https:\/\/(tile\.googleapis\.com|services\.arcgisonline\.com)\//, async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname.includes('/createSession')) return route.fulfill({ headers: cors, json: { session: 'connection-tests', expiry: String(Math.floor(Date.now() / 1000) + 86_400) } });
      if (url.pathname.includes('/viewport')) return route.fulfill({ headers: cors, json: { copyright: 'Connection test imagery' } });
      imagery.requests.push(url.origin);
      if (imagery.hold && (!imagery.slowProvider || imagery.slowProvider === url.origin)) await new Promise<void>(resolve => { held.push(resolve); });
      await route.fulfill({ headers: cors, contentType: 'image/png', body: tile });
    });
    await page.route('https://www.esdm.cloud/api/public/survey-progress', route => route.fulfill({ headers: cors, json: [] }));
    try { await use(imagery); }
    finally { imagery.release(); await page.unrouteAll({ behavior: 'wait' }); }
  }, { auto: true }],
});
export { expect };
