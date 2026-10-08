import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
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
const publicFiles = ['assets/lambang-jambi.png', 'assets/logo-esdm.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/pjuts-favicon-be521abcfb99.png', 'assets/pjuts-favicon-99490f304b67.ico', 'assets/pjuts-apple-touch-icon-09766f8ae04c.png', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'manifest.json', 'data/points.geojson', 'data/dissolved.geojson'];
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
await writeFile(path.join(destination, 'data', 'kabupaten.geojson'), JSON.stringify(boundaries));
console.log(`Public assets prepared: ${destination}`);
