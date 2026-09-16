# Changelog

## Unreleased

- Consolidated the previously separate implementation, pinned dependencies, source/compiled test inputs, plain dashboard and all self-hosted font notices/provenance into this executable repository.
- Preserved and reconciled the existing uncommitted project documentation; documented explicit Microsoft modes, Google read-only adapter, optional HTTPS and separate deployment/source boundaries.
- Added credential-free multi-stage Docker packaging and an allowlisted build context. Private deployment helpers, live logs, policies, caches, telemetry, TLS keys, generated output and personal event scripts are excluded.
- Replaced private account/project metadata with exact-match reserved invalid pins; deployment-specific adaptation remains reviewed, not an authorization bypass.
- Pinned bootstrap cwd/Doppler scope to the executable checkout rather than a hardcoded host path, after fresh-path fixture failures. There is no environment/CLI override; the installed sibling and its existing scope remain unchanged.
- Corrected source-versus-compiled asset and worker paths in synthetic tests; both suites now run from a clean export. Upstream font notice bytes are preserved explicitly via Git attributes.
- Protected `AGENTS.md` was preserved when its refresh was denied; README/HANDOFF identify its stale docs-only wording.

No release tag, registry publication, CI workflow, deployment or credential change is recorded here. Package `0.1.0` is not a release assertion; see [RELEASING.md](RELEASING.md).
