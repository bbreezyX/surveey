import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()], publicDir: '.superpowers/public-assets',
  server: { host: '127.0.0.1', port: 8123, strictPort: true, proxy: {
    '/data/points.geojson': { target: 'https://survey.esdm.cloud', changeOrigin: true },
    '/media/': { target: 'https://survey.esdm.cloud', changeOrigin: true },
  } },
  // Build previews and browser fixtures exercise their own snapshot; only the
  // interactive dev server follows the live publication and its opaque media.
  preview: { proxy: {} },
  build: { outDir: 'dist/public', target: 'es2022', sourcemap: false, emptyOutDir: true },
});
