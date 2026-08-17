import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

// Static build for https://dataguard.davidbudac.cz/ -- relative asset URLs so
// the same bundle serves from any sub-path; zero external requests at runtime.
export default defineConfig({
  base: './',
  plugins: [preact()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: '../_site',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    modulePreload: { polyfill: false },
    /* One stylesheet, one bundle: a page with no external requests has nothing
       to gain from splitting, and the CSP guard has one file to read. */
    cssCodeSplit: false,
    /* Icons and small assets become data: URIs (img-src allows data:); anything
       larger gets a hashed file of its own. */
    assetsInlineLimit: 4096,
  },
});
