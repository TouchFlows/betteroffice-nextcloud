# Development setup

## Prerequisites

- PHP 8.3–8.5 (Nextcloud 35 requires at minimum 8.3), Composer 2.x
- Node 20, 22 or 24 (see each `package.json`'s `engines` field)
- A local Nextcloud 31–35 install to mount `app/` into, to test the actual
  Files integration (file action, routes, controllers, the editor page's CSP)
  in a real Nextcloud. The automated suites still mock Nextcloud — the PHP
  against the OCP stubs (`app/tests/Unit`), the frontend against a standalone
  mock of the document API (`app/tests/e2e`) — so anything that only breaks
  inside Nextcloud is caught by "Running against a real Nextcloud" below, not
  by those suites.
- MariaDB (or PostgreSQL/SQLite for the app; the relay requires MariaDB —
  PLAN.md §5.2) once you're working on persistence.

## The Nextcloud app (`app/`)

```bash
cd app
composer install
npm install

composer lint        # php -l
composer cs:check    # nextcloud/coding-standard via php-cs-fixer; cs:fix to apply
composer test:unit   # PHPUnit, no running Nextcloud server required

npm run typecheck
npm run build        # outputs js/, loaded via Util::addScript (main/files/editor entries)
npm run dev          # same, in watch mode
npm run test:e2e     # Playwright -- see tests/e2e/ and the note below
npm run test:live    # two real users against a real Nextcloud -- see below
```

`npm run test:e2e` starts two processes of its own (see
`tests/e2e/playwright.config.ts`): the harness Vite server, and the **real**
relay (`relay/src/server.ts`, port 8788) against a **real** MariaDB. Nextcloud
itself is still mocked (`mockDocumentApi.ts`, `mockCollaborationApi.ts`), but
the collaboration path -- session/seed handshake, transport, provider, relay
sync and persistence -- is real, because that is what the suite exists to
prove. Before the first run:

- `npm install` in `relay/` (the relay process is started with `npx tsx`)
- a migrated relay database: `cd relay && npm run migrate`. The defaults match
the local test database (`betteroffice_relay_test`); override with
  `BETTEROFFICE_RELAY_DB_HOST/NAME/USER/PASSWORD`.

CI does the same in `app-ci.yml`'s frontend job, using a MariaDB service
container like `relay-ci.yml`.

To actually run it inside Nextcloud: symlink or copy `app/` to
`<nextcloud>/apps/betteroffice`, then `occ app:enable betteroffice`. As of
Phase 3 this gets you: an "Open with BetterOffice" DOCX file action (also the
double-click default), the DOCX editor page with live collaboration and
presence, and read/save with ETag conflict detection. XLSX/PPTX are later
phases — see PLAN.md §17. Point the app at a relay and run the two-user check
as described in "Running against a real Nextcloud" below.

## Running against a real Nextcloud

This is the check the mocked suites cannot replace: CSP, the avatar route, the
collaboration routes, and two real accounts sharing one document.

Prerequisites: a Nextcloud 31–35 install with the app mounted, two users, a
DOCX in one user's files shared with the other, a second copy shared with the
second user *read-only* (for the read-only badge), and a running relay whose
`BETTEROFFICE_RELAY_ALLOWED_ORIGIN` is *exactly* the origin you open in the
browser (scheme, host and port — `http://127.0.0.1:8099` and
`http://localhost:8099` are different origins to the relay and to CORS). It
uses the same Playwright Chromium as `npm run test:e2e`.

```bash
# 1. Mount and enable the app
ln -s "$PWD/app" /path/to/nextcloud/apps/betteroffice
php /path/to/nextcloud/occ app:enable betteroffice

# 2. Point the app at the relay; give the relay the app's secret
php /path/to/nextcloud/occ config:app:set betteroffice relay_url --value=ws://127.0.0.1:8788
php /path/to/nextcloud/occ config:app:get betteroffice collaboration_secret   # generated on first read

# 3. Share a DOCX with the second user; the file id is `item_source` in the reply
curl -u alice:password -H 'OCS-APIRequest: true' \
  -X POST 'http://127.0.0.1:8099/ocs/v2.php/apps/files_sharing/api/v1/shares' \
  --data-urlencode 'path=/demo.docx' --data-urlencode 'shareType=0' \
  --data-urlencode 'shareWith=bob' --data-urlencode 'permissions=31'

# 3b. And a copy of it read-only, for the read-only badge
curl -u alice:password -H 'OCS-APIRequest: true' \
  -X POST 'http://127.0.0.1:8099/ocs/v2.php/apps/files_sharing/api/v1/shares' \
  --data-urlencode 'path=/demo-readonly.docx' --data-urlencode 'shareType=0' \
  --data-urlencode 'shareWith=bob' --data-urlencode 'permissions=1'

# 4. Serve Nextcloud (the built-in server needs /index.php/... for app routes)
cd /path/to/nextcloud && php -S 127.0.0.1:8099 -t .

# 5. Run the check, in another shell, with the relay running
cd app
BETTEROFFICE_LIVE_URL=http://127.0.0.1:8099 \
BETTEROFFICE_LIVE_FILE_ID=187 \
BETTEROFFICE_LIVE_READONLY_FILE_ID=274 \
BETTEROFFICE_LIVE_USER=alice BETTEROFFICE_LIVE_PASSWORD=... \
BETTEROFFICE_LIVE_PEER=bob BETTEROFFICE_LIVE_PEER_PASSWORD=... \
npm run test:live
```

`test:live` logs both accounts in through Nextcloud's own login form, opens
`/apps/betteroffice/editor/<fileId>` in each, waits for the collaboration
status to reach `connected`, and asserts each editor lists the other
participant with the role Nextcloud's share permissions gave them — `write`,
or `read` plus the "read-only" badge for the read-only share — and with an
avatar that actually painted (a non-zero `naturalWidth`) from Nextcloud's
avatar route. `BETTEROFFICE_LIVE_READONLY_FILE_ID` is optional: without it the
read-only badge is reported as `SKIP` rather than silently passing.

Failures are `FAIL` lines naming the account, the file and the cause: the
collaboration status, any CSP violation the page logged, and whether the
relay's `/health` answers (so "the relay is down" is not confused with "the
page's CSP blocks the socket"). The exit status is non-zero, which makes it
usable as a smoke test after a Nextcloud or BetterOffice upgrade.

### The editor page's Content-Security-Policy

Nextcloud's default policy cannot run these editors, and the failure is
invisible from the server: the page loads, the status bar reads "Live
collaboration is unavailable right now — you are editing on your own", and
nothing is logged server-side. `lib/Service/EditorContentSecurityPolicy.php`
is what makes the page work; it adds two things to the default policy:

- `'wasm-unsafe-eval'` — every BetterOffice editor is a WebAssembly module and
  the default `script-src` refuses to compile it (core's `files_pdfviewer`
  makes the same allowance for pdf.js).
- the configured relay's origin in `connect-src`, in both its `ws(s)://` and
  `http(s)://` forms — the socket and the presence roster live on the relay,
  and the default is `connect-src 'self'`.

`test:live` fails on a missing policy and prints the CSP violation it saw, so a
regression there is caught by running it once against a real instance.

## The relay (`relay/`)

```bash
cd relay
npm install
cp .env.example .env   # point at a local MariaDB
npm run typecheck
npm test
npm run dev             # tsx watch, serves :8787 (just /health right now)
```

See [`relay/README.md`](../relay/README.md) for the database setup and
production build/deploy steps.

## The Phase 0 proof of concept (`poc/`)

Frozen reference, not part of the shipped app or relay. See
[`poc/RECONNAISSANCE.md`](../poc/RECONNAISSANCE.md) for what it proves and
how to run its Playwright suite.

## Before relying on any BetterOffice or Nextcloud API

Check the actual installed version, not memory or an older example:

```bash
# BetterOffice packages (app/)
npm ls @betteroffice/docx @betteroffice/docx-react @betteroffice/xlsx \
       @betteroffice/xlsx-react @betteroffice/pptx @betteroffice/pptx-react

# Nextcloud OCP surface used for IDE/static-analysis only, never shipped
cat app/vendor/nextcloud/ocp/composer.json
```

PLAN.md §3 and `poc/RECONNAISSANCE.md` record what was true for the pinned
`0.5.1` BetterOffice packages at Phase 0 time — re-verify before relying on
anything from there once those versions move.
