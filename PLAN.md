# BetterOffice Native Nextcloud App

## Engineering specification and implementation handoff

**Project ID:** `betteroffice`  
**Nextcloud app ID:** `betteroffice`  
**GitHub repository:** `Touchflows/betteroffice-nextcloud`  
**Repository visibility:** Public  
**Target:** Latest stable Nextcloud release at implementation time  
**Compatibility:** Only Nextcloud versions explicitly tested and supported  
**Editors:** DOCX, XLSX, PPTX  
**Collaboration:** Mandatory, self-hosted  
**Existing editor:** Collabora, to be retired only after acceptance testing  
**Deployment:** Conventional PHP/Nginx or Apache installation  
**Database:** Same database engine as the existing Nextcloud installation; MariaDB/MySQL is the initial reference configuration  
**Licence:** Apache-2.0, subject to dependency licence verification  
**Final delivery objective:** Published and installable through the official Nextcloud App Store

---

# 1. Mission and scope

Develop a standalone native Nextcloud application integrating BetterOffice document editors directly into Nextcloud Files.

The application must provide:

- Native Nextcloud authentication and authorisation.
- Native file access and storage.
- DOCX editing.
- XLSX editing.
- PPTX editing.
- Real-time multi-user collaboration for all three formats.
- Persistent collaborative sessions.
- Automatic saving.
- Conflict detection and recovery.
- Nextcloud version-history integration.
- Native Nextcloud user interface.
- Self-hosted collaboration infrastructure.
- A production-ready installation and upgrade process.

The application must not depend on:

- Collabora.
- ONLYOFFICE.
- `richdocuments` at runtime.
- WOPI.
- Cloudflare.
- External document storage.
- Modifications to Nextcloud core.

Do not fork BetterOffice unless a documented upstream defect makes it necessary.

Do not invent BetterOffice APIs. Verify all interfaces against the actual installed package versions, TypeScript declarations and upstream implementation.

## 1.1 Project principles

The following priorities are mandatory, in this order:

1. Document integrity.
2. Correct collaborative editing.
3. Reliable saving and recovery.
4. Security and permission enforcement.
5. Native Nextcloud integration.
6. Performance.
7. User-interface polish.

A visually complete editor that can silently lose edits is not an acceptable implementation.

# 2. Repository and project organisation

Create a public GitHub repository under the Touchflows organisation/account:

`Touchflows/betteroffice-nextcloud`

The repository name is the agreed proposal. Verify that the repository does not already exist and that the GitHub account has the necessary permissions before creating it.

Use a monorepo containing the Nextcloud application, collaboration relay, documentation and tests.

Suggested layout:

```text
betteroffice-nextcloud/
├── app/
│   ├── appinfo/
│   ├── lib/
│   ├── src/
│   ├── templates/
│   ├── css/
│   ├── img/
│   ├── l10n/
│   ├── tests/
│   ├── package.json
│   └── composer.json
├── relay/
│   ├── src/
│   ├── tests/
│   ├── migrations/
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   ├── architecture.md
│   ├── installation.md
│   ├── configuration.md
│   ├── security.md
│   ├── backup-and-recovery.md
│   ├── troubleshooting.md
│   ├── development.md
│   ├── compatibility.md
│   └── app-store-submission.md
├── tests/
│   ├── fixtures/
│   └── end-to-end/
├── .github/
│   └── workflows/
├── LICENSE
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── SECURITY.md
```

The exact directory structure may evolve to follow current Nextcloud conventions.

## 2.1 Repository standards

Implement:

- Public source repository.
- Apache-2.0 licence, after checking all bundled dependencies and assets.
- Separate versioning for the Nextcloud app and relay where appropriate.
- Git tags and release notes.
- Changelog.
- GitHub Actions CI.
- Automated dependency checks.
- Automated tests.
- Static analysis.
- Security scanning.
- Reproducible release builds.

Never commit:

- Credentials.
- Private keys.
- JWT signing secrets.
- Database passwords.
- Production configuration.
- User documents.
- Real collaboration tokens.

