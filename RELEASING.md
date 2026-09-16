# Releasing — M365 Calendar MCP

## Current status

This checkout now contains executable source and reproducible synthetic verification. Import and branch publication do not authorize a release tag or deployment. A package version string is not a release or live acceptance record. No commit, tag, push or repository setting change is authorized by this document alone.

## Future release gate

1. Review the imported source and resolve licensing/attribution. Verify runtime assets, lockfile, tests and deployment packaging are actually in this repository; do not publish secrets, telemetry or private evidence.
2. Gather real local and remote state: `git status --short`, `git branch --show-current`, `git tag --list --sort=-version:refname`, `git log --oneline -5`, and the exact intended remote. Release from reviewed `main`, not detached HEAD. Do not infer remote green from local tests; no release workflow is implemented. Future automation must use approved strict `vMAJOR.MINOR.PATCH` tags, not branch pushes; see [deployment standard](deploy/MCP_DEPLOYMENT_STANDARD.md).
3. Run [TESTING.md](./TESTING.md) in the imported implementation, including compiled and browser checks. Document whether the release is local synthetic-only or separately administrator-accepted. Deployment success must have its own evidence.
4. Select semantic version `vMAJOR.MINOR.PATCH`: breaking contract/security/config changes require an explicit compatibility decision (pre-1.0 incompatible work uses a minor bump); additive compatible behavior is minor, fixes/docs are patch. Keep the private package and MCP advertised version aligned when source is present.
5. Add a dated, factual [CHANGELOG.md](./CHANGELOG.md) entry; summarize breaking changes and rollback/restart implications. Stage only reviewed files. Commit only with approval covering that action.
6. Present exact HEAD SHA, proposed version, test results, live/synthetic status, release contents and push target; **wait for explicit tag/push approval**. A question or vague reply is not approval.
7. After approval, create one annotated tag on reviewed HEAD, never reuse/move/overwrite tags. Push only the intended branch and specific new tag, not every local tag. Verify remote branch/tag object and peeled commit against intended HEAD before claiming publication.

## Rollback and operational cautions

A tag identifies source, not necessarily what is deployed. Installation and deployment are separate approval gates. Do not imply a pushed tag starts a service. Rollback must retain credential protection, match configuration/schema compatibility, preserve or deliberately archive bounded telemetry and restart to apply policy/secret changes. Viewer sessions intentionally vanish on restart. Never downgrade to broader auth or weaken incomplete-result semantics for rollback convenience.
