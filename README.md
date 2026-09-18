# M365 Calendar MCP

Read-only Microsoft 365 and Google calendar tools for independently scoped native MCP clients, with a separately authenticated operations dashboard. Tool callers receive narrow calendar projections; the dashboard receives sanitized usage counts, never meetings or credentials.

## Repository and installation boundary

**This is now the authoritative executable source repository**, including the pinned package/lockfile, TypeScript modules, synthetic tests, frontend/font licenses and Docker build. It is no longer documentation-only. The existing installation in `../mcp-server-calendar` is a separate deployment: importing or pushing this checkout does not restart it, move its bind mounts, migrate Doppler scope, or publish a release.

`AGENTS.md` contains owner-provided working instructions, but its old docs-only wording is stale. The protected-file update was denied during import; it was preserved, not bypassed. Follow the current checkout commands here while retaining its review/security boundaries.

## Reproduce without credentials

Node **24 or later**, npm and OpenSSL (synthetic TLS fixtures):

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run smoke
node --test dist/test/*.test.js
# Runs synthetic checks inside the image build; no local-config required:
docker build -f deploy/Dockerfile -t calendar-mcp:review .
```

No production credentials or provider access are needed for these checks. See [TESTING.md](TESTING.md). Runtime startup requires privately provisioned configuration; `.env.example` lists names only and is not automatically loaded. See [SETUP.md](SETUP.md).

## Tools and modes

| Tool | Purpose |
|---|---|
| `list_calendars` | Caller-allowed aliases, not discovery of arbitrary calendars |
| `list_events` | Bounded recurring-expanded read and private-safe projection |
| `search_events` | Non-private subject-only literal search; complete fetch required |
| `get_work_availability` | Free UTC intervals in one explicit calendar/window; complete fetch required |
| `connection_status` | Configuration status, never a live readiness probe |

No create/update/delete, mail, arbitrary Graph/Google proxy or discovery MCP tool. Incomplete results must never be interpreted as an empty/free schedule. Google writes cannot be enabled by configuration.

Runtime supports explicit Microsoft app-only or delegated-confidential mode, Google-only, combined, and dashboard-only. MCP stays at `http://127.0.0.1:3217/mcp`; dashboard defaults to exact `http://127.0.0.1:3218/` with optional reviewed private-IPv4 HTTPS.

**Deployment portability:** one immutable image accepts mandatory trusted-operator identity pins through dedicated Doppler injection. `CALENDAR_M365_DELEGATED_EXPECTED_USERNAME` and (bootstrap only) `CALENDAR_SUPABASE_ALLOWED_ORIGIN` replace source-specific pins; no defaults, caller-selected identities, broad credential fallback or arbitrary endpoints. Private configuration approval, offline validation and separately authorized live acceptance are still required. Operator bootstrap cwd/scope is pinned to the executable checkout, never an environment override; the installed sibling retains its own existing scope. See [M365_RUNTIME.md](M365_RUNTIME.md).

## Documentation

- [AGENTS.md](AGENTS.md), [HANDOFF.md](HANDOFF.md), [PLAN.md](PLAN.md), [ROADMAP.md](ROADMAP.md): workflow, current gates and continuity.
- [ARCHITECTURE.md](ARCHITECTURE.md), [SCHEMA.md](SCHEMA.md), [SECURITY.md](SECURITY.md): modules, contracts and trust boundaries.
- [SETUP.md](SETUP.md), [M365_RUNTIME.md](M365_RUNTIME.md), [GOOGLE_CONNECTOR.md](GOOGLE_CONNECTOR.md): configuration and provider semantics.
- [M365_CONFIDENTIAL.md](M365_CONFIDENTIAL.md), [M365_DELEGATED.md](M365_DELEGATED.md), [M365_SUPABASE.md](M365_SUPABASE.md): gated operator bootstrap guides.
- [DESIGN.md](DESIGN.md), [TESTING.md](TESTING.md), [VALIDATION.md](VALIDATION.md): UI and reproducibility.
- [Docker runbook](deploy/DOCKER_RUNBOOK.md), [deployment/release standard](deploy/MCP_DEPLOYMENT_STANDARD.md), [RELEASING.md](RELEASING.md): build versus deployment/release authority. PR/branch CI and guarded tag-only GHCR publication are implemented; deployment remains manual and separately approved. The release vulnerability scan currently blocks the unchanged base image; see RELEASING.
- [CHANGELOG.md](CHANGELOG.md), [IDEAS.md](IDEAS.md), [TEMPLATE-README.md](TEMPLATE-README.md): history, proposals and scaffold provenance.

## Attribution and licensing

The package remains private at `0.1.0`; this is not a release announcement. No root code license was supplied, and none is invented here. Owner licensing review remains a release/distribution gate. Cormorant Garamond, Space Grotesk and Rubik are self-hosted with their original SIL OFL notices and pinned source/checksums in `public/fonts/provenance.json`.
