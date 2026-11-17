# BetterOffice relay

Self-hosted WebSocket relay for real-time collaboration (PLAN.md §4.C, §8).
**This is currently a skeleton**: a health endpoint and a migration runner,
nothing more. Room lifecycle, the collaboration protocol, authentication and
durable persistence are Phase 3 work.

See [`poc/relay/`](../poc/relay/) for the Phase 0 proof of concept that this
will be built from — a working Yjs-sync-protocol relay with file-backed
persistence, validated end-to-end against the real BetterOffice editors in
[`poc/RECONNAISSANCE.md`](../poc/RECONNAISSANCE.md). That code is deliberately
not ported in wholesale: it needs MariaDB persistence (§5.2), origin
validation and signed-token auth (§8.5, §13) before it's this service.

## Development

```bash
npm install
cp .env.example .env   # fill in a local MariaDB connection
npm run dev             # watches src/, serves :8787
npm run typecheck
npm test
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
