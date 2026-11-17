# Backup and recovery

No production deployment exists yet, so nothing here has been tested against
real data. This records the requirements (PLAN.md §5.3, §9.5, §9.6) so they
aren't rediscovered later.

## Relay database

- Take a `mariadb-dump` of `betteroffice_relay` before any destructive
  migration — see `relay/migrations/README.md`, which the migration runner's
  own checksum guard backs up with an explicit written step.
- A relay restart must not lose accepted collaboration updates. This is
  proven for the Phase 0 file-backed proof of concept
  (`poc/tests/docx.relay-restart.spec.ts`, described in
  `poc/RECONNAISSANCE.md` §4) but **not yet** for the real MariaDB-backed
  relay, which doesn't exist yet (Phase 3).
- A checkpoint is not a replacement for the original Office file or
  Nextcloud's own version history (§8.4) — never treat relay data as the
  durable copy of a document.

## Nextcloud app data

The app writes nothing to Nextcloud's storage yet beyond what Nextcloud
itself already backs up as part of a normal Nextcloud backup. Once Phase 2
adds `betteroffice_sessions` etc., back those up as part of the normal
Nextcloud database backup — they use Nextcloud's own DB abstraction and
live in the same database.

## External modification / conflict recovery

Unbuilt (Phase 5). When a document is saved externally while a collaboration
room is open, the plan requires: refuse the write, mark the room externally
modified, notify participants, preserve collaborative state, generate a
recoverable conflict copy via Nextcloud's native file APIs, and require an
explicit user decision before replacing the original (§9.5). Do not silently
merge.

## Rollback

Deployment rollback (reverting a release) is out of scope for this
repository's own tooling — see the separate TouchFlows deploy tooling once
this app is actually deployed anywhere. Database migration rollback is
`npm run migrate -- down` for the relay (one step, only where a `.down.sql`
exists) and a new forward migration for the app (Nextcloud convention has no
"down" — see `app/lib/Migration/README.md`).
