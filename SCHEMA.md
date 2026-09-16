# Schema — Configuration, tools and observations

These contracts describe the imported implementation. The provider extensions below supplement the original app-only contract. There is no SQL database, DDL or migration framework. Calendar events are transient Graph projections; telemetry is a bounded JSON array; sessions are ephemeral maps.

## Configuration entities

`Config` combines `tenantId`, `clientId`, `clientSecret` with policy `{calendars, clients}`. Dedicated environment names and startup modes are in [SETUP.md](./SETUP.md).

| Field | Implemented constraint |
|---|---|
| `tenantId`, `clientId` | UUID strings |
| `clientSecret` | Nonempty string; dedicated app identity is an administrative requirement, not inferred from its contents |
| `calendars` | Record with keys matching `^[a-zA-Z0-9_-]{1,64}$` |
| Mapping `mailbox` | Email string, max 254 characters |
| Mapping `calendarId` | String, 1–512 characters, neither `.` nor `..` |
| `clients` | Array, 1–64 strict objects |
| Client `id` | String, 1–64 characters, unique across clients |
| Client `secret` | String, 32–256 characters, unique across clients; length is not an entropy test |
| Client `calendarKeys` | Array, 1–32 strings; every key must exist in `calendars` |

Policy and mapping/client objects reject extra fields. Exactly one nonempty policy source is used; setting both file and JSON fails. File loading uses `statSync`, requires a regular target file and zero group/other permission bits. This is not a no-symlink/ownership/parent-directory security check. Protect the whole path administratively. Repeated keys within a client's array are not deduplicated by validation; use distinct keys to keep counts meaningful. No separate maximum number of calendar mappings is enforced.

## MCP inputs and results

All tool objects are strict. `calendarKey` matches the same key pattern. `start` and `end` are ISO datetimes with explicit `Z` or numeric offset, with positive elapsed range at most 31 days. No arbitrary mailbox, ID, URL, OData expression or extra tool field is accepted.

| Tool | Input | JSON result in MCP text content |
|---|---|---|
| `list_calendars` | `{}` | `{calendars: [{calendarKey}]}` |
| `connection_status` | `{}` | `{configured: true, liveVerified: false, mode, allowedCalendarCount}`; production mode `m365-app-only`, injected test mode `test-fixture` |
| `list_events` | `{calendarKey, start, end}` | `View = {complete, events, error?}` |
| `search_events` | Window plus trimmed `query`, 1–100 characters | Same shape, only non-private projected subjects matched by lowercase literal substring; no results if incomplete |
| `get_work_availability` | Window | `{complete, free: [{start, end}], error?}`; no free intervals if incomplete |

`Event` contains only `id`, `subject`, `start`, `end`, `showAs`, `isCancelled`, `isAllDay`, `private`. Times normalize to UTC ISO strings with end after start. Accepted busy statuses: `free`, `tentative`, `busy`, `oof`, `workingElsewhere`, `unknown`. Input event dates must declare UTC. Non-normal or missing sensitivity yields `id: "redacted"`, `subject: "Private event"`, `private: true`; normal subject output is capped at 500 characters. No attendees, body/bodyPreview, organizer, links or location. Busy/time/all-day/cancellation metadata intentionally remains available even for private events.

Availability ignores cancelled/free events, clips the remaining intervals to the requested window, sorts/merges overlaps and returns their UTC complement. It describes only one configured calendar and explicit window, not mailbox-wide availability or working-hours settings.

## Failure and Graph invariants

Tool handler failures use MCP `isError: true` with `calendar_denied`, `server_busy` or sanitized `invalid_request`; SDK validation can return its own protocol error text. A bounded Graph failure instead produces a normal tool response with `complete:false` and sanitized `error`; telemetry counts it as an error. Do not equate HTTP 200 or absent `isError` with complete data.

Graph errors: `unsafe_pagination`, `throttled`, `upstream_http`, `response_limit`, `invalid_response`, `event_limit`, `page_limit`, `cancelled`, `timeout`, `upstream_unavailable`. No raw upstream response text is returned.

Production Graph origin is `https://graph.microsoft.com`; only configured encoded mailbox/calendar paths are constructed. Fixed select is `id,subject,sensitivity,start,end,showAs,isCancelled,isAllDay`; `$top=100`. Maximum 10 pages, 1,000 events, 2,000,000 bytes per response, overall 15 seconds including token acquisition. Three attempts per page only for 429/503/504; absent Retry-After uses 0.25 seconds, numeric values 0–2 seconds are accepted, longer/HTTP-date values fail incomplete. No retry for 401/403 and no redirects.

Continuation origin/path must match exactly, with no credentials, fragment or repeated URL. Original window/select/top are repinned. Only these query names plus `$skip`/`$skiptoken` are allowed. Only absence of `@odata.nextLink` ends traversal; present null/empty/relative/malformed links fail incomplete. Conservative validation can reject a real Graph continuation; live variants remain unverified.

## Persisted telemetry

Each array entry has the following sanitized output fields (plus `googleSuccess`, described below):

