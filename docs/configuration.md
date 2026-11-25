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

Everything the app needs is on its own admin settings page:

**Settings → Administration → BetterOffice**

Both values below can also be set with `occ` (run as the web server user),
which is what provisioning scripts should use; the settings page is the
same storage, just with a form in front of it.

### `relay_url`

The collaboration relay's public base URL. `http(s)://` and `ws(s)://` are
both accepted; the editor converts `http(s)` to `ws(s)` before connecting.
Trailing slashes are dropped on save. Anything that is not an absolute URL
with one of those schemes is refused on the settings page rather than
stored, since it would break every editor's connection attempt.

When it is unset (the default), the editor opens documents **without**
collaboration — reading and saving keep working, and the editor says live
collaboration is unavailable. Clearing the field disables collaboration the
same way. It is never hardcoded in source (PLAN.md §14).

```bash
occ config:app:set betteroffice relay_url --value="wss://relay.example.com"
occ config:app:set betteroffice relay_url --value=""   # disable collaboration
```

### `collaboration_secret`

The secret shared with the relay, used to sign and verify collaboration
tokens (PLAN.md §8.5). It auto-generates on first use
(`SharedSecretService`) and is shown on the settings page, which is where
you copy it from into the relay's `BETTEROFFICE_RELAY_SHARED_SECRET`.

**Regenerate secret** on that page issues a new value. Every token already
issued stops verifying immediately, so open editors lose collaboration
until the relay is updated with the new secret and restarted — that is the
point of the button: it revokes a secret that has leaked.

```bash
occ config:app:get betteroffice collaboration_secret
```

## Hostnames

Never hardcode a relay hostname anywhere in `app/` — it is deployment
configuration (PLAN.md §14), read from the app's admin settings (app config),
not a constant in source.
