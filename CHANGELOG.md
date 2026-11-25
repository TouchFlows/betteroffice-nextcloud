# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) once a first release is tagged.
The Nextcloud app and the relay are versioned independently once they
diverge (PLAN.md §2.1) — entries below are tagged `[app]` / `[relay]` /
`[repo]` accordingly.

## [Unreleased]

### Added

- `[repo]` Public repository, Apache-2.0 licence, contribution and security
  policy, CI skeleton.
- `[repo]` Phase 0 standalone proof of concept validating the BetterOffice
  collaboration and save/export lifecycle against a self-hosted relay (see
  `poc/RECONNAISSANCE.md`).
- `[app]` Nextcloud application skeleton: app registration, minimal page,
  build tooling.
- `[relay]` Relay service skeleton: health endpoint, migration runner,
  systemd unit template.
- `[app]` DOCX file action ("Open with BetterOffice", also the double-click
  default) registered into the Files app via
  `OCP\Collaboration\Resources\LoadAdditionalScriptsEvent`.
- `[app]` Non-collaborative DOCX open/edit/save: `FileAccessService` and
  `DocumentService` (permission-scoped file resolution,
  ETag-conflict-checked saves), `EditorController`/`DocumentController`,
  and a React editor page wired to `@betteroffice/docx-react`.
- `[relay]` Real collaboration room engine (PLAN.md §8): `Room` relays the
  Yjs sync/awareness protocol between peers, persisting every accepted
  update to MariaDB *before* broadcasting it (never after — an unpersisted
  update is never acknowledged as accepted, §8.4/§9.6), with periodic
  checkpoint compaction. The WebSocket endpoint enforces a strict Origin
  allow-list and verifies a short-lived, HMAC-signed collaboration token
  (§8.5, hand-rolled JWT-shaped HS256, no new dependency) before admitting a
  connection, and rejects editing frames from a read-only token (§13).
  Room identity and seeding remain the Nextcloud app's responsibility, not
  the relay's, per `poc/app/roomSeed.ts`'s own note — that lands next.
