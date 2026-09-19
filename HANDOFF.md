# Runtime deployment configuration handoff

## Local 0.1.2 preparation (not published)

Package, root lockfile and advertised MCP versions are mechanically aligned to 0.1.2. The disconnect test fix below is the only behavioral delta from the immutable failed v0.1.1 tag, and affects tests only. Independent final-review evidence is retained at `/home/harvito/calendar-release-v0.1.2/final-review/`; consult its report for the exact reviewed tree and checks. Commit, push, tag, hosted publication and rollout remain separate gates. No production, credential, reader-installation or cron change is included.

## Disconnect regression diagnosis (before version preparation)

- Focused branch `fix/disconnect-test-synchronization` starts from unchanged `a4d50ebb4373828cba3f7a49b89bf1b6d12582c7` / `v0.1.1`. No version bump, commit, push, tag, publication or deployment is part of this fix.
- Hosted compiled `concurrency.test.js:123` asserts credential cancellation after a 10 ms sleep. Client fetch rejection is not a server-close acknowledgment. Delaying server close-event delivery by 40 ms reproduces the exact `false !== true` assertion at the same compiled line; awaiting the abort event fixes that schedule without changing runtime code or relaxing assertions.
- Deliberately releasing operation capacity before ignored-abort tokens settle makes the fixed test fail with `24 !== 16`; removing both disconnect signal inputs makes it fail with `TimeoutError !== AbortError`. Both generated-code mutants were restored.
- Verification: 40/40 targeted runs (20 source, 20 compiled; four processes sharing one CPU and delayed close events), complete source and compiled suites (144 each), smoke (10), typecheck, build, formatting and whitespace checks passed. A fresh no-cache Docker build passed the unchanged complete Dockerfile line-16 command on pinned Node 24.21.0; host tests used Node 24.19.0.
- Local evidence is `/home/harvito/calendar-release-v0.1.1/disconnect-fix/` (exact RED, mutation failures, stress logs/runner, Docker log and patch). Independent review and any future v0.1.2 release remain separate gates. The historical runner's precise scheduling is not observable from its assertion log; the reproduced scheduling defect is established, not an assertion that the host itself delayed exactly 40 ms.
- Installed services, credentials, reader installation and cron were not accessed or changed. Preserve the owner's v0.1.0 production / reader-uninstalled / cron-off state.

## Earlier configuration handoff (historical)

## Current state and authority

On `feat/import-calendar-implementation`, based on `553f603`, this follow-up removes the sanitized-source deployment blocker: one immutable image accepts mandatory trusted-operator account/project pins without private source edits. The exact staged tree needs independent review **before any commit/push**. No merge, tag, registry publication, new consent, provider request or live deployment is authorized or performed.

The installed sibling and running service remain untouched. No live credentials/settings were read or changed; all verification used synthetic inputs. Docker/base/libc, lockfile, Google implementation and provider grants are unchanged.

## Configuration change

- New required delegated key: `CALENDAR_M365_DELEGATED_EXPECTED_USERNAME`. Email syntax/max 254; validated before case normalization, no trim/default/fallback. Cache account, returned identity and exact lowercase `work.mailbox` must match it. Dedicated tenant/client/object/client-secret/cache keys retain their names and validation; issuer, audience, provider subject, home-account and scope checks remain.
- New required **Supabase-bootstrap-only** key: `CALENDAR_SUPABASE_ALLOWED_ORIGIN`. Exact HTTPS origin with a 20-lowercase-letter project ref under `.supabase.co`, no path/userinfo/port/query/fragment/custom domain. Existing `CALENDAR_SUPABASE_URL` must equal it byte-for-byte. The returned authorization URL is checked against this independent pin; network allows only the two fixed auth routes, never the suffix generally. The existing publishable key remains required; API overrides are refused.
- Expected pins are approved operator configuration, never agent request parameters. Complete selected runtime settings validate offline before listeners; bootstrap validates before authorization and retains explicit `--authorize`.
- Bootstrap's executable-derived cwd, fixed Doppler project/config/API host and `--no-read-env` are unchanged. Publishing source/images does not migrate installed Doppler scope.
- Exact minimal injection sets and saved-cache acceptance are in M365_RUNTIME.md; optional broker schema is in M365_SUPABASE.md. Compose remains a dashboard-only baseline; provider settings belong only in a reviewed private stdin overlay.

## Verification of this working tree

- Observed RED tests for missing username, invalid/unconfigured origin and mixed bootstrap identity settings; GREEN after implementation.
- Source suite: **143 passed**; compiled suite: **143 passed**; smoke: **10 passed**; typecheck/build and `git diff --check` passed.
- Credential-free Docker build and **4 isolated runtime regressions** passed, including a different synthetic tenant/client/object/username configured in the same image and missing/mismatched pin rejection. Tests use nonroot/read-only runtime with `--network none`, no published ports or live credentials.
- Local image: `sha256:e64fc90873f4e127ff0dd26cde4f690f05c43a6da6574b80012fa66f4b6a7877`. This is a local uncommitted-source build, not a published release digest.
- **4 release-guard tests** and Actionlint 1.7.12 passed. Trivy 0.74.0 scanned this actual local runtime image and passed the unchanged fixable HIGH/CRITICAL gate; this is not a vulnerability-free claim. No scan policy/base changes.
- Trivy secret scan of the exact staged export reported **0 findings**. Added-line static scan found no shell/eval/unsafe-deserialization additions; credential-shaped literals are explicitly synthetic test fixtures only. Production modules contain no former `example.invalid` or fixture UUID pins.
- Logs are private local build evidence under `/tmp/calendar-config-*`, not committed or live-provider evidence. Remote CI/publication and independent review are not established by these checks.

## Remaining gates

1. Independently review the exact staged tree; only the parent may commit/push after review and read back remote CI. No merge/tag authorization.
2. Privately provision the new expected username under the intended dedicated Doppler scope and verify compatibility of existing dedicated IDs/secret/cache/work policy. Only if optional Supabase bootstrap is later approved, provision its allowed origin as well. Do not copy real pins/secrets into source or rebuild per deployment.
3. With separate live-read authorization, reuse saved confidential credentials for offline validation and isolated authenticated allowed/denied work acceptance. Preserve Google configuration. No fresh login unless silent acquisition genuinely requires interaction and the owner separately approves reauthentication.
4. Before separately approved activation, retain the installed immutable image/config, review private overlay/TLS/data custody, then stage/promote the exact image and verify actual bindings/auth/provider behavior. Rollback is by retained digest plus compatible private configuration. Source completion is not live readiness.
5. Release licensing/protections/version approval and a fresh vulnerability scan remain separate release gates. OS credential isolation and remote client reachability remain separate assessments.
