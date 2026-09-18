# Releasing — M365 Calendar MCP

## Authority and current status

Source publication and CI workflow changes do **not** authorize a release tag, registry publication or deployment. Package `0.1.0` is private and is not a release announcement. No root code license has been assigned: owner licensing/attribution review remains a distribution gate. Do not create or push a tag without explicit owner approval covering the exact version and commit.

Build once and promote the same immutable image digest: confidential account and optional Supabase pins are now mandatory dedicated trusted-operator settings, not deployment-specific source edits. Review and privately provision the exact pins/policy under the intended Doppler scope before deploying. Missing or invalid inputs fail closed. No image publication automatically replaces the installed sibling or authorizes live reads, consent or rollout. See M365_RUNTIME.md and M365_SUPABASE.md.

## Implemented automation

- `.github/workflows/ci.yml`: branch pushes and pull requests on GitHub-hosted `ubuntu-24.04`; Node 24.21.0, lockfile install, release-guard regressions, source tests, typecheck, build, smoke, compiled tests and credential-free `linux/amd64` Docker build. No publication, provider calls or deployment credentials.
- `.github/workflows/release.yml`: **only pushed tags** matching the coarse `v[0-9]*.[0-9]*.[0-9]*` filter. A separate read-only job rejects anything except strict `vMAJOR.MINOR.PATCH` (no leading zeroes, prerelease or metadata), checks `package.json` equality, full commit identity, source repository and ancestry on `origin/main`. There is no manual-dispatch, PR, branch or workflow-run publication path.
- The publication job alone gets `packages: write`; jobs otherwise have `contents: read` and all unspecified permissions are disabled. Checkout never persists credentials. Only the job-scoped `GITHUB_TOKEN` is used for GHCR. No PAT, OIDC grant, Doppler, M365, Google, SSH/deployment-host secret or self-hosted runner is needed.
- Build once from the tagged source into an OCI archive using the existing allowlisted Dockerfile, which runs the complete synthetic suite. Buildx/BuildKit, base image and SBOM generator are pinned; all external actions use full upstream commit SHAs with version comments. Trivy action and binary versions are explicit. Hosted Ubuntu/Skopeo apt packages and vulnerability databases remain maintained external inputs, not bit-reproducible pinned snapshots.
- Scan the extracted OCI layout **before any registry write**, then use Skopeo `copy --all --preserve-digests` to publish that archive, including BuildKit `mode=max` provenance and SPDX SBOM attestations. No rebuild between scan and publication. These are attached build attestations, not a claim of separately signed/keyless GitHub attestations.
- Destination is `ghcr.io/hshanks21/m365-calendar-mcp:vMAJOR.MINOR.PATCH` and `ghcr.io/hshanks21/m365-calendar-mcp:sha-<full-40-character-Git-SHA>`. **No `latest`, branch, major or minor alias.** The workflow reads both tags back and requires the exact BuildKit index digest before reporting success in its job summary.

## Scan policy and base-image remediation

Trivy blocks **fixable HIGH/CRITICAL OS and library vulnerabilities**. “Fixable” means the current scanner database supplies a fixed version; unfixed and lower-severity issues remain visible in the all-severity report and require operator triage. Scanner/DB/network failure also blocks publication. There are no ignore entries or `continue-on-error` bypasses. This pragmatic threshold is not a promise of no vulnerabilities; new database findings can block previously passing source.

Local verification on 2026-09-17 reproduced the original six fixable HIGH findings; a refreshed database added PCRE2 CVE-2026-89157, making **seven** baseline gate findings. They were Debian `libpcre2-8-0` 10.42-1 and `brace-expansion` 5.0.7, `ip-address` 10.2.0 and `tar` 7.5.19 under `/usr/local/lib/node_modules/npm`, not application dependencies.

