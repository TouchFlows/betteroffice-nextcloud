# BetterOffice relay

Self-hosted WebSocket relay for real-time collaboration (PLAN.md §4.C, §8).
Relays the Yjs sync/awareness protocol between `CollaborationProvider`
peers, persisting every accepted update to MariaDB before broadcasting it,
behind a strict Origin allow-list and short-lived HMAC-signed collaboration
tokens (§8.5, §13). Room identity and seeding are the Nextcloud app's job,
not this service's — see `poc/app/roomSeed.ts`'s own note on why.

Built from [`poc/relay/`](../poc/relay/), the Phase 0 proof of concept
validated end-to-end against the real BetterOffice editors in
[`poc/RECONNAISSANCE.md`](../poc/RECONNAISSANCE.md) — not ported in
wholesale: that PoC used file-backed persistence and trusted any client
that could reach it, neither of which is acceptable here.

## Development

```bash
npm install
cp .env.example .env   # fill in a local MariaDB connection, shared secret, allowed origin
npm run migrate         # apply the schema before first run
npm run dev             # watches src/, serves :8787
npm run typecheck
npm test                # needs the same BETTEROFFICE_RELAY_DB_* variables as `migrate`
```

## Database

The relay owns a dedicated MariaDB database and user with no access to
Nextcloud's own database (§5.2):

```sql
CREATE DATABASE betteroffice_relay CHARACTER SET utf8mb4;
CREATE USER 'betteroffice_relay'@'localhost' IDENTIFIED BY '...';
GRANT ALL PRIVILEGES ON betteroffice_relay.* TO 'betteroffice_relay'@'localhost';
```

Migrations live in [`migrations/`](migrations/) — see that directory's
README for the versioning, rollback and recovery conventions. Apply them
with `npm run migrate` (forward) or `npm run migrate -- down` (revert the
most recent one, if it has a matching `.down.sql`).

## Production

```bash
npm run build   # compiles src/ to dist/
npm start        # node dist/server.js
```

[`deploy/betteroffice-relay.service`](deploy/betteroffice-relay.service) is a
systemd unit template: dedicated unprivileged account, restart-on-failure,
resource limits, journald logging (§14.2). Copy it to
`/etc/systemd/system/`, adjust `WorkingDirectory`/paths for the real
deployment target, and never point `EnvironmentFile` at a file the service
account can't exclusively read (`chmod 600`).
