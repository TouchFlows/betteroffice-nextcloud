# Relay migrations

Plain numbered SQL files, applied in filename order by `npm run migrate`
(`src/migrate.ts`). No schema exists yet — the first migration lands in
Phase 3 alongside the real room/persistence implementation (PLAN.md §5.2,
§8.4, §10).

## Conventions

- Name files `NNNN_description.sql`, zero-padded, monotonically increasing
  (e.g. `0001_create_rooms.sql`). Never reorder or renumber an already-applied
  migration.
- **Never edit an applied migration.** The runner tracks each applied
  migration's checksum and refuses to continue if an already-applied file's
  content changed — add a new migration instead.
- Add a sibling `NNNN_description.down.sql` when the migration is safely
  revertible. `npm run migrate -- down` rolls back only the single most
  recently applied migration, and only if that file exists. A destructive
  migration (dropping a column, a table, data) should not ship a `.down.sql`
  that silently discards data — document the real recovery path in the
  migration's own comment instead, per the "documented recovery from an
  interrupted migration" requirement below.
- Every migration's up-file runs inside one transaction; a failure rolls it
  back automatically and leaves `schema_migrations` unchanged, so a failed
  migration is always safe to retry after fixing the cause.

## Required before a destructive migration (PLAN.md §5.3)

1. Take a database backup (`mariadb-dump` of the `betteroffice_relay`
   database — see `docs/backup-and-recovery.md` once Phase 3 adds a real
   schema).
2. State the rollback plan in the migration file's header comment: restoring
   from that backup, or a `.down.sql`, or — if neither is possible for this
   change — say so explicitly and why.
3. Note what an interruption mid-migration leaves behind and how an operator
   recovers (e.g. "this migration is idempotent; re-running `npm run
   migrate` after a crash is safe" or "if this is interrupted after step 2,
   restore from the pre-migration backup before retrying").