Pin production dependencies. Avoid floating `latest` package versions.

Keep BetterOffice as an upstream dependency rather than maintaining a fork.

# 3. Initial technical reconnaissance — mandatory

Before writing the production application, inspect:

1. The latest stable Nextcloud release and its developer API.
2. The actual Nextcloud app development conventions for that release.
3. The BetterOffice GitHub repository.
4. Published npm packages and exact versions.
5. BetterOffice collaboration provider implementations.
6. The reference collaboration relay.
7. DOCX, XLSX and PPTX editor interfaces.
8. Nextcloud Files API and file-action registration.
9. Nextcloud storage and locking interfaces.
10. Nextcloud App Store submission and validation requirements.

Official sources:

- https://betteroffice.dev/
- https://docs.betteroffice.dev/docs/packages
- https://docs.betteroffice.dev/docs/javascript
- https://docs.betteroffice.dev/docs/collaboration
- https://docs.betteroffice.dev/docs/wopi
- https://github.com/openooxml/betteroffice
- https://docs.nextcloud.com/server/stable/developer_manual/
- https://apps.nextcloud.com/

BetterOffice packages:

| Format | React package | Core package |
|---|---|---|
| DOCX | `@betteroffice/docx-react` | `@betteroffice/docx` |
| XLSX | `@betteroffice/xlsx-react` | `@betteroffice/xlsx` |
| PPTX | `@betteroffice/pptx-react` | `@betteroffice/pptx` |

Install matching versions of all three format packages.

Verify React peer dependencies and compatibility before choosing the frontend version.

Produce a reconnaissance report identifying:

- Confirmed public interfaces.
- Exact package versions.
- Required runtime versions.
- Collaboration seed-generation methods.
- Editor save/export methods.
- Transport interface.
- Persistence requirements.
- Known feature limitations.
- Licensing implications.
- Any missing or unstable upstream APIs.

Do not proceed to production implementation until the standalone collaboration and save lifecycle has been demonstrated.

# 4. Architecture

Use three independently deployable components.

## A. Native Nextcloud application

Application ID: `betteroffice`

Responsibilities:

- Authentication.
- File permissions.
- File retrieval.
- File saving.
- File locking.
- Version history.
- File actions.
- Editor routing.
- Collaboration token issuance.
- Session management.
- Conflict recovery.
- Administration settings.

Technology:

- PHP using Nextcloud OCP interfaces.
- React.
- TypeScript.
- Current Nextcloud-supported frontend tooling.
- Nextcloud database abstraction for app-owned tables.

## B. BetterOffice frontend

Use the official React editors.

The editor must be rendered inside a native Nextcloud application page, not in an iframe pointing to an external office service.

The frontend must:

- Load original file bytes.
- Initialise the correct editor.
- Connect to the collaboration provider.
- Display connection and save status.
- Export modified document bytes.
- Submit saves to the Nextcloud application.
- Release collaboration resources when closed.
- Respect read-only permissions.
- Handle disconnections and reconnections.

Use React consistently. Do not introduce Vue unnecessarily.

## C. Self-hosted collaboration relay

Deploy a self-hosted WebSocket service.

Responsibilities:

- Room creation.
- Authentication.
- Room authorisation.
- WebSocket connections.
- Binary update forwarding.
- Durable update persistence.
- Reconnection.
- Checkpointing.
- Room lifecycle.
- Save coordination.
- Presence.

The official reference relay uses Cloudflare Durable Objects. Do not deploy that Cloudflare implementation as a production dependency.

Implement a compatible self-hosted relay using the reference implementation as the protocol and behaviour reference.

The relay must not need direct access to Nextcloud's document storage.

# 5. Database architecture

Use the same database engine already configured for the Nextcloud installation.

Do not introduce a second database server unnecessarily.

## 5.1 Nextcloud app database

Use Nextcloud's database abstraction and migration mechanisms.

Do not assume MariaDB-specific SQL in the Nextcloud application layer.

Do not access Nextcloud internal tables directly.

The app must work with the database engines supported by the Nextcloud versions it declares compatible.

