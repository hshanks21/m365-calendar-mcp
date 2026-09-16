# Plan — current acceptance gates

| Phase | State and acceptance |
|---|---|
| Source consolidation | Authorized import of implementation, lockfile, synthetic tests, UI/fonts/notices and credential-free Docker packaging into this repository |
| Documentation | Existing project contracts retained and reconciled with provider/TLS extensions; protected AGENTS wording could not be refreshed |
| Reproducibility | Fresh staged export must pass install, typecheck, source/compiled tests, build, smoke and Docker build; exact staged tree secret scan |
| Review/publication | Independent secret/scope/code review before conventional commit and feature-branch push; no main overwrite, CI implementation or release tag |
| Deployment cutover | Separate approval; installed sibling and live Docker bind mounts remain unchanged |
| Live acceptance | Separate scoped credentials, allowed/denied provider reads, restart/rotation and client-reachability evidence, not inferred from fixtures |

No new write/mail/proxy capabilities, tenant grants, credential provisioning, service restart or repository settings are part of source publication. See [HANDOFF.md](HANDOFF.md), [TESTING.md](TESTING.md) and [RELEASING.md](RELEASING.md).