The subsequent supported Debian comparison selected `node:24.21.0-trixie-slim@sha256:db3ae80f5d8df06e04dabdf7b44cbf008d32de168205fa0294444aabbc08c590`. The exact-version tag was checked against the registry and the [official-image list](https://github.com/docker-library/official-images/blob/master/library/node); the [Node release feed](https://nodejs.org/dist/index.json) still reported 24.21.0 as the newest Node 24 patch. The moving `24-trixie-slim` index had a different digest (extra architecture), despite the same linux/amd64 manifest; do not substitute its digest for the verified exact-version tag.

The unpatched Trixie runtime failed the unchanged gate with **10 HIGH and 3 CRITICAL** fixable findings. The shared base therefore installs only the corresponding supported Trixie security updates: `gzip=1.13-1+deb13u1`, `libpcre2-8-0=10.46-1~deb13u2`, `libsqlite3-0=3.46.1-7+deb13u2`, and `perl-base=5.40.1-6+deb13u1`. Versions were verified with fresh apt metadata and the [Debian tracker](https://security-tracker.debian.org/tracker/data/json); no mixed-distribution repository is used. These apt pins need review when superseded; package availability remains a network input. The final runtime still removes npm/npx because its entrypoint and healthcheck use Node directly. Build-stage npm, PCRE2 and all lockfile production dependencies remain; no application dependency changed.

Both OCI runtimes were scanned with Trivy **0.74.0** and the same freshly downloaded DB (updated `2026-09-18T01:11:25Z`), frozen between scans. Counts below are **package/advisory occurrences**, not distinct vulnerabilities:

| Runtime | UNKNOWN | LOW | MEDIUM | HIGH | CRITICAL | Fixable HIGH/CRITICAL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Patched Bookworm baseline | 4 | 72 | 90 | 52 | 4 | 0 |
| Patched Trixie candidate | 3 | 56 | 51 | 43 | 0 | 0 |

Deduplicated by advisory ID, Bookworm has **100** findings (3 UNKNOWN, 38 LOW, 41 MEDIUM, 14 HIGH, 4 CRITICAL); Trixie has **67** (2 UNKNOWN, 30 LOW, 27 MEDIUM, 8 HIGH, 0 CRITICAL). The refreshed baseline UNKNOWN count differs from the earlier scan. Trixie still has four fixable MEDIUM occurrences: CVE-2026-5450 and CVE-2026-5928 in both `libc6` and `libc-bin`, fixed upstream in `2.41-12+deb13u4`; these are reported, not suppressed. This change targets the HIGH/CRITICAL release gate, not a full distro upgrade or a vulnerability-free image.

Of the remaining 43 HIGH occurrences, 36 are four util-linux IDs repeated across nine binary packages; the others cover systemd-homed (two packages), ncurses (three), libacl and Perl Archive::Tar. Nonroot execution, dropped capabilities, no-new-privileges and a read-only root constrain privileged mount/cgroup/ACL exploit paths; the app does not intentionally invoke those helpers, systemd-homed, ncurses parsing or Perl archive extraction. These are applicability observations, **not proven non-exploitability** or reasons to ignore findings. Continue tracking vendor fixes and rescan before release.

Local source/compiled tests, typecheck, smoke, isolated nonroot/read-only runtime regressions and OCI SPDX SBOM/maximum provenance checks are separate from hosted CI and publication. Local Buildx was 0.31.1; the release workflow remains pinned to 0.33.0, with the same pinned BuildKit 0.28.0 and SBOM generator used locally. Rerun the current scanner database and hosted CI for the approved commit before any tag. No severity suppression, ignore entry, release-policy change or publication is implied by the passing local gate.

## Tag immutability and prerequisites

Before the first release, an owner must review repository Actions/GHCR permissions, package access/visibility and licensing, protect `main`, and configure release-tag rulesets restricting creation and preventing update/deletion. These settings are **not configured by the workflow**. A public source repository does not by itself establish package visibility or publishing rights.

The workflow serializes releases and rejects either existing image tag; only an explicit registry 404 counts as unused. Auth, rate-limit and server errors fail closed. It checks again just before publishing. GHCR tags are technically mutable: these checks prevent this workflow's overwrite/retry, but are not an atomic registry lock against other authorized writers. Restrict all other package writers and always deploy by digest. Never claim server-enforced immutability from tag naming alone.

Publishing two tags is not transactional. If a copy or readback fails after the first tag exists, a rerun deliberately refuses to overwrite. Inspect the existing digest/attestations and obtain owner approval for recovery; never delete/recycle a version to make a job green. Retain job logs/digest metadata for the approved retention period.

## Approved release procedure

1. Gather exact local/remote state (`git status --short`, branch, HEAD, remote branches/tags) and independently review the intended commit on protected `main`. No feature-branch merge is implied by this document.
2. Resolve licensing, private deployment-configuration compatibility and the vulnerability blocker. Run [TESTING.md](TESTING.md), release-guard tests and workflow lint; inspect remote CI for the exact commit. Local checks do not establish GitHub Actions success.
3. Choose the semantic version and align `package.json`, lockfile and MCP advertised version. Record a factual changelog and compatibility/rollback impact. Never move/reuse published versions.
4. Present exact commit, version, GHCR target, synthetic/live status and evidence. **Wait for explicit tag/push approval.** Creating this workflow or saying “continue” on its implementation is not that approval.
5. Only after approval, create one annotated tag on the reviewed commit and push that specific tag, not all tags. Verify its remote tag object and peeled commit. Monitor the actual release run and both GHCR tag digests; record the immutable image reference and provenance/SBOM presence.
6. Publication ends here. No workflow changes the running service. A GitHub Release object is not automatically created.

## Separately approved rollout and rollback

Use the existing host operator under separately authorized maintenance; host-specific deployment tooling and credentials were intentionally not imported. Do not invent a new host command or run this checkout's Compose over occupied ports. Follow [Docker runbook](deploy/DOCKER_RUNBOOK.md) and [deployment standard](deploy/MCP_DEPLOYMENT_STANDARD.md).

Before replacement, retain the actual running image digest/ID and its reviewed manifest privately. Stage the **published digest**, review exact deployment pins/configuration/schema, preserve protected data/TLS mounts and credential scope, and perform approved allowed/denied provider acceptance. Activate only after owner approval, then read back bindings, runtime controls, health and authenticated endpoints. Roll back with the retained digest and compatible configuration, not a tag pointer; reverify without downgrading auth or silently replacing policy/secrets. Viewer sessions vanish on restart. Registry publication is not automated CD or live acceptance.