## 5.2 Relay database

Initial reference deployment: MariaDB.

Use a dedicated database and restricted database account, for example:

```text
Database: betteroffice_relay
User: betteroffice_relay
```

The relay must have access only to its own database.

It must not have credentials for Nextcloud's database user.

PostgreSQL support may be considered later if there is a demonstrated distribution or deployment requirement. It is not a requirement for the initial release.

## 5.3 Database migrations

The relay and Nextcloud application must have independent migration systems.

Requirements:

- Versioned migrations.
- Safe upgrades.
- Backup before destructive migrations.
- Migration rollback strategy where feasible.
- Documented recovery from interrupted migrations.

# 6. Nextcloud application integration

## 6.1 Application registration

Create a valid `appinfo/info.xml`.

Declare:

- App ID: `betteroffice`.
- Application name and description.
- Version.
- Author and project URL.
- Licence.
- Minimum Nextcloud version.
- Maximum tested Nextcloud version where required.
- PHP requirements.
- Dependencies only where genuinely necessary.

Target the latest stable Nextcloud version at implementation time.

Do not copy a fixed compatibility declaration from an earlier release. Verify the current App Store validator requirements and test each declared version.

There must be no runtime dependency on `richdocuments`.

Use Nextcloud dependency injection and OCP interfaces.

Do not access private Nextcloud classes or internal database tables.

## 6.2 Files integration

Use the supported Nextcloud Files frontend APIs, including `@nextcloud/files` where appropriate.

Register file actions for:

- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation`

Provide an **Open with BetterOffice** action.

Investigate the supported Nextcloud viewer registration extension point to enable native double-click opening.

Do not monkey-patch Files or replace global click handlers.

A reliable explicit file action is mandatory even if native viewer registration requires additional work.

Support:

- Personal files.
- Shared files.
- Group folders.
- Nested folders.
- Read-only shares.
- Public shares where Nextcloud permissions permit editing.

## 6.3 File identification and permissions

Use the Nextcloud file ID as the authoritative identifier.

Do not use file paths as persistent identifiers because files can be renamed or moved.

Resolve the current node through authenticated Nextcloud storage APIs.

Every operation must check:

- File existence.
- User identity.
- Ownership or share access.
- Read permission.
- Update permission.
- Correct MIME type.
- File size limits.

A user must never gain access to a file by changing a file ID in an HTTP request.

Recheck permissions before every save.

Permission revocation must invalidate further writes and collaboration access.

## 6.4 File operations

Use Nextcloud's native storage interfaces.

Conceptual service responsibilities:

```php
getFile($fileId, $userId);
getFileContent($fileId, $userId);
saveFileContent($fileId, $content, $expectedEtag);
getFileEtag($fileId, $userId);
```

These are conceptual responsibilities, not prescribed method names.

Use the supported OCP filesystem and file-node APIs.

Use Nextcloud's native file locking provider when writing files.

Never bypass:

- Storage wrappers.
- Encryption.
- External storage.
- Quotas.
- File-cache handling.
- Nextcloud version history.

# 7. Editor integration

Import the published React components.

Exact prop names, callbacks and export methods must be verified against the pinned package versions and their TypeScript declarations.

Do not rely on old examples or invented signatures.

## 7.1 DOCX

Expected package:

```typescript
import { DocxEditor } from '@betteroffice/docx-react';
import '@betteroffice/docx-react/styles.css';
```

The documented interface includes `documentBuffer`.

Verify the exact collaboration and save callback APIs.

## 7.2 XLSX

Expected package:

```typescript
import { XlsxEditor } from '@betteroffice/xlsx-react';
```

The documented interface uses `file`.

Verify the current `onReady`, save and committed-change APIs.

If `save()` commits pending input, ensure the save lifecycle waits for that operation to finish before exporting bytes.

## 7.3 PPTX

Expected package:

```typescript
import { PptxEditor } from '@betteroffice/pptx-react';
```

The documented interface uses `file`.

Verify the exact save/export and collaboration APIs in the pinned package version.

## 7.4 Common requirements

All editors must:

- Use the default asynchronous editor API.
- Avoid deprecated `legacySyncApi`.
- Support read-only mode.
- Report dirty state.
- Report saving state.
- Report saved state.
- Report collaboration connection state.
- Clean up workers, providers and transports on unmount.
- Prevent accidental navigation while a save is outstanding.
- Preserve the original document format.
- Save to the original Nextcloud file.

The default Save operation must not download a local copy.

## 7.5 Fonts and assets

Investigate BetterOffice font packages:

- `@betteroffice/fonts`
- `@betteroffice/fonts-cjk`
- `@betteroffice/fonts-intl`
- `@betteroffice/fonts-latin`

Prefer self-hosted font assets for privacy, reliability and predictable rendering.

Do not depend on external font CDNs at runtime unless the user explicitly enables that behaviour.

Verify the documented font configuration APIs before implementation.

# 8. Collaboration architecture

Real-time collaboration is mandatory for DOCX, XLSX and PPTX.

BetterOffice uses Yrs CRDT. Its format-specific collaboration providers exchange Yjs sync-v1 frames over a transport supplied by the host.

The official provider imports are:

```typescript
import {
    CollaborationProvider
} from '@betteroffice/docx/collaboration';

