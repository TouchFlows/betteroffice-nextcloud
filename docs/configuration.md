# Configuration

## Relay

Environment variables, documented in [`relay/.env.example`](../relay/.env.example):

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `BETTEROFFICE_RELAY_PORT` | no | `8787` | HTTP/WS listen port |
| `BETTEROFFICE_RELAY_DB_HOST` | no | `127.0.0.1` | |
| `BETTEROFFICE_RELAY_DB_PORT` | no | `3306` | |
| `BETTEROFFICE_RELAY_DB_NAME` | **yes** | — | Dedicated database, PLAN.md §5.2 |
| `BETTEROFFICE_RELAY_DB_USER` | **yes** | — | Must not be Nextcloud's DB user |
| `BETTEROFFICE_RELAY_DB_PASSWORD` | **yes** | — | |
| `BETTEROFFICE_RELAY_SHARED_SECRET` | **yes** (server only) | — | Verifies collaboration tokens the Nextcloud app issues (§8.5); copy the value shown on the app's admin settings page |
| `BETTEROFFICE_RELAY_ALLOWED_ORIGIN` | **yes** (server only) | — | Exact origin the Nextcloud app is served from; the relay rejects any other (§13) |

`npm run migrate` only needs the `DB_*` variables. `npm run dev`/`start` (the
WebSocket server, `relay/src/server.ts`) additionally require the shared
secret and allowed origin.

## Nextcloud app

No app-specific admin settings exist yet. This section gets real content
once the admin settings page PLAN.md §4.A and §11 call for lands
(collaboration relay URL, and the shared secret to copy into the relay's
`BETTEROFFICE_RELAY_SHARED_SECRET`).

## Hostnames

Never hardcode a relay hostname anywhere in `app/` — it is deployment
configuration (PLAN.md §14), read from the app's own (not-yet-built) admin
settings or app config, not a constant in source.
