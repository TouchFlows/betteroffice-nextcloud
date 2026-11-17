# Installation

Not yet applicable — there is nothing here worth installing in production.
This stub exists so the layout PLAN.md §2 calls for is in place; it gets
real content once Phase 6 ("Production hardening") and Phase 8 (App Store
publication) are reached.

## What will go here

- Installing the Nextcloud app (`nextcloud/apps/betteroffice/` — PLAN.md
  §14) and enabling it.
- Deploying the relay as a systemd service
  (`relay/deploy/betteroffice-relay.service`), its MariaDB database, and the
  Nginx/HAProxy configuration in front of both (§14.1).
- First-run checks: the relay's `/health` endpoint, a smoke-test document
  open in each format.

## What exists today

- `app/`: builds and passes its own tests standalone (see
  `docs/development.md`); not yet meaningful installed into a real
  Nextcloud, since it has no editor functionality (Phase 1 ships a blank
  page).
- `relay/`: runs standalone with a health endpoint and a migration runner
  against an empty schema; nothing to install into a production relay
  deployment yet.
