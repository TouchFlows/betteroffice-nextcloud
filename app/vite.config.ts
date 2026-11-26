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
function patchWorkerWasmAssetUrls({ requireMatch = false }: { requireMatch?: boolean } = {}): Plugin {
	// Quote-agnostic on purpose. Vite 7's esbuild-based build emits the call
	// with double quotes, but Vite 8's rolldown build re-quotes the very same
	// string literals as template literals:
	//
	//   window.OC.filePath(`betteroffice`,``,`assets/docx_parse_bg-XXXX.wasm`)
	//
	// A double-quote-only pattern matched 2 calls on Vite 7 and 0 on Vite 8,
	// so the worker shipped unpatched and threw `ReferenceError: window is not
	// defined` on the first save. Each literal captures its own quote
	// character and closes with a matching backreference, so mixed styles
	// (`"betteroffice", "", `assets/x.wasm``) still match too.
	const pattern =
		/window\.OC\.filePath\(\s*(["'`])betteroffice\1\s*,\s*(["'`])\2\s*,\s*(["'`])([^"'`]+)\3\s*\)/g;
	let patchedCalls = 0;
	return {
		name: 'betteroffice-patch-worker-wasm-asset-urls',
		generateBundle(_options, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type !== 'chunk') continue;
				const matches = file.code.match(pattern);
				if (!matches) continue;
				patchedCalls += matches.length;
				file.code = file.code.replace(
					pattern,
					(_match, _packageQuote, _webrootQuote, _pathQuote, path: string) =>
						`(typeof window !== "undefined" ? window.OC.filePath("betteroffice","","${path}") : new URL("${path.split('/').pop()}", self.location.href).href)`,
				);
			}
			// Nothing else in this repo builds a worker bundle and inspects it,
			// so a pattern that stops matching would only surface as a runtime
			// error on the user's first save. Fail here instead of shipping it.
			if (requireMatch && patchedCalls === 0) {
				this.error(
					'patchWorkerWasmAssetUrls() matched no window.OC.filePath(...) call in the worker bundle, so the worker would ship unpatched and throw "ReferenceError: window is not defined" on first save. The wasm asset URL rewrite emitted by @nextcloud/vite-config has likely changed shape (or the call is no longer minified the way this pattern expects) -- inspect the emitted worker chunk and update the pattern.',
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
		settings: 'src/settings/main.tsx',
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
			worker: {
				format: 'es',
				// requireMatch: the worker chunk is the one that must be patched;
				// a worker build that patches nothing is the exact regression
				// that Vite 8's re-quoting introduced.
				plugins: () => [patchWorkerWasmAssetUrls({ requireMatch: true })],
			},
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
