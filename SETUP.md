# Setup and operational boundary

## Credential-free checkout

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke` from this repository with Node >=24 and OpenSSL. Docker builds from `deploy/Dockerfile` without host credentials or local configuration. Do not copy populated policies, telemetry, token caches or TLS keys into the checkout.

## Runtime configuration

| Setting | Contract |
|---|---|
| `CALENDAR_DASHBOARD_SECRET` | Required independent high-entropy viewer, 32–256 characters; no default |
| `CALENDAR_TELEMETRY_FILE` | Optional protected single-writer path, default `var/telemetry.json` |
| `CALENDAR_M365_MODE` | Explicit `app-only` or `delegated-confidential` whenever Microsoft settings exist |
| `CALENDAR_M365_TENANT_ID`, `CALENDAR_M365_CLIENT_ID`, `CALENDAR_M365_CLIENT_SECRET` | Dedicated app-only identity, no generic credential chain |
| `CALENDAR_M365_POLICY_JSON` OR `CALENDAR_M365_POLICY_FILE` | App-only strict calendars/clients policy; exactly one source |
| `CALENDAR_M365_DELEGATED_*` | Confidential mode only; see [M365_RUNTIME.md](M365_RUNTIME.md) |
| `CALENDAR_GOOGLE_CLIENT_ID`, `CALENDAR_GOOGLE_CLIENT_SECRET`, `CALENDAR_GOOGLE_REFRESH_TOKEN`, `CALENDAR_GOOGLE_POLICY_JSON` | Complete Google configuration; see [GOOGLE_CONNECTOR.md](GOOGLE_CONNECTOR.md) |
| `CALENDAR_GOOGLE_CREATE_ENABLED` | Omit or exact `false`; writes are unavailable |
| `CALENDAR_DASHBOARD_BIND_ADDRESS`, `CALENDAR_DASHBOARD_TLS_CERT_FILE`, `CALENDAR_DASHBOARD_TLS_KEY_FILE` | Optional paired private-IPv4 HTTPS; missing/invalid TLS fails closed |

Omit every unused provider setting, rather than injecting empty values. Unknown/mixed Microsoft namespaces and partial providers refuse startup before listeners. No provider settings gives dashboard-only (no MCP listener); any enabled provider gives MCP plus dashboard. Configuration and keys are read once; approved restart applies rotation and revokes viewer sessions. No dotenv loader, production upstream override or fixture-mode environment flag exists.

Use private scoped secret-manager injection. Generate independent random viewer/caller credentials privately (recommend at least 32 random bytes encoded hex/base64url); accepted length is not entropy. Exact viewer reuse of provider credentials or MCP bearers is refused. Each caller receives only its own bearer. No secrets in source, chat, command arguments/history, examples, logs or screenshots.

## Running is a separate approval

After private configuration and installation approval, launch the built entrypoint with `npm start` through your explicitly scoped runtime injector. This is not an instruction to launch over the existing service. Confirm unused fixed ports and exact data ownership first. The installed sibling `/home/harvito/projects/mcp-server-calendar` and its current Docker bind mounts remain unchanged until a controlled cutover.

MCP is native-only `http://127.0.0.1:3217/mcp`; every request needs its caller bearer and must have no browser Origin. Dashboard defaults to exact `http://127.0.0.1:3218/`, not `localhost`. Optional HTTPS requires a valid certificate for the selected private IPv4 bind, paired absolute cert/key paths and private key mode; never bypass certificate warnings. Viewer authentication is independent of MCP.

## Host-bound operator bootstraps

OAuth/discovery commands can call real providers and write sensitive caches to the configured secret manager; they are not test commands. `src/google-oauth.ts` derives `IMPLEMENTATION_CWD` from the executable source/build location, not caller input, and uses that exact cwd as Doppler scope with fixed project/config. Fresh-checkout tests require this portability correction. The installed sibling is untouched and retains its existing scope. Authorizing a new checkout with a scoped secret-manager identity is an explicit operator gate, not an automatic credential migration. Confidential account and Supabase-origin pins were sanitized to reserved invalid identities for publication; review approved replacements and the entire credential/callback trust boundary before using those helpers. Help is safe and makes no provider calls.

## Microsoft administrator acceptance

App-only mode needs a dedicated service principal and reviewed Exchange Application RBAC mailbox scope, plus separate inspection of additive Entra application grants. Exchange and Entra grants are additive, not an intersection. Do not add broad mail/write access to work around failure. Use `Test-ServicePrincipalAuthorization` **and actual allowed/denied Graph reads** under administrator approval. Delegated mode instead validates its pinned account and narrow scopes; the provider grant is still broader than one server-approved calendar.

References: [Exchange Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0). Synthetic checks do not prove live role/field compatibility, recurrence, token rotation or scope.

## Troubleshooting

- Startup refuses: privately check field presence/format, mode, independent keys, exactly one app policy source, private file permissions, TLS validity and port conflicts. Do not dump environment/cache values.
- Dashboard 403: use exact canonical Host/Origin; no unreviewed proxy. 401/429: correct independent viewer and global login limit.
- Configured/unverified: configuration is not provider liveness. `liveVerified:false` stays conservative even after completed reads.
- Incomplete/server_busy: never infer free time; investigate bounded provider/deadline/cancellation behavior, not broader grants. Hung token work retains bounded operation capacity.
- Persistence warning: check protected single-writer directory and free space without dumping telemetry. Numeric caller slots change meaning after policy reordering; preserve/archive history deliberately.

See [Docker runbook](deploy/DOCKER_RUNBOOK.md) for image construction versus controlled deployment.
