# Releasing — M365 Calendar MCP

## Authority and current status

Source publication and CI workflow changes do **not** authorize a release tag, registry publication or deployment. Package `0.1.0` is private and is not a release announcement. No root code license has been assigned: owner licensing/attribution review remains a distribution gate. Do not create or push a tag without explicit owner approval covering the exact version and commit.

The imported confidential-account and optional Supabase pins remain deliberately unusable `example.invalid` values. These images are **deployment templates, not a drop-in replacement for the working installation**. Review deployment-specific exact pins before deploying; never weaken validation or automatically replace the installed sibling with this build.

## Implemented automation

- `.github/workflows/ci.yml`: branch pushes and pull requests on GitHub-hosted `ubuntu-24.04`; Node 24.21.0, lockfile install, release-guard regressions, source tests, typecheck, build, smoke, compiled tests and credential-free `linux/amd64` Docker build. No publication, provider calls or deployment credentials.
- `.github/workflows/release.yml`: **only pushed tags** matching the coarse `v[0-9]*.[0-9]*.[0-9]*` filter. A separate read-only job rejects anything except strict `vMAJOR.MINOR.PATCH` (no leading zeroes, prerelease or metadata), checks `package.json` equality, full commit identity, source repository and ancestry on `origin/main`. There is no manual-dispatch, PR, branch or workflow-run publication path.
- The publication job alone gets `packages: write`; jobs otherwise have `contents: read` and all unspecified permissions are disabled. Checkout never persists credentials. Only the job-scoped `GITHUB_TOKEN` is used for GHCR. No PAT, OIDC grant, Doppler, M365, Google, SSH/deployment-host secret or self-hosted runner is needed.
- Build once from the tagged source into an OCI archive using the existing allowlisted Dockerfile, which runs the complete synthetic suite. Buildx/BuildKit, base image and SBOM generator are pinned; all external actions use full upstream commit SHAs with version comments. Trivy action and binary versions are explicit. Hosted Ubuntu/Skopeo apt packages and vulnerability databases remain maintained external inputs, not bit-reproducible pinned snapshots.
- Scan the extracted OCI layout **before any registry write**, then use Skopeo `copy --all --preserve-digests` to publish that archive, including BuildKit `mode=max` provenance and SPDX SBOM attestations. No rebuild between scan and publication. These are attached build attestations, not a claim of separately signed/keyless GitHub attestations.
- Destination is `ghcr.io/hshanks21/m365-calendar-mcp:vMAJOR.MINOR.PATCH` and `ghcr.io/hshanks21/m365-calendar-mcp:sha-<full-40-character-Git-SHA>`. **No `latest`, branch, major or minor alias.** The workflow reads both tags back and requires the exact BuildKit index digest before reporting success in its job summary.

## Scan policy and known release blocker

Trivy blocks **fixable HIGH/CRITICAL OS and library vulnerabilities**. “Fixable” means the current scanner database supplies a fixed version; unfixed and lower-severity issues remain visible in the all-severity report and require operator triage. Scanner/DB/network failure also blocks publication. There are no ignore entries or `continue-on-error` bypasses. This pragmatic threshold is not a promise of no vulnerabilities; new database findings can block previously passing source.

Local verification of the unchanged pinned image found six fixable HIGH findings: `libpcre2-8-0` (CVE-2026-86145, CVE-2026-89161), bundled npm's `brace-expansion` (CVE-2026-14257, CVE-2026-69152), `ip-address` (CVE-2026-69192) and `tar` (CVE-2026-73566). Thus the release pipeline currently **must stop before publication**. Review and update the base image/bundled dependencies and rerun the scan before approving a tag; do not relax the threshold to force a release. Application tests passing does not clear this gate.

## Tag immutability and prerequisites

Before the first release, an owner must review repository Actions/GHCR permissions, package access/visibility and licensing, protect `main`, and configure release-tag rulesets restricting creation and preventing update/deletion. These settings are **not configured by the workflow**. A public source repository does not by itself establish package visibility or publishing rights.

The workflow serializes releases and rejects either existing image tag; only an explicit registry 404 counts as unused. Auth, rate-limit and server errors fail closed. It checks again just before publishing. GHCR tags are technically mutable: these checks prevent this workflow's overwrite/retry, but are not an atomic registry lock against other authorized writers. Restrict all other package writers and always deploy by digest. Never claim server-enforced immutability from tag naming alone.

Publishing two tags is not transactional. If a copy or readback fails after the first tag exists, a rerun deliberately refuses to overwrite. Inspect the existing digest/attestations and obtain owner approval for recovery; never delete/recycle a version to make a job green. Retain job logs/digest metadata for the approved retention period.

## Approved release procedure

1. Gather exact local/remote state (`git status --short`, branch, HEAD, remote branches/tags) and independently review the intended commit on protected `main`. No feature-branch merge is implied by this document.
2. Resolve licensing, placeholder-pin/deployment compatibility and the vulnerability blocker. Run [TESTING.md](TESTING.md), release-guard tests and workflow lint; inspect remote CI for the exact commit. Local checks do not establish GitHub Actions success.
3. Choose the semantic version and align `package.json`, lockfile and MCP advertised version. Record a factual changelog and compatibility/rollback impact. Never move/reuse published versions.
4. Present exact commit, version, GHCR target, synthetic/live status and evidence. **Wait for explicit tag/push approval.** Creating this workflow or saying “continue” on its implementation is not that approval.
5. Only after approval, create one annotated tag on the reviewed commit and push that specific tag, not all tags. Verify its remote tag object and peeled commit. Monitor the actual release run and both GHCR tag digests; record the immutable image reference and provenance/SBOM presence.
6. Publication ends here. No workflow changes the running service. A GitHub Release object is not automatically created.

## Separately approved rollout and rollback

Use the existing host operator under separately authorized maintenance; host-specific deployment tooling and credentials were intentionally not imported. Do not invent a new host command or run this checkout's Compose over occupied ports. Follow [Docker runbook](deploy/DOCKER_RUNBOOK.md) and [deployment standard](deploy/MCP_DEPLOYMENT_STANDARD.md).

Before replacement, retain the actual running image digest/ID and its reviewed manifest privately. Stage the **published digest**, review exact deployment pins/configuration/schema, preserve protected data/TLS mounts and credential scope, and perform approved allowed/denied provider acceptance. Activate only after owner approval, then read back bindings, runtime controls, health and authenticated endpoints. Roll back with the retained digest and compatible configuration, not a tag pointer; reverify without downgrading auth or silently replacing policy/secrets. Viewer sessions vanish on restart. Registry publication is not automated CD or live acceptance.
