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

## Running Nextcloud deployment

### The "Open with BetterOffice" file action never appears

Check which event the listener is registered for. Nextcloud dispatches
`OCP\Collaboration\Resources\LoadAdditionalScriptsEvent` when the Files app
renders — not `OCA\Files\Event\LoadAdditionalScriptsEvent`, which also
exists (and will autoload and register without error) but is simply never
fired. Confirmed by reading how richdocuments' own file action registers.
This fails silently: no error, the listener just never runs.

### A script/style 404s even though `Util::addScript()`/`addStyle()` is called

`@nextcloud/vite-config` names the built chunk with the app id as a
prefix (`betteroffice-main.mjs`, `betteroffice-files.mjs`,
`betteroffice-editor.mjs`), and `JSResourceLocator` looks for the exact
filename passed. Passing the unprefixed name (`'main'`) looks right in
code review and typechecks fine — it only 404s when actually loaded by a
running Nextcloud.

### A route only reached by a plain navigation (`window.location.href`) 403s

Nextcloud's CSRF middleware runs on all requests by default. A route that
is never reached via an XHR carrying a CSRF token (e.g. the Files file
action, which navigates with `window.location.href`) needs
`#[NoCSRFRequired]` — same reasoning as the canonical
`nextcloud/app_template` `PageController`.

### `DocumentService::save()` (or anything calling `File::putContent()`) throws `LockedException`

Don't wrap `putContent()` in a manual `lock()`/`unlock()`. `View::basicOperation()`
already runs its own full lock lifecycle around `putContent()`
(`lockFile(LOCK_SHARED)`, `changeLock(LOCK_EXCLUSIVE)`, write, change back,
unlock). A caller-held `LOCK_EXCLUSIVE` leaves the stored lock value as the
string `"exclusive"` where `putContent()`'s own `lockFile(LOCK_SHARED)`
expects an integer holder count, so it always throws; a caller-held
`LOCK_SHARED` makes the holder count 2 where `putContent()`'s own
`changeLock(LOCK_EXCLUSIVE)` requires exactly 1. Confirmed against
`MemcacheLockingProvider::acquireLock()`/`changeLock()`. Nextcloud's own
bundled apps (`text`, `richdocuments`) call `putContent()` with no lock of
their own, for the same reason.

### A `@betteroffice/*` package throws `window is not defined`, but only in production and only on first save

`@betteroffice/docx` loads part of its engine in a Web Worker, lazily, on
first use — so this doesn't show up on initial document load, only once
something actually triggers the worker (typically the first save).
`@nextcloud/vite-config` rewrites `new URL(..., import.meta.url)` asset
references into `window.OC.filePath(...)`, which is correct on the main
thread but doesn't exist inside the worker. `app/vite.config.ts`'s
`patchWorkerWasmAssetUrls()` plugin patches this: on the main thread
nothing changes, inside the worker it falls back to a relative URL off
`self.location.href`. This can't be exercised by `tests/e2e` (that harness
never goes through `@nextcloud/vite-config`, so the rewrite it's patching
around doesn't happen there either) — it has to be checked against a real
deployment.

### A redeployed static asset (JS/CSS) still serves the old bytes

Two independent caches sit between the file on disk and what you see,
and neither is Nextcloud's:

- **HAProxy's response cache**, if the fleet host runs one in front of
  the vhost (see `haproxy-response-cache`): it treats any
  `Cache-Control: immutable` response as cacheable for its own TTL,
  regardless of how long the origin's `max-age` says. Reloading HAProxy
  (`sudo systemctl reload haproxy`) starts fresh workers with an empty
  cache — immediate, safe, nothing persisted to disk. Tell: the stale
  response carries an `Age:` header; `curl` straight to the vhost from
  the host itself, with a fresh connection, shows whether the *origin*
  is already serving the new bytes.
- **Chrome's own in-renderer (Blink) memory cache.** Even after clearing
  the browser's HTTP cache and any Service Worker/Cache Storage entries
  (`Network.clearBrowserCache`, unregistering service workers, deleting
  `caches.keys()`), a plain reload of an already-open tab can keep
  serving an `immutable` asset's previously-loaded bytes — the `Date`/
  `Age`/`ETag` on the "response" stay frozen at whatever they were on
  first load. A real hard reload (CDP `Page.reload({ ignoreCache: true
  })`, or Ctrl+Shift+R) is what actually bypasses it.

When verifying a redeploy against a live instance, check both before
concluding the fix isn't live: curl the asset directly (no `Age` header,
or a small/growing one) *and* hard-reload the browser tab.
