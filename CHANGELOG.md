# Changelog

## 0.1.2 (prepared; not published)

- Synchronize the disconnect-capacity regression on the actual credential abort event with a bounded wait, rather than assuming server socket-close delivery within 10 ms. Preserve the AbortError reason, 16-operation limit, denial, deadline, no-late-upstream and recovery assertions; production cancellation and capacity handling are unchanged.
- Align package, root lockfile and advertised MCP versions to 0.1.2. No dependency, provider permission, caller policy or deployment-control changes.
- Carry forward the previously reviewed all-day handling and briefing reader from 0.1.1. Its failed release tag remains immutable and must not be reused. Publication still requires the hosted release gates; deployment and reader installation remain separately authorized. Production remains on 0.1.0 until an approved rollout, with its image retained for rollback.

## 0.1.1 (failed release; immutable tag)

- Preserve original Google all-day dates and recover Microsoft all-day dates only from verified original zones and exact midnight boundaries, including sub-millisecond precision checks.
- Add a bounded, read-only morning briefing reader with Eastern day/DST boundaries, explicit incomplete coverage, conflict classification and calendar-title sanitization.
- Keep provider permissions, caller policies and deployment controls unchanged. Deploy by a newly published immutable digest; retain the previous image for rollback. Reader installation is a separate reviewed-artifact operation.

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