| Field | Meaning and bounds |
|---|---|
| `at` | Numeric epoch milliseconds; finite loaded timestamps; future/older-than-31-day rows pruned |
| `caller` | Integer 0–64; 0 unknown, positive number is one-based startup policy-array slot |
| `operation` | Five tool names plus `protocol`, `authentication` |
| `outcome` | `success`, `denied`, `error` |
| `durationMs` | Finite nonnegative input, rounded and capped at 3,600,000 |
| `graphSuccess` | Boolean, true only when supplied true with success outcome; live instrumentation marks a complete calendarView |

Unknown input fields are dropped; invalid rows are ignored. No arbitrary identity, label, argument, raw error, mailbox, calendar ID, token or meeting field is serialized. Array loading rejects files over 2,000,000 bytes/non-array payloads as unhealthy. New directory/file modes are 0700/0600; existing directories and `.tmp` path are trusted, not hardened against hostile local mutation. One writer per path. Writes replace via adjacent `.tmp` rename; no fsync/durability or audit-integrity guarantee.

Maximum 5,000 rows/31 days; pruning on startup, reads and writes, not background erasure while idle/stopped. Reordering policies can change historical slot meaning. Archive/remove history under administrator control before slot reassignment when continuity matters.

## Dashboard HTTP and snapshot contract

Public shell/assets carry no operational data. `POST /login` accepts JSON `token`, uses a 1 KB JSON body limit and returns 204 plus cookie on success, 401 for bad key, 429 after 10 global attempts/minute. `POST /logout` requires session and exact Origin; returns 204 and invalidates that session. `GET /api/diagnostics` requires a viewer session. Unknown/duplicate/malformed filters fail 400; other diagnostics methods return 405 after applicable guards.

Filters: `period=today|week|month` (default today), `offset=0..5000` (default 0), `limit=1..100` (default 25). HTTP numeric text is 1–4 digits. Today starts UTC midnight; week/month roll 7/31 days. Response:

- `health`: `service: up`, `mcp: up|not_configured`, `graph: not_configured|unverified|previous_read_succeeded`, `mode: local|test-fixture`, `liveVerified: false`.
- `access`: `readOnly: true`, configured `calendarCount`, and `callers: [{caller, label, calendarCount}]`; labels are generated `Agent N`, never configured identities.
- `metrics`: `period`, `windowStart`, `asOf`, `calls`, `successes`, `denied`, `errors`, `successRate`, `medianMs`, `lastGraphSuccess`, `storageHealthy`, `retention`, `callers`, `operations`, `logs`, `offset`, `limit`, `total`, `hasMore`.
- `retention`: `maxEvents`, `maxDays`, `retained`, `oldest`. Caller/operation summaries contain identifier plus `calls`; logs are newest-first entries.

`successRate` is successes/calls or null; `medianMs` is sorted durations at `floor(n/2)` (upper middle for even counts), or null. `lastGraphSuccess` comes from all retained rows, not just the selected period, and is not proof of current health or real tenant scope. Logs/counts are live bounded offset views, not stable snapshots.

Sessions map SHA-256 hashes of random 256-bit IDs to one-hour expiry, maximum 32; oldest insertion is evicted at capacity after expiry pruning. Restart revokes all. Cookie `calendar_viewer` is host-only, Path `/`, HttpOnly, SameSite Strict, not Secure on loopback HTTP. See [SECURITY.md](./SECURITY.md) for the local trust boundary.

## Imported multi-provider extensions (authoritative over earlier app-only examples)

- Microsoft runtime requires `CALENDAR_M365_MODE=app-only` or `delegated-confidential`; namespace mixing, unknown variables and partial configuration fail closed. Delegated confidential credentials/cache/work policy use `CALENDAR_M365_DELEGATED_*`. See [M365_RUNTIME.md](M365_RUNTIME.md). The original app-only schema above still applies in app-only mode.
- Google uses the four dedicated inputs in [GOOGLE_CONNECTOR.md](GOOGLE_CONNECTOR.md). No provider settings gives dashboard-only mode; any partial provider configuration refuses startup. Combined policies require globally distinct keys, client IDs and bearers. Microsoft caller slots precede Google slots.
- `connection_status` describes configured providers and allowed counts; `createEnabled:false`, `liveVerified:false`. It is never a live readiness probe. The five read-only tools are unchanged. Google `list_events` uses recurring-expanded bounded Google events with private projection; incomplete Google views discard partial events.
- Telemetry also serializes only boolean `googleSuccess`; diagnostics has a separate Google state and `lastGoogleSuccess`. A Graph success never marks Google successful, or vice versa. Old rows remain sanitized. Counts still omit many transport-level rejections.
- HTTPS sets Secure on login/logout cookies and requires one exact private IPv4 Host/Origin. MCP remains loopback regardless. `CALENDAR_DASHBOARD_BIND_ADDRESS`, `CALENDAR_DASHBOARD_TLS_CERT_FILE`, `CALENDAR_DASHBOARD_TLS_KEY_FILE` must form a valid transport configuration. No arbitrary proxy trust or plaintext LAN fallback.
