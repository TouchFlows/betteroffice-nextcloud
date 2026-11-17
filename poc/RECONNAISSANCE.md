# Phase 0 reconnaissance report

Scope: PLAN.md §3 and §17 Phase 0 — prove the standalone collaboration and
save lifecycle before any production code is written. Everything below was
verified against the pinned package versions actually installed in this
`poc/`, not against documentation or memory.

## 1. Exact package versions (pinned)

| Package | Version | License | Upstream |
| --- | --- | --- | --- |
| `@betteroffice/docx` | 0.5.1 | Apache-2.0 | `openooxml/betteroffice` (packages/docx) |
| `@betteroffice/docx-react` | 0.5.1 | Apache-2.0 | same |
| `@betteroffice/xlsx` | 0.5.1 | Apache-2.0 | same |
| `@betteroffice/xlsx-react` | 0.5.1 | Apache-2.0 | same |
| `@betteroffice/pptx` | 0.5.1 | Apache-2.0 | same |
| `@betteroffice/pptx-react` | 0.5.1 | Apache-2.0 | same |
| `@betteroffice/fonts` | 0.4.2 | Apache-2.0 | same |
| `@betteroffice/fonts-cjk` | 0.4.2 | Apache-2.0 | same |
| `@betteroffice/fonts-intl` | 0.0.0 | — | **placeholder only, not implemented** |
| `@betteroffice/fonts-latin` | 0.0.0 | — | **placeholder only, not implemented** |

All six core/react packages share one version (0.5.1), confirming the plan's
instruction to install matching versions across formats. The two "placeholder"
font packages the plan names (§7.5) do not exist yet upstream — font strategy
must use `@betteroffice/fonts` (+ `@betteroffice/fonts-cjk` for CJK coverage)
only.

Relay dependencies, all permissive-licensed: `yjs` 13.6.33 (MIT), `y-protocols`
1.0.7 (MIT), `lib0` 0.2.120 (MIT), `ws` 8.23.0 (MIT) — none are BetterOffice
packages, so this is not a fork of upstream, per PLAN.md §2.1/§8.3.

## 2. Runtime requirements

- React/ReactDOM `^18.0.0 || ^19.0.0` (peer dep, both optional per
  `peerDependenciesMeta` — only used when the `-react` package is imported).
- Vite 7.3.8 + `@vitejs/plugin-react` 5.2.0 work, but **only** with the dev
  server's dependency pre-bundler ("optimizeDeps") excluding every
  `@betteroffice/*` package. See §6 "bundler gotcha" below — this will apply to
  the production Nextcloud app's own Vite build too.
- All WASM loading and collaboration/seed APIs ran correctly in a real browser
  (Chromium via Playwright); `@betteroffice/docx`'s `/yrs` subpath also loads
  and runs headlessly in plain Node (no bundler) — useful for a future
  server-side save/export worker (§9.1). `@betteroffice/xlsx` and
  `@betteroffice/pptx`'s `initWasm()` need explicit wasm bytes to run
  headlessly in Node (their default fetch-based loader assumes a browser);
  trivial to work around by reading the bundled `.wasm` file from
  `node_modules/.../dist/generated/*.wasm`.

## 3. Confirmed public interfaces

### Editor components (`poc/app/{Docx,Xlsx,Pptx}Harness.tsx`)

All three async (non-`legacySyncApi`) editors converge on the same shape:
`file`/`documentBuffer` (raw bytes), `collaboration` (clientId/initialUpdate),
`onSave`, `readOnly`, and an imperative handle with `readParagraphs`/
`readCells`/`readContent`, `applyEdits`, and `save()`. But the exact wiring to
get a live `CollaborationReplica` differs per format — this is the concrete
instance of PLAN.md §8.2's "do not assume the same implementation works for
all formats":

