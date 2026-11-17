# Security policy

## Supported versions

This project has not yet reached a tagged release. Until a 1.0 release,
only the `main` branch is supported with security fixes.

## Reporting a vulnerability

Please report security vulnerabilities privately using
[GitHub's private vulnerability reporting](../../security/advisories/new)
for this repository, rather than opening a public issue. Include:

- The component affected (`app/`, `relay/`, or an upstream BetterOffice
  package).
- Steps to reproduce, or a minimal proof of concept.
- The impact you believe it has (e.g. unauthorised file access, collaboration
  token forgery, denial of service).

We will acknowledge reports within a reasonable time and coordinate
disclosure before any public write-up.

## Scope notes specific to this project

- The relay (`relay/`) is an internet-exposed service by design (PLAN.md
  §13). Vulnerabilities there — authentication bypass, room-ID enumeration,
  resource-exhaustion via oversized frames or connection floods — are in
  scope and high priority.
- The Nextcloud app (`app/`) must never grant file access beyond what
  Nextcloud's own permission model allows. A report that the app bypasses
  Nextcloud share/permission checks is in scope and high priority.
- Vulnerabilities in BetterOffice itself (the upstream WASM editors) should
  be reported to the [upstream project](https://github.com/openooxml/betteroffice)
  directly.
