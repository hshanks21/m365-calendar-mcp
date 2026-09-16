# Import handoff

## Current state

This repository now contains the executable implementation, lockfile, synthetic tests, frontend/font licenses and credential-free Docker packaging. Existing uncommitted documentation was preserved in review backups and deliberately reconciled, not reset. Independent review precedes commit/push on `feat/import-calendar-implementation`.

The installed sibling and running Docker service remain untouched: no credential reads/provisioning, provider calls, restart, bind-mount move, deployment, release tag or CI workflow is part of this import.

## Review-sensitive differences

- Confidential account and optional Supabase project pins are reserved `example.invalid` values, preserving exact-match validation without publishing personal metadata. New confidential installations require reviewed adaptation.
- Bootstrap cwd/Doppler scope now derives from the executable checkout (source and compiled), not one absolute host path. Fresh-path tests exposed the old assumption. Fixed project/config/official API, clean child environment and no environment/CLI scope override remain. The installed sibling retains its existing code/scope.
- Host-specific agenda/rollout/audit/restart helpers and historical live reports were excluded. Portable Docker build and dashboard-only review Compose are supplied; any provider/TLS overlay and live cutover require approval.
- Protected AGENTS update was denied; the pre-existing owner-provided file is untouched by import and still has stale docs-only commands. README/SETUP/TESTING are current. Do not bypass protected-file permission.

## Remaining gates

Independent exact staged-tree secret/scope/code review, then conventional commit and feature-branch push with remote readback. Do not force-push main. Source publication is authorized, but tag/release/CI/deployment and assigning a root code license are not. Font OFLs/provenance are retained. Full accessibility and OS credential isolation remain separate assessments.

Fresh-checkout verification passed: 138 source/138 compiled tests, 10 smoke tests, typecheck/build/install, Docker build plus isolated runtime, Chromium fixture check and offline Gitleaks with no findings. Details are in [VALIDATION.md](VALIDATION.md). Raw synthetic outputs and the sanitized import manifest stay outside the repository; no live evidence or calendar data is published.
