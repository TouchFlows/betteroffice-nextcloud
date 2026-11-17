import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'app',
  plugins: [react()],
  server: {
    port: 5183,
    strictPort: true,
  },
  publicDir: '../sample-files',
  optimizeDeps: {
    // These ship wasm-bindgen glue that resolves its .wasm asset via
    // `new URL(..., import.meta.url)` relative to its own file. Vite's
    // dependency pre-bundler rewrites that import.meta.url to the
    // .vite/deps cache directory, breaking the relative lookup — so these
    // packages must be served from their real node_modules location instead.
    exclude: [
      '@betteroffice/docx',
      '@betteroffice/docx-react',
      '@betteroffice/xlsx',
      '@betteroffice/xlsx-react',
      '@betteroffice/pptx',
      '@betteroffice/pptx-react',
      '@betteroffice/fonts',
    ],
  },
});
