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

Current state (Phase 2 + Phase 3 in progress): a DOCX-only "Open with
BetterOffice" file action (also the double-click default, via the Files
action's own `default` mechanism rather than a separate Viewer
registration), an editor page/route, and non-collaborative read/save:
`FileAccessService` resolves a file ID through the requesting user's own
folder (`getUserFolder($userId)->getById($fileId)`, so an inaccessible ID
just finds nothing — §6.3), `DocumentService` compares the caller's ETag
against the live one and writes via `File::putContent()` (which runs its
own full lock lifecycle internally -- no manual `lock()`/`unlock()` around
it, see that method's own docblock for why one breaks the other). A stale
ETag refuses the write rather than overwriting (§9.3) and surfaces as a
"the file was modified elsewhere" message — not yet the recoverable
conflict copy §9.5 calls for; that's Phase 5.

Phase 3 so far: `RoomService` (keyed-HMAC room ids, §8.1), `CollaborationController`
(`POST .../collab/session/{fileId}` resolves/creates the `betteroffice_sessions`
row and issues a token; `PUT .../collab/session/{fileId}/seed` is the
atomic seed create-if-absent, §8.2), and `SharedSecretService` (the
auto-generated secret shared with the relay, §8.5), `Settings\Admin` and
`SettingsController` (Settings → Administration → BetterOffice: relay URL
and secret, §4.A/§11), and the frontend's own collaboration wiring in
`EditorApp`. Still ahead: save coordination and conflict recovery (§9) in
Phase 5, and XLSX/PPTX collaboration in Phase 4 — both of those editors
already open and save single-user.

## `app/` frontend — the BetterOffice editors

Rendered inside the Nextcloud page, never in an iframe to an external
service (PLAN.md §4.B). `DocxEditor`/`XlsxEditor`/`PptxEditor` from
`@betteroffice/*-react`, wired to a host-implemented `CollaborationTransport`
over WebSocket. The exact wiring differs per format — see
`poc/RECONNAISSANCE.md` §3 for the confirmed, non-obvious differences (which
prop/callback actually hands you the live collaboration replica, and which
`CollaborationProvider` constructor accepts it directly vs. needs wrapping).
All three editors are wired: the server resolves the file's format from its
mime type, the template hands it to the bundle, and `src/editor/main.tsx`
mounts `DocxEditor`/`XlsxEditor`/`PptxEditor` accordingly. Only DOCX passes a
`collaboration` prop so far; the other two read and write through the same
`DocumentController` endpoints (load, then `onSave` back with the loaded
ETag), which is what makes them usable before their collaboration is wired.

## `relay/` — the collaboration relay

Responsibilities (PLAN.md §4.C): room creation/authorisation, WebSocket
connections, binary update forwarding, durable persistence, checkpointing,
save coordination, presence. Must never need direct access to Nextcloud's
document storage.

Current state (Phase 3, relay engine; app-side wiring not yet landed): the
real protocol proven standalone in `poc/relay/` (documented in
`poc/RECONNAISSANCE.md` §4) — Yjs sync-v1 frames relayed between
`CollaborationProvider` instances, independent of Cloudflare Durable
Objects — now runs here for real: `Room` (`src/room.ts`) persists every
accepted update to MariaDB *before* broadcasting it (`src/store.ts`,
`migrations/0001_create_rooms.sql`), and the WebSocket endpoint
(`src/wsServer.ts`) enforces a strict Origin allow-list and verifies a
short-lived HMAC-signed collaboration token (`src/token.ts`) before letting a
connection join a room, rejecting edit frames from a read-only token. Room
identity, seeding and token issuance remain the Nextcloud app's job (next),
not the relay's.

## Room initialisation and seeding (PLAN.md §8.2)

The first client to open a document generates its Yrs/CRDT seed once; every
other client must adopt that exact seed rather than generating its own —
confirmed as a hard requirement, not a style preference: two independently
generated seeds from identical source bytes under different client IDs
produce byte-different, non-converging state (reproduced in
`poc/RECONNAISSANCE.md` §3). The Nextcloud app backend owns this (not the
relay — the Phase 0 PoC's relay-hosted seed registry,
`poc/relay/seedRegistry.ts`, was a stand-in for the production design, not
the design itself): `POST .../collab/session/{fileId}` resolves (creating
if absent) a `betteroffice_sessions` row and returns its seed if one is
already set; `PUT .../collab/session/{fileId}/seed` is the atomic
create-if-absent write (`SessionMapper::trySetSeed()`, an `UPDATE ... WHERE
seed IS NULL`, checking affected rows) -- *every* client that finds no seed
yet generates its own candidate and PUTs it, adopting whatever the response
returns, win or lose. No client is designated "the owner" in production;
that was only a PoC test-harness convenience.

## Why no Vue, no iframe, no WOPI

PLAN.md §1 rules these out explicitly. React is used consistently across
`app/src`; the editors mount directly into the Nextcloud page's DOM.

## Database boundary

The app's own tables use Nextcloud's database abstraction (works across
MySQL/MariaDB, PostgreSQL, SQLite — §5.1). The relay's tables are MariaDB
only, in their own database with their own restricted user, with no
credentials for Nextcloud's database (§5.2). Never mix the two.
