# BetterOffice for Nextcloud

A native Nextcloud application that opens, edits and collaborates on DOCX,
XLSX and PPTX files using [BetterOffice](https://betteroffice.dev/)'s
WebAssembly editors, with real-time collaboration served by a self-hosted
relay — no Collabora, no ONLYOFFICE, no external document service.

This repository is a monorepo with three independently deployable pieces:

| Path | What it is |
| --- | --- |
| [`app/`](app/) | The Nextcloud application: PHP backend (auth, file access, saving, permissions) + a React/TypeScript frontend rendering the BetterOffice editors. |
| [`relay/`](relay/) | A self-hosted WebSocket relay for real-time collaboration, protocol-compatible with BetterOffice's CollaborationProvider but independent of Cloudflare Durable Objects. |
| [`docs/`](docs/) | Architecture, installation, configuration, security, backup/recovery, troubleshooting and compatibility documentation. |

## Status

Early development. See [PLAN.md](PLAN.md) for the full engineering
specification and phased delivery plan, and
[poc/RECONNAISSANCE.md](poc/RECONNAISSANCE.md) for the Phase 0 technical
reconnaissance (confirmed package APIs, seed-generation behaviour, save/
export lifecycle, and the self-hosted relay's protocol) that this
implementation is built on.

**Nothing here is installed in production yet.** Do not uninstall or disable
Collabora/`richdocuments` based on this repository's existence — PLAN.md §17
Phase 7 gates that on explicit owner approval after full acceptance testing.

## Repository layout

```
app/      Nextcloud app (appinfo/, lib/, src/, templates/, css/, img/, tests/)
relay/    Collaboration relay (src/, tests/, migrations/)
docs/     Project documentation
poc/      Phase 0 standalone proof of concept (kept for reference; not deployed)
```

## Development

See [docs/development.md](docs/development.md) for local setup of both the
app and the relay, and [CONTRIBUTING.md](CONTRIBUTING.md) for the
contribution workflow.

## Licence

Apache-2.0 — see [LICENSE](LICENSE). Third-party licence compatibility is
tracked as dependencies are added; see PLAN.md §2.1.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Support this project

If you find this project useful, consider supporting its development.

[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github)](https://github.com/sponsors/marktamis)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-Support-FFDD00?logo=buy-me-a-coffee&logoColor=000)](https://buymeacoffee.com/marktamis)
