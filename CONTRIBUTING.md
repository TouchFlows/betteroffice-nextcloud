# Contributing

## Before you start

- This project keeps BetterOffice as an upstream dependency. Do not fork or
  vendor BetterOffice packages; file issues upstream for defects.
- Do not invent BetterOffice or Nextcloud APIs. Verify any interface you rely
  on against the pinned package version actually installed
  (`composer show`, `package.json`) and its TypeScript declarations or PHP
  source, not memory or older examples.
- Read [PLAN.md](PLAN.md) before starting work on a phase. It records the
  mandatory ordering (Phase 0's standalone proof gates everything after it)
  and the hard "do not" list (never disable Collabora, never touch production
  without explicit approval, etc.).

## Workflow

1. Branch from `main`.
2. Keep changes scoped to one of `app/`, `relay/`, or `docs/` where possible —
   they have independent CI jobs and, eventually, independent versioning.
3. Run the relevant checks locally before opening a PR:
   - `app/`: see [docs/development.md](docs/development.md) for PHP/JS
     commands.
   - `relay/`: `cd relay && npm ci && npm run typecheck && npm test`.
4. Every behaviour change ships with a test covering that behaviour and its
   likely failure modes.
5. Open a PR against `main`. CI must pass before merge.

## Commit messages

Describe the *why*, not just the *what*. Reference the PLAN.md phase/section
a change implements when relevant.

## Reporting a vulnerability

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Licensing

By contributing, you agree your contribution is licensed under this
repository's Apache-2.0 licence (see [LICENSE](LICENSE)).
