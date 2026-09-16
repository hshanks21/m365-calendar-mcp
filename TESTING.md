# Testing and reproducibility

## Fresh checkout, synthetic only

Node >=24, npm and OpenSSL are required. No credentials, populated policy, local-config, existing build output or live provider access are needed:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run smoke
node --test dist/test/*.test.js
docker build -f deploy/Dockerfile -t calendar-mcp:review .
git diff --check
```

Tests exercise real loopback HTTP/HTTPS and official MCP/MSAL transports against synthetic upstreams, never live calendar data. Coverage includes strict config/mode/cache validation, scoped caller/tool inventory, identity/scope and callback diagnostics, pagination/deadlines/body cleanup, disconnect capacity, private projection, complete-only availability/search, Google timezone/bounds, independent provider telemetry, viewer auth/Host/Origin/TLS, and font hash/license/MIME checks. `smoke` runs Microsoft MCP, Google MCP and confidential-runtime integration suites. Source and compiled tests should both pass.

The private child-runner and bootstrap cwd/scope are derived from the executable checkout so tests run from arbitrary fresh paths. They remain exact and cannot be overridden through environment or CLI; using a new checkout for real bootstrap needs separate scoped secret-manager authorization. Synthetic TLS certificates are generated temporarily, not committed.

## Optional browser check

```sh
npm install --prefix /tmp/calendar-dashboard-browser-tools --no-audit --no-fund playwright@1.55.1
/tmp/calendar-dashboard-browser-tools/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/calendar-dashboard-browser-tools/node_modules/playwright/index.mjs node scripts/verify-browser.mjs
```

The verifier starts ephemeral synthetic loopback services, checks login/logout, periods, paging, refresh, provider states, mobile overflow and local font loading, then closes listeners. Screenshots/evidence are ignored private artifacts, never publication inputs. No external requests/page errors should occur. This is not a live-dashboard verification or full accessibility audit.

## Evidence and separate gates

[VALIDATION.md](VALIDATION.md) records import verification scope. Historical source build reports/live logs are deliberately not copied or promoted to fresh evidence. Secret scans must target the exact staged export, with findings redacted. Check the image build context and runtime assets; never pass live credentials as build arguments.

Independent review is required before commit/push. Live discovery, credentials, app permissions, allowed/denied provider reads, policy selection, host custody, deployment, restart, remote browser reachability and release tags each remain separately authorized. Synthetic tests do not establish those facts.
