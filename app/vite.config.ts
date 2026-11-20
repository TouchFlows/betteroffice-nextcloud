import { createAppConfig } from '@nextcloud/vite-config';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default createAppConfig(
	{
		main: 'src/main.tsx',
		files: 'src/files.ts',
		editor: 'src/editor/main.tsx',
	},
	{
		config: defineConfig({
			plugins: [react()],
			// @betteroffice/docx loads part of its engine in a Web Worker;
			// the default iife worker format can't be code-split, which this
			// multi-entry build otherwise requires.
			worker: { format: 'es' },
			optimizeDeps: {
				// wasm-bindgen glue resolves its .wasm asset via
				// `new URL(..., import.meta.url)` relative to its own file;
				// Vite's dependency pre-bundler rewrites that import.meta.url to
				// its .vite/deps cache dir, breaking the relative lookup (see
				// poc/RECONNAISSANCE.md §6).
				exclude: ['@betteroffice/docx', '@betteroffice/docx-react'],
			},
		}),
		inlineCSS: true,
	},
);
