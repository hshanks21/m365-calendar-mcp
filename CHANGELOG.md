# Changelog

## Unreleased

- Replaced sanitized compiled account/project pins with mandatory trusted-operator deployment configuration (`CALENDAR_M365_DELEGATED_EXPECTED_USERNAME`, bootstrap-only `CALENDAR_SUPABASE_ALLOWED_ORIGIN`). Exact identity/cache/policy/origin validation and narrow fixed endpoints remain fail-closed. Images no longer require account-specific source edits; private provisioning, review and live activation remain separate gates.

- Added GitHub-hosted branch/PR checks and strict tag-only GHCR image publication with pinned actions, pre-publication vulnerability gating, provenance/SBOM, no tag reuse and digest readback. Deployment remains separately approved; current base-image findings block release.

- Consolidated the previously separate implementation, pinned dependencies, source/compiled test inputs, plain dashboard and all self-hosted font notices/provenance into this executable repository.
- Preserved and reconciled the existing uncommitted project documentation; documented explicit Microsoft modes, Google read-only adapter, optional HTTPS and separate deployment/source boundaries.
- Added credential-free multi-stage Docker packaging and an allowlisted build context. Private deployment helpers, live logs, policies, caches, telemetry, TLS keys, generated output and personal event scripts are excluded.
- Replaced private account/project metadata with exact-match reserved invalid pins; deployment-specific adaptation remains reviewed, not an authorization bypass.
- Pinned bootstrap cwd/Doppler scope to the executable checkout rather than a hardcoded host path, after fresh-path fixture failures. There is no environment/CLI override; the installed sibling and its existing scope remain unchanged.
- Corrected source-versus-compiled asset and worker paths in synthetic tests; both suites now run from a clean export. Upstream font notice bytes are preserved explicitly via Git attributes.
- Protected `AGENTS.md` was preserved when its refresh was denied; README/HANDOFF identify its stale docs-only wording.

No release tag, registry publication, deployment or credential change is recorded here. Package `0.1.0` is not a release assertion; see [RELEASING.md](RELEASING.md).
