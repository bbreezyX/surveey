import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlib } from 'node:zlib';
import path from 'node:path';
import { REGION_ENCODING, encodeRegionCollection } from './region-codec.mjs';
const outputIndex = process.argv.indexOf('--output');
const destination = outputIndex >= 0 ? process.argv[outputIndex + 1] : process.argv.includes('--dev') ? '.superpowers/public-assets' : 'dist/public';
if (!destination) throw new Error('--output requires a destination');
if (process.argv.includes('--dev') && outputIndex < 0) {
  const staging = path.resolve(destination), expected = path.resolve('.superpowers/public-assets');
  if (staging !== expected || !staging.startsWith(path.resolve('.') + path.sep)) throw new Error('Unexpected staging path');
  await rm(staging, { recursive: true, force: true });
}
await mkdir(destination, { recursive: true });
// Explicit filenames prevent future frontend/admin files in assets from leaking.
const publicFiles = ['assets/lambang-jambi.png', 'assets/logo-esdm.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/pjuts-favicon-be521abcfb99.png', 'assets/pjuts-favicon-99490f304b67.ico', 'assets/pjuts-apple-touch-icon-09766f8ae04c.png', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'manifest.json', 'data/points.geojson'];
for (const file of publicFiles) { const target = path.join(destination, file); await mkdir(path.dirname(target), { recursive: true }); await cp(file, target); }
async function copyPhotos(directory = 'images') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    // Symlinks and other file types are never traversed or published.
    if (entry.isDirectory()) await copyPhotos(file);
    else if (entry.isFile() && /\.(jpe?g|png|webp|avif)$/i.test(entry.name)) { const target = path.join(destination, file); await mkdir(path.dirname(target), { recursive: true }); await cp(file, target); }
  }
}
await copyPhotos();
const source = await readFile('layers/BatasKabupaten_1.js', 'utf8');
const match = source.match(/^\s*var\s+json_BatasKabupaten_1\s*=\s*([\s\S]*?);?\s*$/);
if (!match) throw new Error('Boundary export no longer matches its JSON-only format');
const boundaries = JSON.parse(match[1].replace(/;\s*$/, ''));
if (boundaries.type !== 'FeatureCollection' || !Array.isArray(boundaries.features)) throw new Error('Invalid boundary collection');
const dissolved = JSON.parse(await readFile('data/dissolved.geojson', 'utf8'));
if (dissolved.type !== 'FeatureCollection' || !Array.isArray(dissolved.features)) throw new Error('Invalid dissolved collection');
// One compact file for both boundary sets; see region-codec.mjs for why and how.
await writeFile(path.join(destination, 'data', 'regions.json'), JSON.stringify({ encoding: REGION_ENCODING, kabupaten: encodeRegionCollection(boundaries), dissolved: encodeRegionCollection(dissolved, boundaries) }));
// Only after `vite build` has written the page: the dev staging copy and the
// output test have no index.html, and in dev a worker would fight Vite's HMR.
if (existsSync(path.join(destination, 'index.html'))) {
  const assets = (await readdir(path.join(destination, 'assets'))).sort();
  // What the first screen loads, fingerprinted as in Caddyfile.railway-public's
  // immutable rule. Icons and the legacy loader GIF stay out: a precache entry
  // nothing had already downloaded would cost a weak link the full file again.
  const precache = assets.filter(name => /-[A-Za-z0-9_-]{8}\.(js|css|webp|woff2)$/.test(name)).map(name => `/assets/${name}`);
  const version = createHash('sha256').update(await readFile(path.join(destination, 'index.html'))).update(precache.join('\n')).digest('hex').slice(0, 12);
  const worker = (await readFile('scripts/service-worker.js', 'utf8')).replace("'__PUTS_VERSION__'", JSON.stringify(version)).replace('__PUTS_PRECACHE__', JSON.stringify(precache));
  if (worker.includes('__PUTS_')) throw new Error('Service worker placeholders were not all replaced');
  await writeFile(path.join(destination, 'sw.js'), worker);
  // Brotli at its slowest, best setting, done once here instead of Caddy's
  // fast on-the-fly gzip per request (Caddyfile `precompressed br`). Measured:
  // regions.json 78 -> 69 KB and the JS bundle ~144 -> ~120 KB on the wire.
  const compressible = [...assets.filter(name => /\.(js|css|svg|ico)$/.test(name)).map(name => path.join('assets', name)), 'data/regions.json', 'sw.js'];
  for (const file of compressible) {
    const source = await readFile(path.join(destination, file));
    const packed = brotliCompressSync(source, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: source.length } });
    if (packed.length < source.length * 0.9) await writeFile(path.join(destination, `${file}.br`), packed);
  }
}
console.log(`Public assets prepared: ${destination}`);
