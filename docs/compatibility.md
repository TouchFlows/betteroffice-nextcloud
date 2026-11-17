# Compatibility

## Nextcloud

Declared in `app/appinfo/info.xml`: `min-version="31"` `max-version="35"`.
35 was the latest stable Nextcloud release when this was written (October
2026); 33–35 were the currently supported majors. `min-version="31"` is the
floor at which the App Store schema accepts an `Apache-2.0` `<licence>`
value — re-check both bounds against the current schema
(`https://apps.nextcloud.com/schema/apps/info.xsd`) before each release, per
PLAN.md §6.1 ("do not copy a fixed compatibility declaration from an earlier
release").

No declared Nextcloud version has been installed and tested yet (Phase 1).
Testing each declared version is required before Phase 6/8 (App Store
submission).

## PHP

`>=8.3` (`app/composer.json`), matching Nextcloud 35's minimum. Nextcloud 35
recommends 8.5; 8.3 is deprecated as of NC 35 and NC 37 may require 8.4+ —
revisit this floor alongside the Nextcloud version bound.

## Database

| | App (`app/`) | Relay (`relay/`) |
| --- | --- | --- |
| MySQL/MariaDB | ✓ (via Nextcloud's own DB abstraction) | ✓ MariaDB only — the reference/required target |
| PostgreSQL | ✓ | ✗ (§5.2: "PostgreSQL support may be considered later... not a requirement for the initial release") |
| SQLite | ✓ | ✗ |

## Browsers

Not yet measured. BetterOffice's editors are WASM-based and need a modern
evergreen browser; Phase 0's proof ran against Chromium only (via
Playwright). Desktop + mobile browser testing is explicit scope for later
phases (PLAN.md §11, §15).

## BetterOffice packages

Pinned to `0.5.1` across `@betteroffice/docx(-react)`,
`@betteroffice/xlsx(-react)`, `@betteroffice/pptx(-react)`, and `0.4.2` for
`@betteroffice/fonts`/`fonts-cjk` — see `poc/RECONNAISSANCE.md` §1 for the
full table and what was actually verified at that version. Re-verify, don't
assume, before bumping.
