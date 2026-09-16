# Source and CI handoff

## Current state

Executable source was committed/pushed as `b46a4a2` on `feat/import-calendar-implementation`. This follow-up adds branch/PR CI and strict tag-only GHCR publication; the exact staged follow-up requires independent review before the authorized feature-branch commit/push. No tag, merge, registry publication or deployment is authorized by this handoff.

The installed sibling and running Docker service remain untouched: no credentials, private configuration, provider requests, restart or bind-mount changes. GitHub-hosted jobs need only the standard `GITHUB_TOKEN`, with package writes confined to release publication. No host credentials or self-hosted runner are introduced.

## Preserved boundaries

- Confidential account and optional Supabase project pins remain reserved `example.invalid` values. New images are deployment templates, **not replacements for the working installation** until reviewed exact-pin adaptation and separately approved staging/activation.
- Bootstrap cwd/Doppler scope stays pinned to the executable checkout with no environment/CLI scope override; the installed sibling retains its own code/scope.
- Host-specific rollout, personal agenda reads and private deployment helpers remain excluded. Approved rollout/rollback uses the existing host operator and immutable digest, not CI access to the deployment host.
- Protected `AGENTS.md` is unchanged and retains stale docs-only instructions; README/SETUP/TESTING describe the executable checkout. Do not bypass its protection.

## Follow-up verification and remaining gates

Local source and compiled suites each pass 138 tests; smoke passes 10; typecheck/build and the credential-free Docker build pass. Four new release-guard regression tests pass, covering strict version/event/repository identity, immutable-tag fail-closed checks and digest readback. Actionlint 1.7.12 passes both workflows. Full action SHAs were resolved from upstream Git tags, including the peeled annotated Trivy-action tag; BuildKit and SBOM generator digests were read from their registries.

The local OCI archive includes provenance and SPDX SBOM. An isolated Skopeo copy with `--all --preserve-digests` retained the exact OCI index digest and both attestations (local copy only, not authenticated GHCR publication). **Trivy 0.74.0 correctly exits 1 on six fixable HIGH base-image/bundled-npm findings.** Current release publication is intentionally blocked, not verified green. See [RELEASING.md](RELEASING.md) for findings, policy and remediation gate. No threshold bypass or unreviewed base-image change was made.

Still required: independent exact staged-tree review, then feature-branch commit/push and remote CI readback. GitHub execution and authenticated GHCR publication are not established by local tests. Before any separately authorized release: remediate scan findings, review licensing, configure owner-controlled tag/main protections and GHCR access, approve the exact version/commit, then push only that tag. Before deployment: reviewed placeholder-pin adaptation, compatible private config and explicit host activation approval. Full accessibility and OS credential isolation remain separate assessments.