import {
    CollaborationProvider
} from '@betteroffice/xlsx/collaboration';

import {
    CollaborationProvider
} from '@betteroffice/pptx/collaboration';
```

Verify exact exports and constructor signatures against the pinned versions.

Each document and format must have its own room.

## 8.1 Room identifiers

Generate a stable opaque room identifier from:

- Nextcloud instance ID.
- Nextcloud file ID.
- Document format.

Use a server-side keyed HMAC rather than exposing internal file IDs.

Room IDs must not be reusable across different Nextcloud installations.

## 8.2 Initial state and room seeding

This is a critical implementation detail.

BetterOffice requires an `initialUpdate` representing the shared starting state.

The first client must not independently create a different seed for an existing room.

Implement atomic room initialisation:

1. Open the original file through Nextcloud.
2. Read its current ETag.
3. Generate the appropriate collaboration seed using the documented BetterOffice format-specific APIs.
4. Attempt an atomic create-if-absent operation.
5. Store the seed and source ETag.
6. If another client created the room first, discard the locally generated seed and retrieve the authoritative existing seed.
7. Apply persisted room updates.
8. Connect the collaboration provider.

Investigate the upstream `build-collaboration-seeds.ts` implementation.

Verify seed generation separately for DOCX, XLSX and PPTX.

Do not assume that the same implementation works for all formats.

Test that two independently created editors using the same seed converge to the same state.

## 8.3 Collaboration transport

Implement the official BetterOffice `CollaborationTransport` interface.

The transport must support:

- Binary frames.
- Connect.
- Disconnect.
- Message delivery.
- Backpressure.
- `send()` returning false when it cannot accept a frame.
- Correct `drain` event behaviour.
- Reconnection.
- Error reporting.

Do not convert binary updates into JSON.

Do not silently discard updates.

Use the reference relay and its protocol implementation as the authoritative guide.

## 8.4 Durable room persistence

Persist:

- Initial seed.
- Accepted update frames.
- Checkpoint data.
- Room epoch.
- Last activity.
- File identity.
- Last known saved ETag.
- Active save lease.
- Room status.

The relay must acknowledge an update as durably accepted only after the required persistence transaction succeeds.

Checkpointing must preserve CRDT identity and merge semantics.

The reference relay uses Yjs v1 update merging, a 16 MiB frame budget and 24-hour idle expiration. These are reference behaviours, not automatic guarantees of a custom relay.

Inspect the upstream source and reproduce or deliberately improve these behaviours.

A checkpoint is not a replacement for the original Office file or Nextcloud version history.

## 8.5 Authentication and room authorisation

Nextcloud is the authority for user permissions.

When a user opens a document:

1. Nextcloud authenticates the user.
2. The backend checks file permissions.
3. The backend issues a short-lived signed collaboration token.
4. The frontend connects to the relay.
5. The relay verifies the token.
6. The relay authorises the requested room.

Token claims should include:

- Nextcloud instance ID.
- User ID.
- File ID.
- Room ID.
- Document format.
- Read/write role.
- Expiration.
- Unique token identifier.

Use a short expiry, such as five minutes, with a secure refresh mechanism.

Never put long-lived credentials in URLs.

Do not trust browser-supplied user IDs or permission flags.

Read-only users must not be able to submit editing updates.

The relay must enforce permissions server-side.

## 8.6 Presence

Expose collaborator presence where permitted:

- Display name.
- Avatar.
- Connection status.
- Read-only or editing status.

Use Nextcloud's user information and sharing permissions.

Do not disclose user details to unauthorised participants.

# 9. Saving and document integrity

Saving must be reliable even if an editor or collaboration participant disconnects.

Do not rely exclusively on browser `beforeunload`.

## 9.1 Validate the save architecture before implementation

A browser-based save leader is only a proposed architecture, not an assumed BetterOffice capability.

Before implementing it, establish whether the official BetterOffice APIs can reliably export a canonical document from the current collaborative state.

In particular, verify:

- Whether the editor can export after all pending collaborative updates have been applied.
- Whether an editor instance can become the authoritative exporter.
- Whether a new leader can reconstruct the same state after the previous leader disconnects.
- Whether the exported document is guaranteed to include all accepted CRDT updates.
- Whether a server-side serialization worker is possible.

If these guarantees cannot be established, do not implement a fragile browser-leader design.

Consider a dedicated server-side save/serialization worker if the upstream APIs support it.

The final architecture must guarantee that accepted collaborative edits are not lost when a browser closes or a save leader disconnects.

## 9.2 Save coordination

If a save leader is used, implement:

- One designated writer per room.
- A time-limited save lease.
- Monotonically increasing fencing tokens.
- Lease renewal.
- Leader election.
- Safe handover.
- Rejection of stale leader saves.

A previous leader must never be able to overwrite a newer save.

The relay must coordinate save state, but the Nextcloud application remains the only authority permitted to write the original file.

## 9.3 Native Nextcloud save process

The Nextcloud application must:

1. Authenticate the user or authorised save service.
2. Recheck file permissions.
3. Validate the signed save lease and fencing token.
4. Acquire the Nextcloud exclusive storage lock.
5. Read the current ETag.
6. Compare it with the expected ETag.
7. Write only if the comparison succeeds.
8. Release the storage lock.
9. Return the new ETag.
10. Notify the collaboration room of the successful save.

Only an authorised current save operation may persist a room's document.

## 9.4 Save scheduling

Implement:

- Debounced autosave.
- Periodic safety saves.
- Explicit Save command.
- Save on safe leader handover.
- Save before the last participant leaves where possible.
- Recovery after reconnect.

Suggested starting values:

- Autosave debounce: 2 seconds after inactivity.
- Maximum unsaved interval: 15 seconds.
- Save retry: exponential backoff.
- Maximum retry count: configurable.

These are starting values, not fixed requirements. Validate them under load.

Always display save status.

## 9.5 External modifications and conflicts

Never silently overwrite an externally modified document.

If the ETag no longer matches:

1. Refuse the write.
2. Mark the room as externally modified.
3. Notify participants.
4. Preserve collaborative state.
5. Generate a recoverable conflict copy.
6. Require an explicit user decision before replacing the original.

Use Nextcloud's native file APIs to create the conflict copy.

Do not silently merge an externally modified Office file into an existing CRDT room.

## 9.6 Failure recovery

A relay restart must not lose accepted updates.

A browser closing must not destroy collaborative state.

A save leader disconnecting must trigger safe recovery.

If the final participant leaves:

- Flush pending changes.
- Confirm persistence.
- Release the session.
- Retain durable room state according to the recovery policy.

If persistence cannot be confirmed, do not acknowledge the update as safely stored.

# 10. Database design

Use Nextcloud migrations for application-owned tables.

Suggested Nextcloud application tables:

### `betteroffice_sessions`

- id
- instance_id
- file_id
- format
- room_id
- room_epoch
- initial_etag
- saved_etag
- status
- created_at
- updated_at

### `betteroffice_save_leases`

- session_id
- leader_id
- fencing_token
- expires_at

### `betteroffice_conflicts`

- session_id
- original_etag
- external_etag
- conflict_file_id
- status
- created_at

The collaboration relay maintains its own database and schema.

Do not mix relay persistence tables with Nextcloud application tables.

Do not store passwords, access tokens or unencrypted authentication secrets in these tables.

# 11. Native Nextcloud UI

The application must look and behave like a first-party Nextcloud application.

Editor shell:

- Nextcloud header.
- File name.
- Back to Files.
- Editor.
- Save status.
- Collaboration status.
- Collaborator indicators.
- Save command where appropriate.

Suggested status indicators:

| State | Display |
|---|---|
| Connected | Connected |
| Reconnecting | Reconnecting |
| Offline | Offline |
| Dirty | Unsaved changes |
| Saving | Saving |
| Saved | All changes saved |
| Conflict | External modification detected |
| Error | Save failed |

Provide a confirmation dialog when leaving with unsaved changes.

Use Nextcloud translation facilities.

Support desktop and mobile browser layouts. Advanced spreadsheet editing may be desktop-oriented, but the application must remain usable on mobile.

# 12. New document creation

Provide native Files creation actions:

- New document (.docx)
- New spreadsheet (.xlsx)
- New presentation (.pptx)

Create valid minimal OOXML documents using documented BetterOffice generation capabilities or tested templates.

Do not create zero-byte files.

New documents must:

- Be stored directly in Nextcloud.
- Receive a valid file ID.
- Open immediately in the appropriate editor.
- Have a correctly initialised collaboration room.
- Save normally.
- Appear in Nextcloud version history.

# 13. Security requirements

Treat the collaboration relay as an exposed public service.

Mandatory protections:

- HTTPS and WSS only.
- Strict Origin validation.
- Signed, short-lived tokens.
- Room-level authorisation.
- Read-only enforcement.
- Rate limits.
- Maximum message size.
- Maximum connections per user.
- Maximum participants per room.
- Input validation.
- SQL parameterisation.
- No sensitive token logging.
- Secure WebSocket shutdown.
- Protection against replayed expired tokens.
- Protection against room-ID enumeration.
- Audit logging for file saves and conflicts.
- Secure handling of font and editor assets.
- Dependency vulnerability monitoring.

The relay must not have general access to Nextcloud storage.

The relay only needs document-session metadata and the CRDT update stream.

The Nextcloud backend remains the only authority allowed to write the original file.

# 14. Deployment

The Nextcloud app is installed conventionally:

```text
nextcloud/apps/betteroffice/
```

The relay is a separate systemd service.

No mandatory Docker or Kubernetes dependency.

Suggested deployment:

```text
Nextcloud server
    |
    | HTTPS
    |
    +---- /apps/betteroffice/
    |        PHP application
    |        React editor
    |
    +---- Native Nextcloud storage