| Format | How the host gets the replica | `CollaborationProvider` ctor accepts |
| --- | --- | --- |
| DOCX | `collaboration.onReplica` callback fires directly, even on the async editor | `CollaborationReplica` only |
| XLSX | **not** via `collaboration.onReplica` (unused on the async editor) — read `api.collaboration` from `onReady(api)` instead | `CollaborationReplica` only — wrap the async replica with `createAsyncCollaborationReplica()` first |
| PPTX | `collaboration.onReplica` callback, typed `AsyncCollaborationReplica` | **Overloaded**: accepts `AsyncCollaborationReplica` directly, no wrapping, no `createAsyncCollaborationReplica` export even exists in `@betteroffice/pptx/collaboration` |

Peer/presence listening also differs: DOCX's provider has `onPeers(listener)`;
XLSX's has no subscribe method, only a `peers` getter (poll it from
`onStatus`); PPTX's is `onPresence(listener)`.

### `CollaborationTransport` (host-implemented)

Confirmed exactly as PLAN.md §8.3 describes, in
`@betteroffice/docx/collaboration` (and structurally identical in the xlsx/
pptx packages):

```ts
interface CollaborationTransport {
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  send(data: Uint8Array): boolean;       // false = backpressure; must emit 'drain' later
  onEvent(listener: (event: CollaborationTransportEvent) => void): () => void;
}
type CollaborationTransportEvent =
  | { type: 'open' } | { type: 'message'; data: Uint8Array }
  | { type: 'close'; reason?: string } | { type: 'error'; error: unknown }
  | { type: 'drain' };
```

Implemented in `poc/shared/transport.ts` (`WsCollaborationTransport`) over a
plain browser `WebSocket`, with a `bufferedAmount` threshold driving the
`send()`-returns-false / `drain` backpressure contract.

### Seed generation (§8.2) — confirmed to differ per format

| Format | API | Notes |
| --- | --- | --- |
| DOCX | `createYrsSession({ clientId }).seedFromDocx(bytes, { generation }); session.encodeState()` | from `@betteroffice/docx/yrs` |
| XLSX | `openWorkbook(bytes, { collaborative: true, clientId }).encodeStateAsUpdate()` | from `@betteroffice/xlsx` |
| PPTX | `openPresentation(bytes, { clientId }).encodeStateAsUpdate()` | from `@betteroffice/pptx` |

**Critical finding, directly validating PLAN.md §8.2's warning:** seeding the
*same* source bytes independently under *different* `clientId`s produces
byte-different (and state-vector-different) results for DOCX — confirmed with
a two-line repro (`clientId:1` vs `clientId:2`, identical bytes, identical
`generation` tag → different `encodeState()` output). Seeding twice under the
*same* `clientId` is deterministic (byte-identical). This means:

- Two clients must never each independently generate "the" seed for a room.
- The correct flow is: one client generates it once; everyone else *loads that
  exact byte string* (`loadState`/`initialUpdate`), never regenerates it.

This is exactly PLAN.md §8.2 steps 4–7, and this PoC implements it for real
(not simulated): the relay's `PUT /room/:id/seed` is a
create-if-absent endpoint (`O_EXCL` file write) a seed-owning client PUTs its
generated seed to, and every other client just GETs the one seed on record
(`poc/app/roomSeed.ts`, `poc/relay/seedRegistry.ts`). In Phase 2 this endpoint
belongs on the Nextcloud app backend, backed by `betteroffice_sessions`
(§10), not on the relay — the relay has no business deciding room identity.

### Save/export lifecycle (§9.1) — the hard question is answered

PLAN.md §9.1 asks whether the official APIs can reliably export a canonical
document that reflects every accepted collaborative update before committing
to any save-leader architecture. **Confirmed yes, for all three formats**,
and proven end-to-end, not just read from a type signature:

- `DocxEditorRef.save(): Promise<ArrayBuffer | null>` — internally flushes
  pending input first (per its own doc comment chain: `flushPendingInput` →
  `applyEdits`/`save`).
