# Architecture

Three independently deployable components (PLAN.md §4):

```
Nextcloud server
    |
    | HTTPS
    |
    +---- apps/betteroffice/   (app/)      PHP backend + React/TS editor frontend
    |
    +---- Native Nextcloud storage          files, permissions, locking, version history

office-relay.example.net        (relay/)
    |
    | HTTPS / WSS
    |
    Collaboration relay  --  MariaDB (betteroffice_relay, its own DB/user)
```

## `app/` — the Nextcloud application

Responsibilities (PLAN.md §4.A): authentication, file permissions, file
retrieval/saving, locking, version history, file actions, editor routing,
collaboration token issuance, session management, conflict recovery, admin
settings.

Current state (Phase 2): a DOCX-only "Open with BetterOffice" file action
(also the double-click default, via the Files action's own `default`
mechanism rather than a separate Viewer registration), an editor page/route,
and non-collaborative read/save: `FileAccessService` resolves a file ID
through the requesting user's own folder (`getUserFolder($userId)
->getById($fileId)`, so an inaccessible ID just finds nothing — §6.3),
`DocumentService` locks (`Node::lock()`), compares the caller's ETag against
the live one, writes, unlocks. A stale ETag refuses the write rather than
overwriting (§9.3) and surfaces as a "the file was modified elsewhere"
message — not yet the recoverable conflict copy §9.5 calls for; that's
Phase 5. XLSX/PPTX file actions and editors, and all of collaboration, are
Phase 3/4.

## `app/` frontend — the BetterOffice editors

Rendered inside the Nextcloud page, never in an iframe to an external
service (PLAN.md §4.B). `DocxEditor`/`XlsxEditor`/`PptxEditor` from
`@betteroffice/*-react`, wired to a host-implemented `CollaborationTransport`
over WebSocket. The exact wiring differs per format — see
`poc/RECONNAISSANCE.md` §3 for the confirmed, non-obvious differences (which
prop/callback actually hands you the live collaboration replica, and which
`CollaborationProvider` constructor accepts it directly vs. needs wrapping).
Phase 2 only wires `DocxEditor`, without `collaboration` at all — it reads
and writes `documentBuffer`/`onSave` directly against `DocumentController`.

## `relay/` — the collaboration relay

Responsibilities (PLAN.md §4.C): room creation/authorisation, WebSocket
connections, binary update forwarding, durable persistence, checkpointing,
save coordination, presence. Must never need direct access to Nextcloud's
document storage.

Current state: a health endpoint and a migration runner (Phase 1 skeleton).
The real protocol — Yjs sync-v1 frames relayed between `CollaborationProvider`
instances, independent of Cloudflare Durable Objects — is proven standalone
in `poc/relay/` and documented in `poc/RECONNAISSANCE.md` §4; it moves here
with MariaDB persistence, origin validation and token auth in Phase 3.

## Room initialisation and seeding (PLAN.md §8.2)

The first client to open a document generates its Yrs/CRDT seed once; every
other client must adopt that exact seed rather than generating its own —
confirmed as a hard requirement, not a style preference: two independently
generated seeds from identical source bytes under different client IDs
produce byte-different, non-converging state (reproduced in
`poc/RECONNAISSANCE.md` §3). In Phase 2+ the Nextcloud app backend owns this
(a `betteroffice_sessions` row, create-if-absent), not the relay — the
Phase 0 PoC's relay-hosted seed registry (`poc/relay/seedRegistry.ts`) was a
stand-in for that backend, not the intended production design.

## Why no Vue, no iframe, no WOPI

PLAN.md §1 rules these out explicitly. React is used consistently across
`app/src`; the editors mount directly into the Nextcloud page's DOM.

## Database boundary

The app's own tables use Nextcloud's database abstraction (works across
MySQL/MariaDB, PostgreSQL, SQLite — §5.1). The relay's tables are MariaDB
only, in their own database with their own restricted user, with no
credentials for Nextcloud's database (§5.2). Never mix the two.
