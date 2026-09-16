# Google connector — read-only MCP

The Google adapter participates in the existing five read-only tools, with separate provider health and caller/calendar policy. Google-only, Microsoft-only, combined and dashboard-only startup are supported. No write, arbitrary proxy, ACL or discovery MCP tool exists. `createEnabled:false`; a nonempty `CALENDAR_GOOGLE_CREATE_ENABLED` other than `false` refuses startup.

## Dedicated inputs

Provide `CALENDAR_GOOGLE_CLIENT_ID`, `CALENDAR_GOOGLE_CLIENT_SECRET`, `CALENDAR_GOOGLE_REFRESH_TOKEN` and `CALENDAR_GOOGLE_POLICY_JSON` privately. No partial configuration, policy-file fallback or implicit `primary` calendar. Strict policy maps aliases to exact owner-approved `calendarId` values and clients to unique IDs/bearers/read keys. Optional `writeCalendarKeys` defaults empty and confers no write capability. Combined provider keys, IDs and secrets must not collide.

Use `npm run google:discover -- --help` for operator discovery help. Actual discovery is an explicitly authorized live CalendarList read, not an MCP capability or approval of a returned calendar. Names/IDs/access roles must stay private. OAuth bootstrap is likewise separately authorized and host-scope pinned; see [SETUP.md](SETUP.md).

## Bounds and semantics

Fixed token/API origins only; no redirects. Recurring-expanded `singleEvents=true`, `showDeleted=false` reads use an explicit offset-aware positive window <=31 days. Bounds: 10 pages, 1000 entries, 2 MB per page, 16 KiB token response and 15 seconds overall. Tokens cache only in memory. No automatic Google retries or ambient credentials. Cancellation propagates through token/fetch/body work; operation capacity is retained until settlement.

Projection excludes attendees, descriptions, locations, organizer and links. Private/confidential/unknown visibility redacts ID and subject but preserves timing. All-day dates use the returned IANA zone, exclusive end and DST-aware conversion. Malformed data and partial views fail incomplete; search/availability never convert failure to an empty/free schedule. Search is local non-private subject matching, not Google's broad `q` search.

Separate `googleSuccess`/`lastGoogleSuccess` and health state never mark Microsoft healthy. Telemetry still stores no meetings or identities. Numeric policy slots may change after combined-provider reconfiguration; archive history deliberately.

## Grant versus tool scope

OAuth requests `calendar.events` and `calendar.calendarlist.readonly`; the first grant can edit accessible events even though this server cannot. Protect refresh credentials independently; server allowlisting does not narrow a stolen provider grant. Google Testing-mode refresh expiry and account/admin revocation can require new owner-approved consent. Do not automatically expand grants or retry consent.

Future writes require a separate authenticated human approval authority, immutable server-side proposal/digest, one-time atomic consume, replay/idempotency and uncertain-result reconciliation, explicit notification/attendee choices and independently reviewed synthetic tests. An agent saying “confirmed” or an environment flag is not consent. No such workflow is shipped.

References: [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [OAuth expiration](https://developers.google.com/identity/protocols/oauth2#expiration).
