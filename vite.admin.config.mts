import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import GeoJSON from 'ol/format/GeoJSON.js';

// The admin's map backdrop only ever shows the whole province, so boundary
// detail finer than ~100 m is invisible. Simplifying here keeps the login
// page (which loads these anonymously, uncompressed) to a few hundred KB
// instead of 1.4 MB. Fixed filenames are fine: every admin response is
// no-store.
function mapGeometry(): Plugin {
  const format = new GeoJSON();
  const simplify = (raw: string) => {
    const features = format.readFeatures(JSON.parse(raw));
    for (const feature of features) feature.setGeometry(feature.getGeometry()!.simplify(0.001));
    return format.writeFeatures(features, { decimals: 5 });
  };
  return {
    name: 'admin-map-geometry',
    generateBundle() {
      const kabupaten = readFileSync('layers/BatasKabupaten_1.js', 'utf8').match(/^\s*var\s+json_BatasKabupaten_1\s*=\s*([\s\S]*?);?\s*$/);
      if (!kabupaten) throw new Error('Boundary export no longer matches its JSON-only format');
      this.emitFile({ type: 'asset', fileName: 'assets/kabupaten.json', source: simplify(kabupaten[1].replace(/;\s*$/, '')) });
      this.emitFile({ type: 'asset', fileName: 'assets/provinsi.json', source: simplify(readFileSync('data/dissolved.geojson', 'utf8')) });
    },
  };
}

export default defineConfig({
  base: '/admin/', root: 'admin', plugins: [svelte(), mapGeometry()], publicDir: false,
  build: {
    outDir: '../dist/admin', target: 'es2022', sourcemap: false, emptyOutDir: true,
    // The server reads the manifest to find the login entry's hashed files,
    // the only build files anonymous visitors may fetch.
    manifest: true,
    rollupOptions: { input: { app: resolve(import.meta.dirname, 'admin/index.html'), login: resolve(import.meta.dirname, 'admin/src/login.ts') } },
  },
});
