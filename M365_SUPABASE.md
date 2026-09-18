# Optional Supabase-assisted confidential bootstrap

`npm run m365:oauth:supabase -- --help` is credential-free. Actual authorization is an operator-only, dev-broker integration and requires independent review, owner readiness and private app/broker compatibility checks. It is not a production fallback or MCP tool.

The broker is an operator-approved deployment pin, not an arbitrary endpoint. All three dedicated settings are mandatory before authorization/callback/network activity:

| Setting | Constraint |
|---|---|
| `CALENDAR_SUPABASE_ALLOWED_ORIGIN` | Approved exact `https://<project-ref>.supabase.co`; project ref is exactly 20 lowercase ASCII letters (Supabase CLI format) |
| `CALENDAR_SUPABASE_URL` | Configured SDK source URL; must equal the approved origin byte-for-byte |
| `CALENDAR_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_` followed by 8–256 ASCII letters/digits/underscore/hyphen; no secret/service-role/legacy key fallback |

For schema illustration only, `https://abcdefghijklmnopqrst.supabase.co` is a synthetic placeholder, **not an approved broker or a URL to contact**. Both origin settings must be privately provisioned to the same owner-approved value. No path (including trailing slash), query, fragment, userinfo, port (even 443), custom domain, uppercase spelling or whitespace is accepted. Unknown `CALENDAR_SUPABASE_*` API overrides fail closed. The suffix validates configuration syntax only: it is not a networking wildcard. Each SDK exchange/user request remains pinned to that exact origin and one of two fixed routes with redirects forbidden. A returned authorization URL is checked against the independently configured approved origin, never used to derive it.

Also inject the five dedicated confidential identity inputs in M365_RUNTIME.md, including `CALENDAR_M365_DELEGATED_EXPECTED_USERNAME`. The key is not proof of app/redirect/tenant compatibility; privately verify those before separately authorized bootstrap. These are **bootstrap-only** broker settings, not required for saved-cache runtime/discovery. Build/promote one unchanged image; never embed private values or alter source to select a deployment.

The fixed local callback is `http://localhost:8766/supabase/callback`; preserve existing broker Site URL/callbacks and unrelated application login behavior. PKCE state, nonce, provider subject, account identity and exact scope checks must pass before conversion to the dedicated confidential MSAL cache. Ephemeral Supabase state is memory-only, no remote sign-out, no generic storage fallback. Only exact fixed auth endpoints are permitted; bounded responses/deadlines and sanitized stage/reason diagnostics avoid credential output.

Owner-approved sign-in and private scoped cache write/readback are separate from calendar selection, runtime activation and live acceptance. Restore runtime read-only custody afterward. Do not redo an already successful installed bootstrap because this repository moved. See [M365_CONFIDENTIAL.md](M365_CONFIDENTIAL.md) and [M365_RUNTIME.md](M365_RUNTIME.md).
