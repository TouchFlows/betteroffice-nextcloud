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
  default) registered into the Files app via `LoadAdditionalScriptsEvent`.
- `[app]` Non-collaborative DOCX open/edit/save: `FileAccessService` and
  `DocumentService` (permission-scoped file resolution, native locking,
  ETag-conflict-checked saves), `EditorController`/`DocumentController`,
  and a React editor page wired to `@betteroffice/docx-react`.
