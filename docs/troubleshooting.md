# Troubleshooting

## Development

### Vite build warns "build.outDir must not be the same directory of root..."

Seen building `app/` with `@nextcloud/vite-config`'s `createAppConfig`. The
build still produces correct output (`app/js/betteroffice-main.mjs`) —
this is a known benign warning from how that tooling lays out Nextcloud
app's `js/` next to `src/`, not a misconfiguration introduced here.

### A `@betteroffice/*` package throws `WebAssembly.compile(): expected magic word`

This means the bundler fetched your app's `index.html` instead of the
package's `.wasm` asset — almost always a Vite dev-server dependency
pre-bundling issue: esbuild moves the module into `.vite/deps/`, which
breaks the package's `new URL('./foo.wasm', import.meta.url)` resolution.
Exclude every `@betteroffice/*` package from `optimizeDeps` in `vite.config.ts`
(already done in `poc/vite.config.ts` — mirror it in `app/vite.config.ts`
once the app actually imports these packages in Phase 2). Full writeup:
`poc/RECONNAISSANCE.md` §6.

### `@betteroffice/xlsx` or `@betteroffice/pptx`'s `initWasm()` fails outside a browser

Their default loader assumes `fetch()` can reach a relative URL, which
doesn't work from plain Node. Pass the `.wasm` bytes explicitly: read
`node_modules/@betteroffice/<pkg>/dist/generated/*.wasm` and hand it to
`initWasm(bytes)`. `@betteroffice/docx`'s `/yrs` entry point does not have
this problem and runs headlessly in Node without it.

### PHPUnit install fails with a PHP version conflict

`phpunit/phpunit` ^13 requires PHP ≥8.4.1; this project's declared minimum
is PHP 8.3 (matching Nextcloud 35's floor). Use `phpunit/phpunit` ^12
instead (already pinned in `app/composer.json`) — don't raise the app's own
PHP floor just to chase a newer PHPUnit.

### `Class "OCP\AppFramework\App" not found` running PHPUnit

`nextcloud/ocp` ships the OCP classes but declares no autoload mapping of
its own (it's meant for IDE/static-analysis, not runtime — the real classes
come from a booted Nextcloud server). `app/composer.json`'s `autoload-dev`
maps `OCP\` to `vendor/nextcloud/ocp/OCP/` for exactly this reason; if you
see this error after adding a new dev dependency, check you didn't
regenerate the autoloader without that mapping still present
(`composer dump-autoload`).

## Nothing here yet for a running Nextcloud/relay deployment

Because there isn't one. This section grows as Phases 2–8 add real
behaviour to troubleshoot.
