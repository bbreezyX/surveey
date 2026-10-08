import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()], publicDir: '.superpowers/public-assets',
  server: { host: '127.0.0.1', port: 8123, strictPort: true },
  build: { outDir: 'dist/public', target: 'es2022', sourcemap: false, emptyOutDir: true },
});
