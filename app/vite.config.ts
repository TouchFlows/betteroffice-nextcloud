import { createAppConfig } from '@nextcloud/vite-config';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * @nextcloud/vite-config rewrites @betteroffice/docx's wasm-bindgen asset
 * URLs from a plain `new URL(..., import.meta.url)` into
 * `window.OC.filePath("betteroffice", "", "assets/foo.wasm")`, so the asset
 * resolves correctly under Nextcloud's webroot/rewrite rules. That's correct
 * on the main thread, but @betteroffice/docx lazily loads its edit/parse
 * wasm *inside its own Web Worker* on first use (effectively: on first
 * save) -- and a Worker has no `window`, so that call throws
 * `ReferenceError: window is not defined`, caught internally and reported
 * as a "recoverable" error that never reaches onSave. Confirmed against a
 * live Nextcloud 34 deployment (cloud.touchflows.com) by extracting the
 * literal minified source of the worker chunk.
 *
 * Patches only the worker-context fallback: on the main thread (where
 * `window.OC.filePath` is correct and already accounts for Nextcloud's
 * configured webroot) nothing changes; inside a worker, the wasm file is a
 * sibling of the worker's own script, so a relative URL off
 * `self.location.href` resolves it without needing `window` at all.
 */
function patchWorkerWasmAssetUrls(): Plugin {
	const pattern = /window\.OC\.filePath\("betteroffice","","([^"]+)"\)/g;
	return {
		name: 'betteroffice-patch-worker-wasm-asset-urls',
		generateBundle(_options, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type !== 'chunk' || !pattern.test(file.code)) continue;
				pattern.lastIndex = 0;
				file.code = file.code.replace(
					pattern,
					(_match, path: string) =>
						`(typeof window !== "undefined" ? window.OC.filePath("betteroffice","","${path}") : new URL("${path.split('/').pop()}", self.location.href).href)`,
				);
			}
		},
	};
}

export default createAppConfig(
	{
		main: 'src/main.tsx',
		files: 'src/files.ts',
		editor: 'src/editor/main.tsx',
	},
	{
		config: defineConfig({
			plugins: [react(), patchWorkerWasmAssetUrls()],
			// @betteroffice/docx loads part of its engine in a Web Worker;
			// the default iife worker format can't be code-split, which this
			// multi-entry build otherwise requires.
			// Worker bundles go through Vite's own separate build pipeline
			// with its own plugin list (a factory, per Vite's docs) -- the
			// main `plugins` array above never sees worker chunks, which is
			// why patchWorkerWasmAssetUrls() needs registering here too.
			worker: { format: 'es', plugins: () => [patchWorkerWasmAssetUrls()] },
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
