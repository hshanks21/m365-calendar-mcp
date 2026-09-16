# Optional Supabase-assisted confidential bootstrap

`npm run m365:oauth:supabase -- --help` is credential-free. Actual authorization is an operator-only, dev-broker integration and requires independent review, owner readiness and private app/broker compatibility checks. It is not a production fallback or MCP tool.

**The public import replaces the original project origin with `https://calendar-bootstrap.example.invalid` in `src/supabase-bootstrap.ts`.** Exact-origin validation remains strict. Replace this pin only with a reviewed dedicated broker in a deployment-specific source change and matching tests; do not permit arbitrary environment endpoints. Runtime also requires the dedicated publishable key and confidential Microsoft inputs. A publishable key is not proof of app/redirect/tenant compatibility.

The fixed local callback is `http://localhost:8766/supabase/callback`; preserve existing broker Site URL/callbacks and unrelated application login behavior. PKCE state, nonce, provider subject, account identity and exact scope checks must pass before conversion to the dedicated confidential MSAL cache. Ephemeral Supabase state is memory-only, no remote sign-out, no generic storage fallback. Only exact fixed auth endpoints are permitted; bounded responses/deadlines and sanitized stage/reason diagnostics avoid credential output.

Owner-approved sign-in and private scoped cache write/readback are separate from calendar selection, runtime activation and live acceptance. Restore runtime read-only custody afterward. Do not redo an already successful installed bootstrap because this repository moved. See [M365_CONFIDENTIAL.md](M365_CONFIDENTIAL.md) and [M365_RUNTIME.md](M365_RUNTIME.md).
