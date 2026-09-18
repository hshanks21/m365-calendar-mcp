# Docker build and controlled deployment

## Source checkout is not the installed service

This repository builds without private `local-config`, `.env`, telemetry, TLS material or the old checkout. The existing installed Docker service and its sibling source/data mounts are untouched. **Do not run Compose here over the existing fixed ports.** A branch push is not a deployment, secret-manager migration or release.

Host-specific rollout, personal agenda reads, raw live reports and scripts that inspect private production metadata or restart the installed container were deliberately excluded. Continue using the installed operator only under separately authorized maintenance, not as part of this import. This portable runbook replaces historical deployment logs; it does not claim new live acceptance.

## Credential-free build

```sh
docker build -f deploy/Dockerfile -t calendar-mcp:review .
docker image inspect calendar-mcp:review --format '{{.Id}}'
CALENDAR_TEST_IMAGE=calendar-mcp:review node --test scripts/container-runtime.test.mjs
```

The pinned Node version/digest and npm lockfile are build inputs. The multi-stage build installs OpenSSL for temporary synthetic TLS fixtures, runs source tests/typecheck/build/smoke, prunes development dependencies and copies only runtime source, dependencies, public assets/font notices and healthcheck. `.dockerignore` allowlists build inputs. No build arguments, credentials, host source mounts, live reads or private config are needed.

The shared Trixie base installs pinned security updates for gzip, PCRE2, SQLite and Perl; the final runtime removes unused bundled npm/npx, while the build stage retains npm. Run application and helper entrypoints with `node dist/src/<entrypoint>.js` inside the runtime, not `npm run`. All application production dependencies and the existing healthcheck are retained. The runtime regression command above verifies the Trixie release and those security-update versions, absent npm/npx, dependency imports and dashboard-only 401 liveness as UID/GID 1000 with a read-only root, dropped capabilities, tmpfs and `--network none` (no published ports or provider credentials). It does not prove live-provider health.

For publication, scan the actual OCI runtime with the unchanged policy in [RELEASING.md](../RELEASING.md), not merely a base tag or a source dependency audit. The local remediation cleared fixable HIGH/CRITICAL findings; unfixed issues remain and future databases can block release again.

## Portable Compose baseline (not deployed)

`deploy/compose.yaml` is a **dashboard-only review baseline** with no restart policy. It requires an immutable `CALENDAR_IMAGE`, privately injected `CALENDAR_DASHBOARD_SECRET`, and a separate absolute `CALENDAR_DATA_DIR` owned by UID 1000 with mode 0700. It has no default usable credentials and creates no host directory. Linux host networking preserves exact loopback validation but shares the host network namespace; do not publish ports or mount a Docker socket.

The container runs nonroot 1000:1000, read-only root, dropped capabilities/no-new-privileges, bounded tmpfs/PIDs/memory/CPU/logs, init and graceful stop. Only telemetry is writable. Its baseline healthcheck checks unauthenticated dashboard 401, not providers, and does not poll calendars or generate tool activity.

Only after installation approval and private complete-config validation should an operator add a reviewed **stdin-only Compose overlay** for explicitly selected provider variables and, if approved, exact private-IP TLS files/bind. Escape literal dollar signs in JSON/Compose values. Do not dump `docker compose config`, `docker inspect` environments, or save populated overlays/.env. The bundled `healthcheck.mjs` is the original combined-provider installed-profile probe; it expects MCP and its fixed TLS profile. Do not use it for the dashboard-only baseline or another TLS address without adaptation/review.

Provider overlays must explicitly select the minimum keys in [M365_RUNTIME.md](../M365_RUNTIME.md). Confidential runtime adds mandatory `CALENDAR_M365_DELEGATED_EXPECTED_USERNAME` alongside existing dedicated identity/client-secret/cache/policy keys; `work.mailbox` must match. No private account/project is compiled into the image. Bootstrap-only Supabase keys are not runtime inputs. Validate the full private selected configuration offline before starting listeners; a new image does not justify fresh consent. Saved-cache acceptance and any `interaction_required` gate are documented there. The same immutable image ID/digest is promoted, not rebuilt per account or host.

Docker stores runtime environment in daemon metadata, visible to Docker/root administrators. This is not encrypted secrets or isolation from Docker-group agents. Separate immutable code, service identity and privilege-path review remain necessary for custody.

## Staging, activation and rollback gates

1. Review exact source, pinned base/dependencies, staged secret scan and image asset/layer containment. Record source tree and immutable image ID, never invent a Git release for uncommitted code.
2. For synthetic smoke, use an ephemeral isolated container with no published ports, no live credentials and private tmpfs telemetry. Remove only that exact test container.
3. Real staging requires explicit read-only provider authorization and a private overlay. Verify allowed reads, unknown/cross-provider/calendar/caller denials, absent write tools, exact inventory and independent provider health. Never retain calendar contents in evidence.
4. Before any live replacement retain the currently deployed immutable image ID and reviewed manifest privately. Preserve exact existing data/TLS mounts, provider policy and credential scope until deliberate cutover. Resolve port conflicts explicitly; no accidental parallel host-network launch.
5. Activate only the reviewed image/config under owner approval. Read back controls and bindings, repeat authenticated acceptance and certificate-validated client checks, then test controlled restart/health if authorized. Liveness is not current provider readiness.
6. Roll back explicitly to the retained image/config by digest after compatibility review; do not silently roll back policies/secrets, merge numeric-slot telemetry histories or broaden permissions. Stage and reverify the rollback. Never use broad prune/down commands or mutable latest.

No running-service restart, registry push, tag, CI workflow or live-provider request is performed by these credential-free build instructions. Tag-only GHCR publication is now implemented, but rollout/rollback still use the existing approved host operator by digest, never an automatic replacement from this checkout. Confidential/Supabase pins are mandatory operator configuration and must be privately reviewed/provisioned before deployment; promote this same image by digest without source replacement or credential-bearing builds. See [MCP_DEPLOYMENT_STANDARD.md](MCP_DEPLOYMENT_STANDARD.md) and [../RELEASING.md](../RELEASING.md).
