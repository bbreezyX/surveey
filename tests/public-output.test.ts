import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const brands = ['lambang-jambi.png', 'logo-esdm.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
it('copies only intended public files even when admin, environment and docs sentinels exist', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'surveey-output-'));
  try {
    for (const dir of ['assets', 'images', 'webfonts', 'data', 'layers', 'docs', 'admin']) mkdirSync(path.join(root, dir));
    for (const name of [...brands, 'pjuts-favicon-master.png', 'pjuts-favicon-be521abcfb99.png', 'pjuts-favicon-99490f304b67.ico', 'pjuts-apple-touch-icon-09766f8ae04c.png']) writeFileSync(path.join(root, 'assets', name), 'brand');
    for (const name of ['favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'manifest.json']) writeFileSync(path.join(root, name), '{}');
    for (const name of ['points.geojson', 'dissolved.geojson']) writeFileSync(path.join(root, 'data', name), '{"type":"FeatureCollection","features":[]}');
    writeFileSync(path.join(root, 'layers/BatasKabupaten_1.js'), 'var json_BatasKabupaten_1 = {"type":"FeatureCollection","features":[]};');
    for (const name of ['.env', 'assets/admin.js', 'images/private.env', 'docs/secret.md', 'admin/index.js']) writeFileSync(path.join(root, name), 'NEVER_PUBLISH_THIS_SENTINEL');
    writeFileSync(path.join(root, 'images/survey.jpeg'), 'public-photo');
    const output = path.join(root, 'output');
    execFileSync(process.execPath, [path.resolve('scripts/build-public-assets.mjs'), '--output', output], { cwd: root });
    expect(existsSync(path.join(output, 'images/survey.jpeg'))).toBe(true);
    for (const name of ['.env', 'assets/admin.js', 'images/private.env', 'docs/secret.md', 'admin/index.js']) expect(existsSync(path.join(output, name))).toBe(false);
    expect(readdirSync(path.join(output, 'data')).sort()).toEqual(['points.geojson', 'regions.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('builds a hashed public entry without legacy vendors, write routes or source maps', () => {
  const html = readFileSync('dist/public/index.html', 'utf8');
  expect(html).toMatch(/\/assets\/index-[\w-]+\.js/);
  expect(html).not.toMatch(/custom\.js|resources\/ol\.js|\/src\/|\/api\/flag|\/admin/);
  function walk(root: string): string[] { return readdirSync(root, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(root, item.name)) : [path.join(root, item.name)]); }
  const files = walk('dist/public');
  expect(files.filter(file => /\.map$|\.env|(?:^|[\\/])(?:docs|scripts|admin|node_modules)(?:[\\/]|$)/.test(file))).toEqual([]);
  for (const file of files.filter(file => /\.js$/.test(file))) expect(readFileSync(file, 'utf8')).not.toMatch(/\/api\/flag|NEVER_PUBLISH_THIS_SENTINEL|CF_ACCESS_CLIENT_SECRET/);
  expect(readFileSync('Dockerfile', 'utf8')).toContain('COPY --from=build /app/dist/public/ /srv/');
  expect(readFileSync('Dockerfile', 'utf8')).not.toMatch(/COPY\s+\.\s+\/srv/);
});
