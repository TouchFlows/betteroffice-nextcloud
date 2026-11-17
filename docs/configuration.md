# Configuration

## Relay

Environment variables, documented in [`relay/.env.example`](../relay/.env.example):

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `BETTEROFFICE_RELAY_PORT` | no | `8787` | HTTP/WS listen port |
| `BETTEROFFICE_RELAY_DB_HOST` | no | `127.0.0.1` | |
| `BETTEROFFICE_RELAY_DB_PORT` | no | `3306` | |
| `BETTEROFFICE_RELAY_DB_NAME` | **yes** (`migrate` only, today) | — | Dedicated database, PLAN.md §5.2 |
| `BETTEROFFICE_RELAY_DB_USER` | **yes** (`migrate` only, today) | — | Must not be Nextcloud's DB user |
| `BETTEROFFICE_RELAY_DB_PASSWORD` | **yes** (`migrate` only, today) | — | |

The server itself (`relay/src/server.ts`) does not touch the database yet —
only `npm run migrate` requires the DB variables, today. That changes once
Phase 3 adds real persistence, at which point the server will require them
too.

## Nextcloud app

No app-specific admin settings exist yet (Phase 1 has no settings page). This
section gets real content alongside the admin settings PLAN.md §4.A and
§11 call for (collaboration relay URL, token signing configuration, etc.).

## Hostnames

Never hardcode a relay hostname anywhere in `app/` — it is deployment
configuration (PLAN.md §14), read from the app's own (not-yet-built) admin
settings or app config, not a constant in source.
