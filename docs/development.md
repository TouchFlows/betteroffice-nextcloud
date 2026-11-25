# Development setup

## Prerequisites

- PHP 8.3–8.5 (Nextcloud 35 requires at minimum 8.3), Composer 2.x
- Node 20, 22 or 24 (see each `package.json`'s `engines` field)
- A local Nextcloud 31–35 install to mount `app/` into, to test the actual
  Files integration (file action, routes, controllers) in a real Nextcloud.
  **Not available in this environment** (no Docker) — `app/`'s PHP is only
  verified against mocked OCP interfaces (`app/tests/Unit`) and its editor
  frontend only against a standalone mock of the document API
  (`app/tests/e2e`), never against a live Nextcloud. Treat anything
  Nextcloud-integration-specific as code-reviewed against the real OCP
  source, not run.
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
Phase 2 this gets you: a "Open with BetterOffice" DOCX file action (also the
double-click default), a DOCX editor page, and non-collaborative
read/save with ETag conflict detection. XLSX/PPTX and collaboration are
later phases — see PLAN.md §17.

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
