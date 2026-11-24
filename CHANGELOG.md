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

### Fixed

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
