# Cross-component tests

Reserved for integration/end-to-end tests that exercise `app/` and `relay/`
together once both are real (Phase 2+) — `fixtures/` for shared sample
documents, `end-to-end/` for tests that drive a real Nextcloud + relay pair.

Until then:

- `app/tests/` — PHP unit tests for the Nextcloud app, no running server
  required.
- `relay/tests/` — Node unit tests for the relay.
- `poc/tests/` — Playwright end-to-end tests proving the BetterOffice
  collaboration/save lifecycle against a standalone relay (Phase 0; not
  re-run against `app/`/`relay/` until those are real).
