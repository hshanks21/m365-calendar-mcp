# Security boundary and risk register

## Accepted v1 scope

Read-only capability narrowing for cooperative native clients and one independently authenticated local dashboard viewer, on a trusted host. This is **not OS credential isolation**, a remotely deployable login design, comprehensive HTTP audit logging, or evidence of live tenant authorization. Source/configuration writable by the same user can bypass service policy. Root, sudo-equivalent or Docker-group access can defeat separate-user/container custody.

## Enforced application boundaries

- MCP binds `127.0.0.1:3217`; authenticates every request, including initialization, using timing-safe hash comparison of independent client bearers. Loopback Host syntax only; every browser Origin rejected; no CORS. POST JSON transport only, no GET/SSE or DELETE sessions. JSON max 16 KB.
- Strict tool schemas and caller allowlists map keys to fixed server-side mailboxes/calendar IDs. Five read-only tools, no arbitrary Graph path/filter or writes. Narrow projection/redaction; incomplete search/availability never implies a complete schedule.
- Dedicated explicit Azure credential and fixed public-cloud Graph scope, no credential chain/mail fallback. Graph continuation, response, retry, deadline and concurrency bounds are documented in [SCHEMA.md](./SCHEMA.md).
- Dashboard defaults to exact numeric loopback port 3218; opt-in private IPv4 HTTPS requires valid paired TLS files and exact Host/Origin. Exact Host/Origin and Fetch Metadata checks; state-changing requests require Origin. Independent key/session, no Graph/MCP credential in browser. Public assets contain no operational data.
- HttpOnly, SameSite Strict, host-only session cookies; one hour, 32 memory sessions, global 10 login attempts/minute. HTTPS sets Secure; default loopback HTTP deliberately has no Secure cookie attribute; cookies are not port-isolated. CSP self-only resources/no inline script or style/no framing, no-store, no-referrer and nosniff. No localStorage credential persistence.
- Strict telemetry serialization omits meeting data, identifiers, raw arguments/errors and secrets. Numeric caller slots and fixed enums only; no caller-supplied identity labels.

## Risks and residual limitations

| Risk | Current treatment / remaining acceptance |
|---|---|
| Overbroad Microsoft privileges | New scoped app/RBAC plus separate review of additive Entra grants; actual allowed/denied mailbox tests still required |
| Same-host credential theft/tampering | Trusted-host assumption; no OS isolation claimed. Administrator-controlled immutable install, separate identity and privilege-path review needed for custody |
| Untrusted telemetry path/symlink or pre-existing loose modes | Accepted trusted-directory assumption, not a hardened filesystem boundary. Existing parents and adjacent `.tmp` must be protected. Single writer only |
| Policy-file path tampering | Regular-target/mode check follows symlinks and does not validate ownership/parents; protect path or use scoped runtime JSON injection |
| Local login denial of service | Bounded global attempts/session map; shared viewer and global limiter intentionally simple, not multi-user fairness |
| Bounded history mistaken for audit totals | At most 5,000 rows/31 days; not tamper-evident/durable audit, retries not measured, pruning only on access/write/start |
| Missing telemetry coverage | Counts parsed authorized tools/call responses and auth denials, not handshake/discovery, malformed HTTP/JSON, Host/Origin rejects or pre-handler capacity rejects |
| Latency/health overclaim | Handler-to-finish/disconnect duration, not round-trip; auth duration separately measured. Previous complete read is not current health or proof of tenant scope; liveVerified stays false |
| Slot/pagination ambiguity | Policy reordering changes historical slot meaning; archive history when remapping. Offset pages drift with traffic/expiry; minor UI out-of-range label/empty-page behavior is an accepted v1 limitation, not fixed here |
| Permanently hung token provider | Bounded fail-closed 16-operation exhaustion until settlement/recovery/restart; no premature slot release |
| Real Graph pagination/role differences | Conservative failure may reject unfamiliar legitimate responses. Synthetic tests do not establish tenant compatibility |
| Deployment drift | Docker packages assets and dependencies; build verification is not deployment approval. Existing host installation/mounts remain separate; see deploy/DOCKER_RUNBOOK.md |
| Accessibility/contrast overclaim | Source includes keyboard/ARIA/focus behavior but full accessibility certification is not established; DESIGN records actual dimensions and token checks |

## Reporting and approval

Raise a sanitized issue or contact the repository owner through an already established private channel for sensitive findings; no security email or private-reporting feature is assumed configured. Do not include credentials, tenant IDs, mailbox mappings, raw logs or exploit payloads containing live data in public issues. Publication, credential rotation, tenant permission edits, deployments, and network/privilege changes require explicit owner/administrator authorization.

For future live acceptance, verify disallowed mailbox reads, recurrence exceptions, private redaction, pagination, throttling, token expiry and rotation. The source-import verification does not repeat live reads, provision credentials, approve LAN changes or claim independent audit sign-off.

## Provider and publication caveats

The Google OAuth grant includes `calendar.events` (broader than read-only); a stolen token can exceed the five-tool service boundary. Event creation is unavailable and cannot be enabled with a flag. Confidential Microsoft delegated scope likewise does not restrict the provider grant to one server-mapped calendar. Both require protected custody independent of application policy. Refresh caches are sensitive credentials, not public reproducibility inputs.

Personal account/project pins are mandatory dedicated operator environment settings, validated before listeners or authorization. Operator custody of `CALENDAR_M365_DELEGATED_EXPECTED_USERNAME` and `CALENDAR_SUPABASE_ALLOWED_ORIGIN` is an approval boundary: changing them changes the approved deployment, not a caller-selectable account. They have no defaults and retain exact identity/origin checks. No wildcard acceptance, generic credential fallback, arbitrary host/custom endpoint or MCP configuration tool is introduced. Approve private settings separately from the immutable image. Operator bootstrap Doppler cwd/scope is pinned to the executable checkout; the installed sibling retains its existing scope. Repository publication does not configure or migrate a secret-manager identity.
