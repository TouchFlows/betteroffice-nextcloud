# Nextcloud App Store submission

Not applicable yet — this is Phase 8 (PLAN.md §17), gated behind Phases
2–7 (a working, tested, hardened app) and explicit owner approval. Recorded
here now only to track what will be needed, per §8:

## Checklist (none of this is done)

- [ ] Valid app metadata (`app/appinfo/info.xml` exists and currently
      validates against the App Store schema — re-validate before every
      submission: `xmllint --noout --schema <(curl -s https://apps.nextcloud.com/schema/apps/info.xsd) app/appinfo/info.xml`)
- [ ] Correct app versioning (independent from the relay's — §2.1)
- [ ] Supported Nextcloud version declarations tested, not just declared
      (`docs/compatibility.md`)
- [ ] App Store-compatible release archive, built reproducibly, with
      `vendor/` and `js/` bundled (neither is committed to this repo — see
      `.gitignore` — both must exist in the release artifact)
- [ ] Signing/integrity metadata
- [ ] Screenshots, description, feature list
- [ ] Installation/configuration/upgrade instructions (this repo's
      `docs/installation.md` and `docs/configuration.md`, once they have
      real content)
- [ ] Compatibility information
- [ ] Licence information (Apache-2.0 — already correct in `info.xml` and
      confirmed valid against the current schema's `<licence>` enum)
- [ ] Source repository link (already in `info.xml`'s `<repository>`)
- [ ] Support/issue-reporting links (`<bugs>`, already set)
- [ ] Privacy and security documentation (`docs/security.md`, once it
      reflects a real deployment rather than "most of this is unbuilt")
- [ ] Release notes
- [ ] Official validation/linting tools run clean for the target Nextcloud
      release
- [ ] Packaged app installs and upgrades cleanly, with no dev dependencies,
      no secrets, no unsupported private Nextcloud APIs

Do not claim App Store availability until the listing is approved and
publicly accessible (§17 Phase 8, final line).

The relay also needs its own documented installation/upgrade procedure and
public source/releases (already public, via this same repository) before
this phase is "done" — see `relay/README.md`.
