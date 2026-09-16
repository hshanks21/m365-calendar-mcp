# Import validation scope

The implementation was selected through an explicit file allowlist, not a directory copy. Required package/lockfile/tsconfig, TypeScript source and synthetic tests, UI/font assets/notices, browser verifier and reviewed build packaging are included. Populated env/policies, local-config, telemetry, private evidence/screenshots, TLS material, caches, dependencies/build output and personal operator helpers are excluded.

Existing project documentation was reconciled rather than overwritten by historical source reports. No historical live logs or provider acceptance claims were promoted to fresh verification. AGENTS refresh was blocked by protected-file permission and preserved; the README identifies its stale checkout wording.

Verification is credential-free: fresh staged export install/typecheck/source tests/build/smoke/compiled tests, Docker build and synthetic isolated runtime checks. Exact staged-tree Gitleaks scan and independent review are publication gates. Build/test success is not live-provider, tenant scope, remote browser or deployment evidence.

DESIGN tokens were reconciled with imported CSS. The real design CLI lint reported zero errors/warnings and export produced tokens.json. The package threat-intelligence check timed out; successful lint is not a supply-chain attestation.

No root license was supplied or invented. All three font families retain OFL/provenance. No new workflow, tag, credentials, service restart or repository settings were created.

## Fresh execution results

From a new index-only export (no inherited ignored state), `npm ci`, typecheck and build exited 0; **138 source tests, 138 compiled tests and 10 smoke tests passed**, with zero failures/skips. Docker independently rebuilt from the same exported source, including source/compiled suites and smoke. An isolated `--network none`, read-only/nonroot runtime container passed dashboard login/logout, unauthenticated rejection, private-path absence and byte/hash equality for **all 11 public assets**. No live provider credentials or host service mounts were supplied.

Real Chromium synthetic browser verification returned PASS, zero page errors/external browser requests, loaded expected local fonts and no page-width mobile overflow. Desktop/mobile screenshots were inspected; the narrow activity table uses its intended horizontal scroller. Evidence/screenshots remain outside Git.

Gitleaks **v8.24.3**, image digest `sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055`, ran offline/read-only against a separate pristine staged export with 100% redacted reporting: **exit 0, no leaks found**. No broad rule exclusions were added. An initial detector finding was an intentionally malformed synthetic legacy-key fixture; it was replaced with an obviously synthetic invalid string without changing rejection coverage. Generated dependencies/build output are not scan/publication inputs.

Fresh-path verification exposed a hardcoded bootstrap cwd, and compiled tests exposed source-only asset/worker paths. The focused failure was observed before corrections; both source and compiled suites now pass. Production bootstrap pins derive from executable location and remain exact, with no caller/environment scope override. Font upstream notices have original CRLF/trailing whitespace preserved byte-for-byte; `.gitattributes` exempts only those notices from whitespace normalization/checking. `git diff --cached --check` passes. Local Markdown targets resolve.

`npm ci` reported zero known vulnerabilities and an esbuild install-script approval warning; neither is a comprehensive supply-chain audit. Independent secret/scope/code review remains the gate before commit and feature-branch push. No release or live deployment is inferred from these results.
