# Development setup

## Prerequisites

- PHP 8.3–8.5 (Nextcloud 35 requires at minimum 8.3), Composer 2.x
- Node 20, 22 or 24 (see each `package.json`'s `engines` field)
- A local Nextcloud 31–35 install to mount `app/` into, once Phase 2 adds
  anything worth running inside one. Until then, `app/` builds and tests
  standalone.
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
npm run build        # outputs js/, loaded by templates/index.php via Util::addScript
npm run dev          # same, in watch mode
```

To actually run it inside Nextcloud: symlink or copy `app/` to
`<nextcloud>/apps/betteroffice`, then `occ app:enable betteroffice`. This
isn't meaningful yet (Phase 1 ships a blank page) — see PLAN.md §17 for when
each capability lands.

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
