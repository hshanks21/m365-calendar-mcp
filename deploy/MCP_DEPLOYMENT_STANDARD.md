# Standard for future MCP Docker deployments

This is the owner-selected deployment/release convention. Calendar implements the first instance; this document does not install another MCP, grant future credentials, or add CI/CD infrastructure.

## Unit of deployment and ownership

Use **one narrowly scoped MCP service per Compose project/container**, not a monolith. Name projects `mcp-<purpose>`; existing `calendar-mcp` is the retained compatibility name. Keep each service's source, runtime policy, secrets allowlist, network, data directory/volume, image versions and runbook independently owned and revocable. Do not place unrelated provider credentials in every service. Calendar's existing work/Google scheduling domain stays combined; future Gmail is separately designed/approved, not part of this change.

Prefer a project-private bridge. Publish native MCP only on an explicit loopback address, and any approved LAN UI only on its exact private address with validated TLS. Separate **internal socket binding** from **external accepted Host/Origin** through reviewed application support; bridge NAT must not become a reason to loosen Host, Origin, bearer, TLS or proxy policy. Host networking is a documented exception for Calendar's reviewed fixed binds, not the default for new servers. Restrict egress where operationally feasible; ordinary Docker bridge is not an upstream allowlist.

## Required production controls

- Pinned supported base version + digest and locked application dependencies; multi-stage tested build, minimal runtime.
- Explicit nonroot UID/GID; no socket, privileged mode, broad host mounts or home/secret-manager mounts. Keep secret file permissions private rather than making keys world-readable to fix UID mismatches.
- Read-only root, dropped capabilities, no-new-privileges, small bounded tmpfs, PID/memory/CPU bounds, init/signal handling and stop grace.
- `unless-stopped`, bounded logs, liveness-only healthcheck with no provider polling. External monitoring of unhealthy state/provider freshness is separately scoped; do not install a root-equivalent generic admin dashboard or expose Docker APIs by default.
- Allowlist build context; exclude `.env`, Git, private policy, secrets, TLS material, caches, telemetry and evidence. Never build with credentials in arguments, environment layers or copied files. Inspect actual image layers and compare shipped static assets with approved source.
- Independently persistent telemetry under exact 0700/0600 custody or a deliberately initialized service-owned named volume. Do not confuse retained numeric caller slots across policy reorderings; archive before schema/mapping changes.
- Per-service read-only secret-manager access and exact runtime key selection. Prefer a runtime secret channel that avoids daemon metadata when feasible. If using environment injection, use private stdin/process memory, never a generated plaintext `.env`, and document that Docker/root administrators can read persistent environment metadata. Docker-group agents are not isolated from credentials.
- No consent, grant changes, writes or configuration changes outside explicit owner authorization. Authentication failure is a bounded actionable failure, never an automatic re-consent loop.

## Release trigger: version tags only

Future CI/CD should trigger on pushed, approved **`vMAJOR.MINOR.PATCH`** Git tags (for example `v1.2.3`), with strict full-pattern validation. A broad `v*` workflow filter alone is insufficient; reject malformed/non-SemVer tags in a validation job. Do not auto-deploy branch pushes, PR builds, mutable `latest`, or arbitrary rebuilds. Do not create a workflow/remote/registry in this Docker migration.

For each release:

1. Resolve the tagged Git commit, verify version/package consistency and review authorization. Protect release tags against overwrite/deletion; never recycle a published version.
2. Run credential-free tests, typecheck/build/smoke, image safety/dependency scans and provenance capture. Build once from the tagged commit using pinned inputs.
3. Publish immutable human version `registry/service:vMAJOR.MINOR.PATCH` and commit-qualified identity such as `registry/service:vMAJOR.MINOR.PATCH-sha-<full-commit-SHA>`, with OCI version/revision/source labels and recorded image digest. SemVer identifies the release; the digest pins the actual artifact. Registry immutability/protected tags must enforce the convention.
4. Promote the **same image digest**, never rebuild per environment. Deploy `registry/service@sha256:<digest>` (or its verified local image ID). Record release tag, full Git SHA, image digest/ID, base digest, migration effects, approval and acceptance timestamp. Do not invent Git provenance for an untracked local source snapshot.
5. Run isolated staging acceptance with the approved narrow real credentials: allowed read, disallowed account/provider/calendar, unknown caller 401, no writes or arbitrary proxy, exact tools, TLS/Host/Origin checks, unchanged UI assets and independent data paths. Suppress event/message contents and secrets.
6. Require independent review for security-sensitive semantic changes and approval for live activation. Retain the currently deployed image by immutable ID/digest **before** replacement, plus its versioned deployment manifest. Stage/review passed is not deployed.
7. Read back actual runtime controls and endpoint bindings; repeat authenticated acceptance; perform a controlled restart and verify health. Check boot daemon enablement without pretending a reboot was tested. Obtain remote client confirmation where required.
8. Keep at least the previous known-good image and deployment metadata until a later approved retention decision. Roll back explicitly by digest, with compatible policy/data schema and acceptance checks. Never use `latest` or an assumed tag pointer for rollback. No broad `docker system prune` in release automation.

## Per-service operator interface

Every service must ship concrete `build`, isolated `stage`, gated `start/update`, safe `status`, bounded/redacted `logs`, `verify`, `restart`, `stop` and digest-based `rollback` instructions. State effects must be read back before success is claimed. Credentials and arbitrary API error bodies must not appear in these outputs. Calendar's tested example is [DOCKER_RUNBOOK.md](DOCKER_RUNBOOK.md); its exact paths and fixed transport are service-specific, not universal template values.

A container reduces packaging drift, not provider privilege by itself. Underlying OAuth scopes, service policy, caller authentication and host administrator custody are separate boundaries and require separate acceptance evidence.
