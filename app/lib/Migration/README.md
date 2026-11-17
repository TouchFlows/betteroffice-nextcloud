# App migrations

Uses Nextcloud's own migration mechanism (PLAN.md §5.1), independent of the
relay's (`relay/migrations/`). No app-owned tables exist yet — the first
migration lands in Phase 2 alongside `betteroffice_sessions`,
`betteroffice_save_leases` and `betteroffice_conflicts` (§10).

## Convention

Each migration is a class `Version<Major><Minor><Patch>Date<YYYYMMDDHHMMSS>`
under this namespace, implementing `OCP\Migration\ISchemaMigration` (schema
changes, run automatically by `occ upgrade`) or `OCP\Migration\IRepairStep`
(data repairs). Nextcloud discovers and runs them in filename order; there
is no separate "down" — a schema mistake is fixed by a new forward
migration, matching how every other Nextcloud app handles it, and keeping
this consistent with the relay's own documented stance (`relay/migrations/README.md`)
against editing an already-applied migration.

Do not assume MariaDB-specific SQL here (§5.1) — use `OCP\DB\ISchemaWrapper`'s
builder, which Nextcloud also runs against PostgreSQL and SQLite.