- `XlsxAsyncEditorApi.save(): Promise<Uint8Array>` — "Commits pending input,
  returns bytes". **Gotcha**: the lower-level `handle.save()` throws
  `XlsxSaveRefusedError` with code `input-pending` if an open cell entry or a
  paste is still mid-flight; the docs explicitly say to prefer
  `commands.execute('save', null)` (or the async API's `save()`, which already
  does the right thing) instead of calling the raw handle method.
- `PptxAsyncEditorApi.save(): Promise<Uint8Array>` — "Flushes pending input,
  then serializes... Does not call onSave or download."

The `docx.collab.spec.ts` test in this PoC proves it concretely: two separate
browser contexts (two `CollaborationProvider` instances, two WASM engine
instances) each insert text, the edits converge over the relay, and calling
`save()` on *either* peer's editor instance produces a `.docx` whose
`word/document.xml` contains **both** peers' edits — verified by unzipping the
exported bytes and grepping the XML, independent of any live editor state.

This derisks the save-leader design in §9.2–9.3: the export step itself is
trustworthy; what still needs building in later phases is the leader
election/fencing-token coordination so only one leader's export actually gets
written to the Nextcloud file at a time (the APIs don't do that part — nothing
in their surface elects or fences a leader, that's host-owned by design).

## 4. Self-hosted relay (§8.3–§8.4) — architecture and why it was built this way

The official reference relay (`apps/relay` in `openooxml/betteroffice`) runs
on Cloudflare Durable Objects, hand-rolls the Yjs sync-protocol varint framing
(`apps/relay/src/retention.ts`) because Workers can't reach into Node's crypto/
fs, and persists through `DurableObjectStorage`. None of that is portable to a
plain Node/systemd deployment, and PLAN.md §4.C explicitly forbids deploying
that Cloudflare implementation — so `poc/relay/` is **not** a port of that
code. It is a from-scratch relay built on the same standard, MIT-licensed Yjs
ecosystem libraries the reference implementation's hand-rolled code was
itself reimplementing for Workers (`yjs`, `y-protocols`, `lib0`):

- One `Y.Doc` + `Awareness` per room (`poc/relay/room.ts`), fed by the raw
  CRDT update bytes the `CollaborationProvider`s on either end emit. The relay
  never parses DOCX/XLSX/PPTX — it only needs the generic Yjs update format,
  which Yrs (Rust) is binary-compatible with by design.
- Standard `y-protocols/sync` + `y-protocols/awareness` message framing — the
  same wire convention most Yjs providers (including, per its own source,
  BetterOffice's own relay) use: `messageSync(0)` / `messageAwareness(1)`.
- File-backed append log + periodic checkpoint compaction
  (`poc/relay/store.ts`), standing in for the `betteroffice_sessions`-table-
  adjacent MariaDB storage Phase 3 will build; the **shape** (checkpoint +
  ordered update log, atomic replace on compaction) mirrors the reference
  relay's `RetainedUpdateLog`, confirmed by reading its source.
- Confirmed, matching the reference relay's own constants: 16 MiB max frame
  (`shared/collaboration-limits.ts` upstream), reproduced as
  `MAX_FRAME_BYTES` in `poc/relay/server.ts`; its 32 KiB max awareness payload
  was **not** separately enforced in this PoC (noted as a gap below).

`docx.relay-restart.spec.ts` proves the restart-survival requirement for
real: a dedicated relay subprocess is spawned on its own port and data dir, a
client writes an accepted update, the relay process is sent `SIGTERM` and a
**new** process is spawned against the same data directory, and a **third,
previously-uninvolved** browser client joins after the restart and receives
the persisted edit — satisfying PLAN.md §9.6 ("a relay restart must not lose
accepted updates") without faking it via in-memory state.

## 5. Transport details confirmed end-to-end

- `send()` returning `false` under backpressure and emitting a later `drain`
  — implemented against `WebSocket.bufferedAmount`, not exercised at scale in
  this PoC (no multi-MB payload test), noted as a performance-phase gap.
- Binary-only frames; the relay closes the socket (code 1003) on a text frame,
  oversized frame (1009) past 16 MiB, or malformed/undecodable top-level
  message (1002) — mirrors PLAN.md §13's size/validation requirements.
- Origin validation (`§13` "Strict Origin validation") is **not yet
  implemented** — the relay's CORS headers in this PoC are a wildcard
  (`Access-Control-Allow-Origin: *`) purely so the dev-server-on-one-port /
  relay-on-another-port split works locally. This must become a strict
  allow-list of the real Nextcloud origin before anything is deployed.

## 6. Bundler gotcha (will recur in the production app)

`@betteroffice/docx`'s wasm-bindgen glue resolves its `.wasm` asset via
`new URL('./generated/.../foo.wasm', import.meta.url)`. Under Vite's
dependency pre-bundler ("optimizeDeps"), esbuild concatenates/moves the module
into `.vite/deps/`, which **silently breaks that relative URL** — the fetch
404s, Vite's SPA history-fallback serves `index.html` instead, and
`WebAssembly.compile()` throws `expected magic word... found 3c 21 64 6f`
(i.e. it tried to compile the string `<!do` from the HTML fallback page). Fix:
exclude every `@betteroffice/*` package from `optimizeDeps` (`vite.config.ts`
in this PoC). The production Nextcloud app's own Vite config will need the
same exclusion list.

## 7. Known limitations / gaps carried into later phases

- **Fonts**: no `configureDefaultFonts`/`@betteroffice/fonts` wiring yet —
  every run logs `[fontRegistry] no font bytes for "Calibri Light"...` and
  falls back to approximate metrics, so pagination will not match Word yet.
  Real work for Phase 4 (§7.5); `@betteroffice/fonts-intl`/`fonts-latin` are
  not implemented upstream (see §1), only `fonts` + `fonts-cjk` exist.
- **PPTX's `fonts` prop is mandatory** even on the async editor
  (`fonts: ReadonlyArray<PptxFontFace>`, not optional) — this PoC passes `[]`;
  production needs a real font list once fonts are wired.
- Awareness payload size cap (32 KiB) not enforced by this relay yet.
- No Origin allow-list, no auth/token verification at all yet — §8.5's signed
  short-lived collaboration token is entirely unbuilt; this PoC's relay trusts
  any client that can reach it. Out of scope for Phase 0, mandatory before
  Phase 3 is "done".
- Three-or-more-peer and reconnect-mid-edit scenarios (§15.2) were not
  exercised — this PoC only proves 2 peers plus a post-restart 3rd joiner.
- No load/performance measurement (§16) — out of scope for Phase 0.
- A large fraction of the editors' type surface is marked `@experimental` or
  `@deprecated` (plugin API, `legacySyncApi`, worker-viewer-only paths). This
  PoC and the recommended production path use only the documented, current
  async surface (`DocxEditor`/`XlsxEditor`/`PptxEditor` without
  `legacySyncApi`, without `experimentalWorkerOpen`).

## 8. How to run this proof

```bash
cd poc
npm install
npx tsx relay/server.ts &        # or: npm run dev:relay
npx vite &                        # or: npm run dev:app
npx playwright install chromium   # first run only
npx playwright test               # runs all 5 specs
```

`tests/docx.smoke.spec.ts` — single editor renders real document content.
`tests/docx.collab.spec.ts` — two peers converge, save() round-trips through
an actual unzip-and-grep of the exported `.docx`.
`tests/docx.relay-restart.spec.ts` — kills and restarts a dedicated relay
process; a fresh third client recovers the persisted edit.
`tests/xlsx.collab.spec.ts`, `tests/pptx.collab.spec.ts` — same convergence
proof adapted to each format's actual (and differently-shaped) collaboration
API, per §3 above.