office-relay.example.net
    |
    | HTTPS / WSS
    |
    Nginx reverse proxy
    |
    BetterOffice collaboration relay
    |
    MariaDB
```

Hostnames are deployment configuration and must not be hardcoded.

## 14.1 Nginx

Configure:

- HTTPS.
- WebSocket upgrade.
- Appropriate proxy read timeout.
- Request-size limits.
- No caching of authenticated API responses.
- No logging of authentication headers or tokens.
- Correct forwarding headers.
- Graceful handling of long-lived connections.

## 14.2 systemd

Provide:

- Dedicated unprivileged service account.
- Environment file with restrictive permissions.
- Restart on failure.
- Resource limits.
- Journald logging.
- Graceful shutdown.
- Database connectivity checks.
- Health endpoint or equivalent monitoring.

Provide installation, upgrade, backup and rollback instructions.

# 15. Testing

All three formats must be tested independently.

## 15.1 Functional tests

DOCX:

- Open existing file.
- Edit text.
- Format text.
- Save.
- Close and reopen.
- Verify formatting and content.

XLSX:

- Edit cells.
- Edit formulas.
- Change formatting.
- Save.
- Close and reopen.
- Verify values and formulas.

PPTX:

- Edit slide text.
- Edit objects and formatting where supported.
- Save.
- Close and reopen.
- Verify slides and content.

## 15.2 Collaboration tests

- Two users open the same document.
- Both make edits.
- Updates appear in real time.
- Both clients converge.
- Three or more users collaborate.
- Read-only participant cannot edit.
- Participant loses connection and reconnects.
- Save coordinator disconnects.
- New coordinator takes over.
- Relay restarts.
- All users disconnect.
- Document is reopened after prolonged idle time.

Repeat for DOCX, XLSX and PPTX.

## 15.3 Conflict tests

- External WebDAV modification.
- External Nextcloud Files modification.
- File rename during editing.
- File deletion during editing.
- Share permission revoked during editing.
- User loses write permission.
- Save request arrives with an expired lease.
- Old leader attempts to save after a new leader is elected.

## 15.4 Security tests

- Invalid JWT.
- Expired JWT.
- Replayed token.
- Wrong room.
- Wrong Nextcloud instance.
- Read-only token attempts a write.
- Invalid WebSocket origin.
- Oversized update.
- Malformed binary frame.
- Unauthorised file ID.
- Revoked share.
- Invalid save lease.
- Stale fencing token.

## 15.5 Recovery tests

- Relay killed during editing.
- MariaDB temporarily unavailable.
- Nextcloud unavailable during save.
- Network interrupted during save.
- PHP process interrupted.
- Browser closed unexpectedly.
- Save coordinator terminated.
- Server restarted with active rooms.

No accepted collaboration update may be silently lost.

# 16. Performance requirements

Establish baseline measurements rather than inventing performance claims.

Measure:

- Initial editor load time.
- Time to first collaborative connection.
- Update propagation latency.
- Autosave latency.
- Memory per open room.
- Relay CPU utilisation.
- Database growth.
- Concurrent room capacity.

Test representative documents of different sizes.

Implement configurable maximum document size and room participant count.

# 17. Development phases

## Phase 0 — Technical proof of concept

Hard gate before full application development.

1. Install the three published React packages.
2. Open sample DOCX, XLSX and PPTX files.
3. Generate a valid collaboration seed for each format.
4. Connect two editors through a custom WebSocket transport.
5. Verify real-time convergence.
6. Export the resulting bytes.
7. Reopen each document and verify the saved result.
8. Restart the relay and verify recovery.
9. Confirm no accepted updates are lost.

Deliverables:

- Working standalone prototype.
- API reconnaissance report.
- Exact pinned package versions.
- Documented save/export lifecycle.
- Collaboration persistence test results.

## Phase 1 — Repository and application skeleton

- Create the public GitHub repository.
- Establish licence and contribution policy.
- Configure CI.
- Create the Nextcloud app skeleton.
- Create the relay skeleton.
- Add initial documentation.
- Implement independent migration systems.

## Phase 2 — Native Nextcloud integration

Implement:

- App registration.
- File actions.
- Editor routing.
- Authentication.
- File loading.
- Basic DOCX editing.
- Safe file saving.
- Permission checks.

## Phase 3 — Collaboration relay

Implement:

- Relay.
- Authentication.
- Room lifecycle.
- Initial seeding.
- Durable persistence.
- Checkpointing.
- Two-user collaboration.
- Presence.

## Phase 4 — All three editors

Implement:

- DOCX collaboration and saving.
- XLSX collaboration and saving.
- PPTX collaboration and saving.
- Font configuration.
- Format-specific recovery tests.

## Phase 5 — Reliability

Implement:

- Save coordination.
- Fencing tokens.
- Autosave.
- Conflict recovery.
- Reconnection.
- Durable room persistence.
- Version-history verification.

## Phase 6 — Production hardening

Implement:

- Security audit.
- Performance tests.
- Backup and restore.
- Monitoring.
- Upgrade and rollback.
- Compatibility testing.
- App Store validation.

## Phase 7 — Collabora retirement

Only after all acceptance tests pass and the owner explicitly approves:

1. Disable Collabora.
2. Disable Nextcloud Office (`richdocuments`) if no other application requires it.
3. Verify existing files open in BetterOffice.
4. Verify desktop and mobile access.
5. Retain the ability to restore Collabora during the rollback window.

Do not uninstall Collabora before the rollback window has expired.

## Phase 8 — Nextcloud App Store publication

The final product must be submitted to the official Nextcloud App Store.

Prepare:

- Valid app metadata.
- Correct app versioning.
- Supported Nextcloud version declarations.
- App Store-compatible release archive.
- Required signing and integrity metadata.
- Screenshots.
- App description.
- Feature list.
- Installation instructions.
- Configuration instructions.
- Upgrade instructions.
- Compatibility information.
- Licence information.
- Source repository link.
- Support and issue-reporting links.
- Privacy and security documentation.
- Release notes.

Run the official validation and linting tools applicable to the target Nextcloud release.

Verify that:

- The packaged app installs cleanly.
- It upgrades cleanly.
- It does not require development dependencies.
- All required assets are included.
- No secrets are included.
- No unsupported private Nextcloud APIs are used.
- The app works with every declared supported Nextcloud version.

Submit the app for review and address reviewer feedback.

Do not claim that the app is available in the Store until the listing is approved and publicly accessible.

The relay must also have a documented installation and upgrade procedure. Its source code and releases must be available from the public GitHub repository.

# 18. Acceptance criteria

The project is complete only when all of the following are true:

- [ ] Public Touchflows GitHub repository exists.
- [ ] Source code and licence are published.
- [ ] CI and automated tests pass.
- [ ] Native Nextcloud app installs cleanly.
- [ ] No Nextcloud core modifications.
- [ ] No Collabora runtime dependency.
- [ ] DOCX editing works.
- [ ] XLSX editing works.
- [ ] PPTX editing works.
- [ ] All three formats support mandatory collaboration.
- [ ] Multiple users can edit simultaneously.
- [ ] Room state persists across relay restarts.
- [ ] Collaboration authentication is enforced.
- [ ] Read-only permissions are enforced.
- [ ] Autosave works.
- [ ] Save coordination and handover work.
- [ ] ETag conflicts are detected.
- [ ] Conflict recovery works.
- [ ] Nextcloud version history works.
- [ ] File permissions are respected.
- [ ] Existing documents remain intact.
- [ ] Installation and upgrade procedures are documented.
- [ ] Backup and restore have been tested.
- [ ] Rollback has been tested.
- [ ] Nextcloud App Store validation passes.
- [ ] App Store submission is accepted.
- [ ] Public App Store listing is available.

# 19. Agent operating instructions

Work incrementally.

Do not implement the entire application in one pass.

For every phase:

1. Inspect the relevant official APIs.
2. Implement the smallest working component.
3. Write tests.
4. Run tests.
5. Report actual results.
6. Document unresolved issues.
7. Wait for approval before destructive deployment operations.

Do not:

- Disable Collabora.
- Remove `richdocuments`.
- Modify production Nginx.
- Change production database schemas.
- Install services on the production server.
- Replace existing documents.
- Publish an untested production release.
- Claim App Store approval before it is granted.

These operations require explicit deployment approval.

Keep implementation in a separate development branch.

Maintain a clear distinction between:

- Implemented.
- Tested.
- Released.
- Submitted.
- Approved.
- Published.

Do not report a feature as complete merely because its code exists.

Deliver:

- Complete source code.
- Database migrations.
- Unit and integration tests.
- Relay source code.
- systemd service definition.
- Nginx configuration.
- Installation documentation.
- Upgrade documentation.
- Backup and recovery documentation.
- Security and compatibility report.
- App Store submission materials.
- Public GitHub releases.
- Public Nextcloud App Store listing.

**Final priority: document integrity and reliable collaboration take precedence over UI polish and implementation speed.**