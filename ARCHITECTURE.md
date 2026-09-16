# Architecture — M365 Calendar MCP

## Scope and components

This repository contains the implementation. The existing installed sibling remains a separate deployment until controlled cutover. One Node process hosts two separate Express listeners sharing validated startup configuration and a sanitized telemetry instance. The provider extensions at the end supersede the original app-only scope where applicable.

| Source module | Responsibility | Dependencies |
|---|---|---|
| `src/main.ts` | Startup, sanitized failure, SIGINT/SIGTERM shutdown | Runtime |
| `src/runtime.ts` | Require independent viewer key; optional all-or-nothing M365 setup; roll back MCP if dashboard fails | Config, identity, servers, telemetry |
| `src/config.ts` | Strict dedicated credential/policy validation | Zod, protected policy file or JSON |
| `src/identity.ts` | Explicit `ClientSecretCredential`, public-cloud authority, fixed Graph `.default` scope | Azure Identity |
| `src/server.ts` | Per-request bearer auth, client-scoped stateless MCP, five read-only tools, capacity and observations | Official MCP SDK, Graph, availability |
| `src/graph.ts` | Exact configured calendarView reads; projection, redaction, pagination, retries/deadline | Native fetch, dedicated token adapter |
| `src/availability.ts` | Clip/merge busy intervals and return complement | Complete view and explicit window |
| `src/telemetry.ts` | Allowlisted observations, bounded JSON persistence and aggregates | One trusted local file |
| `src/dashboard.ts` | Independent viewer sessions, browser origin boundary, diagnostics and public static shell | Telemetry/config counts |
| `public/index.html`, `app.css`, `app.js` | Prose-first monitoring, masked login, refresh/filter/paging | Same-origin diagnostics; local font |

## Data flow

```text
Native client -> 127.0.0.1:3217/mcp -> Host/Origin + bearer checks
 -> strict tool arguments -> caller calendar-key allowlist
 -> dedicated Azure credential -> fixed Graph calendarView
 -> bounded private-safe projection -> tool result
 -> sanitized outcome/duration -> trusted telemetry JSON

Local browser -> exact 127.0.0.1:3218 -> independent viewer login
 -> hashed in-memory session -> GET /api/diagnostics
 -> counts/health/retained logs (never Graph/MCP credentials or meetings)
```

`connection_status` needs no Graph call. `list_calendars` returns only the caller's configured keys. Listing may expose explicitly partial projected events; search and availability suppress derived results on any incomplete view. Graph recurrence expansion is delegated to calendarView rather than locally inventing recurrence semantics.

## Consistency and concurrency

Configuration is read once; restart applies rotations/revocations. MCP is stateless, with a fresh client-scoped server/transport per request, no transferable session authorization. Each request reauthenticates.

There are independent per-server caps of 16 authorized HTTP requests and 16 upstream calendar operations. HTTP saturation returns 503; upstream saturation produces `server_busy`. Disconnect/MCP cancellation propagates upstream. Operation slots are held until actual view/body cleanup and even abort-ignoring token acquisition settle, not merely until the caller's 15-second deadline. A permanently hung credential provider intentionally exhausts bounded capacity rather than admitting unlimited replacement work.

Telemetry uses synchronous single-writer atomic replacement, not transactions across processes. Metrics cover retained observations only. Offset paging is a live view and can move with writes or expiry. Sessions are memory-only and die on restart. There is no distributed limiter, durable session database, tamper-evident audit store or snapshot cursor.

## Decisions and tradeoffs

- **Dedicated app-only identity, not a default credential chain:** prevents accidental mail/environment fallback; requires administrator provisioning and tenant scope verification.
- **Two authorization domains:** scoped MCP bearer versus independent dashboard viewer. Browser receives no tool credential; deployment has one viewer role rather than named-user management.
- **Loopback MCP and default dashboard HTTP:** opt-in dashboard TLS accepts a private IPv4 address with validated certificate/key; it does not expose MCP. Cookies are not port-isolated.
- **Strict calendarView projection and continuation pinning:** no generic Graph proxy or body/attendee exposure; unfamiliar legitimate Graph continuations may be rejected as incomplete.
- **Complete-only derived answers:** avoids false availability/search certainty at cost of withholding results on bounded failures.
- **Bounded local JSON instead of a database:** low operational complexity; trusted path, one writer, limited retention and no forensic integrity guarantee.
- **Self-hosted font/plain frontend:** no browser CDN requests or build framework; tokens in [DESIGN.md](./DESIGN.md) describe actual CSS, not an imposed redesign.
- **Scoped Doppler injection:** host operator bootstraps pin cwd/scope to the executable checkout and use explicit project/config. A source checkout is not a credential or deployment migration.

## Non-goals

No calendar/mail writes, arbitrary mailbox/URL/filter inputs, body or attendee search, cross-calendar schedule synthesis, working-hour/holiday discovery, tenant administration, multi-host service, live health polling, or dashboard administrative controls. Security assumptions and packaging gaps are in [SECURITY.md](./SECURITY.md) and [SETUP.md](./SETUP.md).

## Imported provider extensions

`src/providers.ts` merges separately scoped Microsoft and Google policies without caller/key collisions. `src/m365-runtime.ts` requires an explicit app-only or delegated-confidential mode. `src/m365-confidential.ts`, `m365-delegated.ts`, `m365-msal.ts` handle strict pinned-identity/cache validation and bounded silent refresh; `src/google.ts` uses fixed Google endpoints and bounded in-memory tokens. OAuth/discovery CLIs are operator-only, not MCP tools. `src/dashboard-transport.ts` validates optional private IPv4 TLS. See [M365_RUNTIME.md](M365_RUNTIME.md), [GOOGLE_CONNECTOR.md](GOOGLE_CONNECTOR.md) and [SETUP.md](SETUP.md).

The public import replaces the installed account and Supabase project pins with deliberately unusable `example.invalid` identities, rather than publishing personal metadata or widening validation. Those two identity pins require reviewed source configuration before a new confidential deployment. App-only and Google policy configuration remain runtime-provisioned.
