# Security

Status: most of PLAN.md §13 is unbuilt. This document tracks what's
required, what exists, and what doesn't yet — it is not a claim that the
relay or app are currently safe to expose. See [SECURITY.md](../SECURITY.md)
at the repo root for how to report a vulnerability.

## Required, not yet implemented

- HTTPS/WSS termination in front of both services (deployment concern, not
  app/relay code — see `docs/installation.md` once it covers this).
- Strict Origin validation on the relay's WebSocket upgrade. The Phase 0 PoC
  relay (`poc/relay/`) uses a wildcard CORS header for local dev only; this
  must never reach a real deployment.
- Signed, short-lived collaboration tokens (§8.5): Nextcloud authenticates
  the user, the app backend checks file permissions and issues a token, the
  relay verifies it and authorises only the room it names. None of this
  exists yet — the Phase 0 relay trusts any client that can reach it.
- Read-only enforcement at the relay, not just the editor UI (§8.5: "The
  relay must enforce permissions server-side").
- Rate limits, max message size (16 MiB, confirmed against the reference
  relay's own constant — `poc/RECONNAISSANCE.md` §4), max connections per
  user, max participants per room.
- Protection against replayed expired tokens and room-ID enumeration.
- Audit logging for saves and conflicts, via `spatie`-style causer tracking
  on the app side (see the global PHP/Laravel house rules this monorepo
  otherwise doesn't use, since this is a Nextcloud app, not Laravel — audit
  entries here are plain Nextcloud activity/log entries with an explicit
  actor, not an omitted one).
- Dependency vulnerability monitoring (Dependabot is configured — see
  `.github/dependabot.yml` — but review its findings, don't assume a green
  Dependabot means nothing to fix).

## Known accepted gaps (Phase 0 finding, tracked here so they aren't lost)

- `@nextcloud/vite-config`'s own transitive dev-dependency tree currently
  carries several `npm audit` findings (elliptic, picomatch, minimatch — all
  in build-only tooling like `vite-plugin-dts`/`vite-plugin-node-polyfills`,
  never shipped to users). The available fix is a downgrade to an older
  `@nextcloud/vite-config`, which is not obviously safer. Re-check on every
  dependency bump; do not silently suppress the audit in CI.
- `@nextcloud/files`' `webdav` dependency pulled in a vulnerable `minimatch`
  (GHSA-g3hv-75wg-m249, ReDoS) as a *production* dependency, not a dev-tooling
  one — that one is pinned to a fixed version via `app/package.json`'s
  `overrides`, not left open. Re-check this override is still needed (and
  still the right version) whenever `@nextcloud/files` is bumped.

## File access boundary

The app must never grant file access beyond what Nextcloud's own
permission/share model already allows (PLAN.md §6.3). Implemented as of
Phase 2: `FileAccessService` resolves a file ID only through the requesting
user's own folder (`getUserFolder($userId)->getById($fileId)`), so changing
the file ID in a request to one the user has no share/ownership access to
simply finds nothing — it was never a path to someone else's file in the
first place, not an access check bolted on afterward. `DocumentController`
rechecks `isReadable()`/`isUpdateable()` on every single request (nothing is
cached across requests), satisfying "recheck permissions before every save"
and "permission revocation must invalidate further writes" by construction.
Save additionally requires a matching ETag (`If-Match` header) — a stale one
refuses the write (§9.3) rather than overwriting, though the recoverable
conflict copy §9.5 describes isn't built yet (Phase 5); today a conflict
just refuses and tells the user, with no automatic recovery path.

Still open: XLSX/PPTX aren't in `FileAccessService::SUPPORTED_MIME_TYPES`
yet (Phase 4), and there is no authentication/authorisation boundary between
the app and the relay yet (that's the whole "Required, not yet implemented"
list above) — Phase 2's save path is single-editor only, with no
collaboration or relay involved at all.

## The relay's trust boundary

The relay is an exposed public service by design (§13) and must never need
direct access to Nextcloud's document storage or database (§5.2, §4.C). It
receives only document-session metadata and the CRDT update stream — never
file paths, user credentials, or Nextcloud's own database connection.