- `[app]` Room identity, atomic session initialisation and collaboration
  token issuance (PLAN.md §8.1, §8.2, §8.5): `betteroffice_sessions`
  (create-if-absent, racing concurrent first-openers adopt whichever row
  won rather than seeding a second divergent room), `RoomService` (keyed
  HMAC room ids, scoped to this Nextcloud instance; short-lived HS256
  collaboration tokens, matching `relay/src/token.ts`'s verifier), and
  `CollaborationController`'s `POST /collab/session/{fileId}`. The shared
  signing secret auto-generates on first use (`SharedSecretService`,
  `IAppConfig`, same pattern Nextcloud Talk uses for its signaling
  backend) — admin settings to display/regenerate it land with the
  frontend wiring next.
- `[app]` Real-time collaboration in the DOCX editor (PLAN.md §8.2, §8.3,
  §8.5, §8.6): `EditorController` exposes a `relay_url` app config key as
  `data-relay-url` (`occ config:app:set betteroffice relay_url
  --value=...` until the settings page lands); `EditorApp` resolves the
  room and token, generates a seed and offers it through the
  create-if-absent endpoint only when the room has none, adopts the
  authoritative bytes it gets back, and connects a real
  `CollaborationProvider` over a ported `WsCollaborationTransport`. A
  minimal presence line reports connection state and peer count; a relay
  that is unset or unreachable falls back to the previous
  non-collaborative editor rather than blocking the document.
- `[app]` Two-browser convergence proof: a Playwright spec drives two
  independent sessions against the real relay and a real MariaDB, asserts
  each sees the other's live edit, saves through `EditorApp`'s own save
  path, and unzips the saved DOCX to confirm both peers' edits are in
  `word/document.xml`. `app-ci.yml`'s frontend job runs it with a MariaDB
  service container and the relay's schema migrated.
- `[app]` Read-only collaboration, proven end to end: a Playwright test joins
  the real relay with a read-only token, receives the writer's document over
  the socket, then edits and asserts the relay closes it (code 1008) so
  nothing it writes reaches the room. `mockCollaborationApi.ts` can issue a
  read-only session to one browser context.
- `[app]` Admin settings page (PLAN.md §4.A, §11), in its own
  Settings → Administration → BetterOffice section: set the collaboration
  relay URL and copy or regenerate the collaboration secret the relay
  verifies tokens with. The URL is validated before it is stored (absolute
  `http(s)://` / `ws(s)://` with a host, trailing slashes dropped; empty
  disables collaboration), and both writes go through admin-only,
  CSRF-enforced `SettingsController` endpoints. `occ config:app:set
  betteroffice relay_url` keeps working for provisioning scripts. App
  version 0.2.0, since Nextcloud registers settings classes on upgrade.

- `[app]` `[relay]` Presence (PLAN.md §8.6), completing Phase 3: the editor
  lists who else is in the room with their display name, avatar and
  read-only/editing role. The identity is signed into each collaboration
  token by `RoomService` (display name from the authenticated Nextcloud
  user, avatar from core's public avatar route) and reported by the relay's
  new `GET /room/:roomId/presence` endpoint, which is authorised by the same
  short-lived token as the socket — so a caller can only see a room it
  already has access to, the answer is readable only from the configured
  Origin, and Nextcloud user ids are never included. Nothing a browser says
  about itself is used: the awareness channel still carries cursors, but the
  roster comes from the verified token.

- `[app]` `npm run test:live` (`app/tests/live/presence-avatar.mjs`): a
  repeatable two-user presence check against a real Nextcloud. It logs both
  accounts in through Nextcloud's own login form, opens the same shared
  document in each, and asserts the other participant's avatar actually
  paints from Nextcloud's avatar route with the role Nextcloud's share
  permissions gave them — including the "read-only" badge for a document
  shared read-only. Failures name the account, the file, the collaboration
  status, any CSP violation and whether the relay answers `/health`, so a
  broken setup says which part is broken.

- `[app]` The troubleshooting guide now covers the "editor loads but silently
  edits alone" symptom, next to the existing WebAssembly entry: the
  status-bar text the operator sees, the two Content Security Policy blocks to
  look for in the browser console (WASM compilation, and the relay origin in
  `connect-src`), and what to check. The refusal happens in the browser and
  neither the Nextcloud log nor the relay log mentions it, so this was the one
  failure mode with nowhere to look.

- `[app]` CI now guards the e2e harness itself rather than only the code it
  drives: `npm run typecheck:e2e` type-checks `tests/e2e` (it has its own
  tsconfig, and the root one only includes `src/`, so the specs and their
  mocks were the only TypeScript in the repository CI never checked), and the
  e2e step runs the suite with `--repeat-each=2`. A shared room or shared
  mock state only fails on the second pass, so a single run would have let
  the per-test isolation above regress unnoticed.

### Fixed

- `[app]` The presence-token-refresh e2e test slept a fixed 12 seconds and then
  gave the roster 10 more, so one number had to cover both the token lifetime
  and however long the refresh loop then took — and it still timed out on a
  busy machine. It now waits only past the token's lifetime and polls the
  observable consequence instead (a second session resolved), which is the
  thing it actually asserts; the test runs about six seconds faster and no
  longer depends on how loaded the machine is.
- `[relay]` A read-only participant's rejected edit could still reach the
  room by reconnecting. The relay only refused *Update* frames, but the room
  asks every new peer for its state (`SyncStep1`), so the peer's answer
  (`SyncStep2`) carried its local — rejected — edit into the room. Those
  answers are now dropped rather than applied, and deliberately not closed:
  every peer sends one when it joins, so closing would disconnect read-only
  participants before they could receive the document.
- `[app]` The collaboration e2e mock gave every test execution the same
  room, so `--repeat-each` and parallel runs shared one seed and one edit
  history and failed on the previous run's text. Each execution now asks for
  its own room (a `betteroffice-e2e-room` cookie, which the harness sets per
  test), and the mock's seeds and token lifetimes are keyed by it — a cookie
  rather than a header because a custom header makes the cross-origin
  presence request non-simple and the relay refuses the preflight.
- `[app]` The document e2e mock kept one saved document and ETag per
  dev-server process, so a repeated or parallel run started from the previous
  run's text and checked its save against the previous run's ETag. Its bytes,
  ETag and forced conflict are now keyed by the same per-test room the
  collaboration mock uses (a shared `fixtures.ts` sets the room for every
  test, including ones that never name it), and the `force-conflict` control
  endpoint requires one (`?room=`) like `token-ttl`. `--repeat-each=2` across
  the whole suite now passes.
- `[app]` The editor page now ships a Content-Security-Policy that lets it
  work inside a real Nextcloud at all: `'wasm-unsafe-eval'` for the
  WebAssembly engine and the configured relay's origin in `connect-src`.
  The default policy refused both, so on a live instance the editor loaded
  and then silently fell back to "editing on your own" — no collaboration,
  no presence, and nothing in the server logs to say why.
- `[app]` The read-only collaboration e2e test failed intermittently with
  "Worker read was superseded": the editor's worker rejects a paragraph read
  that a later read supersedes, and an update arriving from the relay can
  start one mid-assertion. That is a race in the editor, not what the test
  asserts, so the test's read helper now retries that specific race; any
  other error still fails the run.
- `[app]` Presence kept retrying a collaboration token the relay had already
  refused. The roster reuses the token the session handshake resolved for
  four minutes, so once that token expired (five-minute lifetime) every read
  answered 401 and the editor listed no collaborators for the rest of the
  window. A 401/403 now drops the cached token and resolves a new session
  straight away.
- `[relay]` Presence refusals (401/403) now carry the CORS header for the
  configured Origin, so the editor can read the status. Without it the browser
  turned the refusal into an opaque CORS error, which is what made the fix
  above impossible to detect on the client.
- `[relay]` The migration runner's rollback never actually worked:
  `discoverMigrations()` checked whether a `.down.sql` file existed by
  looking it up in a list that had already filtered every `.down.sql` file
  out of — so `downPath` was always `null`. Never caught before because no
  migration had ever shipped a `.down.sql` file to exercise it.
- `[relay]` The migration runner only ran a migration file's *first*
  SQL statement and silently ignored the rest, because its connection pool
  never enabled the driver's multi-statement capability.
- `[relay]` `npm test` never actually ran any tests in CI: its `tests/**/*.test.ts`
  glob depends on bash's `globstar` option, which an interactive local shell
  often has on but GitHub Actions' non-interactive `bash -e` does not —
  there it's passed through unexpanded and Node's test runner reports the
  literal pattern as a missing file. Switched to Node's own built-in test
  discovery (`node --test` with no path argument) instead of relying on the
  shell to glob it.
- `[app]` A dropped collaboration connection never came back, and could not
  have: the provider only reports the status change (its bundled source has
  no retry), and the transport resolved its relay URL once — so a reconnect
  after the five-minute token expired was rejected by the relay forever and
  the editor sat on "Reconnecting…". The transport now resolves a fresh
  session URL and token per connection attempt, and `EditorApp` drives
  reconnection with a capped backoff.
- `[app]` Opening a document requested a collaboration session twice — once
  for the seed, then again for the transport's first connection. The first
  connection now reuses the token the seed handshake already resolved; only
  a reconnect asks for a fresh one.
- `[relay]` A read-only token could not connect at all: the frame gate
  rejected every sync-protocol frame, including the SyncStep1 handshake a
  `CollaborationProvider` sends the moment it opens, so a viewer was closed
  out before it could receive the document it was meant to read. Only
  Update frames (sync subtype 2) carry an edit and are rejected now; the
  handshake and awareness traffic go through.

- `[app]` The Files file action never loaded in a real Nextcloud: the
  listener was registered against `OCA\Files\Event\LoadAdditionalScriptsEvent`,
  which this version of Nextcloud never dispatches.
- `[app]` `Util::addScript()` calls passed the un-prefixed entry name
  (`main`/`files`/`editor`); `@nextcloud/vite-config` builds
  app-id-prefixed chunks (`betteroffice-main.mjs` etc.), so every script
  404'd.
- `[app]` `EditorController`/`PageController` required a CSRF token on a
  route only ever reached by a plain navigation (`window.location.href`),
  which carries none.
- `[app]` `DocumentService::save()` took its own exclusive lock around
  `File::putContent()`, which already runs its own full lock lifecycle
  internally — the outer lock collided with it and made every save throw
  `LockedException`.
- `[app]` The DOCX engine's Web Worker threw `window is not defined` the
  first time it loaded its wasm module (on first save), because
  `@nextcloud/vite-config` rewrites the wasm asset URL into a
  `window.OC.filePath(...)` call that only works on the main thread.
