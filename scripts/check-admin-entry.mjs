import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] ?? 'https://survey.esdm.cloud').origin;
const get = (path, options = {}) => fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(20_000) });
const entry = await get('/admin', { redirect: 'manual' });
assert.equal(entry.status, 308, 'The bare /admin entry must redirect instead of returning an empty page');
assert.equal(new URL(entry.headers.get('location'), origin).href, `${origin}/admin/`);

const login = await get('/admin/');
assert.equal(login.status, 200);
assert.match(login.headers.get('content-type') ?? '', /text\/html/);
assert.match(login.headers.get('cache-control') ?? '', /private.*no-store/);
const html = await login.text();
assert.match(html, /<form\b[^>]*action="\/admin\/login"/);
assert.match(html, /name="username"/);
assert.match(html, /name="password"/);

const assets = [...html.matchAll(/(?:src|href)="(\/admin\/assets\/[^" ]+\.(js|css))"/g)].map(match => match[1]);
assert.ok(assets.some(asset => asset.endsWith('.js')) && assets.some(asset => asset.endsWith('.css')), 'Login must reference its JavaScript and CSS');
for (const path of assets) {
  const asset = await get(path);
  assert.equal(asset.status, 200, path);
  assert.match(asset.headers.get('content-type') ?? '', path.endsWith('.js') ? /javascript/ : /text\/css/, path);
  assert.match(asset.headers.get('cache-control') ?? '', /private.*no-store/, path);
  assert.ok((await asset.arrayBuffer()).byteLength > 0, `${path} must not be empty`);
}
console.log(JSON.stringify({ origin, bare_admin: 308, login: 200, assets: assets.length, result: 'passed' }));
