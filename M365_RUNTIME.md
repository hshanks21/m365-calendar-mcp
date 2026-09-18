# Microsoft runtime modes

Microsoft selection is explicit and fail-closed. `CALENDAR_M365_MODE=app-only` uses the dedicated tenant/client/secret and exactly one strict policy source described in [SCHEMA.md](SCHEMA.md). `delegated-confidential` requires all of:

- `CALENDAR_M365_DELEGATED_TENANT_ID`
- `CALENDAR_M365_DELEGATED_CLIENT_ID`
- `CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID`
- `CALENDAR_M365_DELEGATED_EXPECTED_USERNAME`
- `CALENDAR_M365_DELEGATED_CLIENT_SECRET`
- `CALENDAR_M365_DELEGATED_MSAL_CACHE`
- `CALENDAR_M365_DELEGATED_POLICY_JSON`

No Microsoft namespace disables Microsoft; mixed/unknown/partial settings refuse startup. Combined Google policies require distinct keys, caller IDs and bearers. There is no broad mail/default credential fallback.

## Exact account and calendar approval

The confidential adapter pins username, tenant, user Object ID, account environment, issuer, audience, home account and scopes. The expected username is mandatory trusted-operator configuration, email syntax with a 254-character maximum and no surrounding whitespace. After syntax validation it is lowercased for case-insensitive Microsoft username comparisons. Policy `work.mailbox` must exactly equal that lowercase pin. Tenant/client/object IDs remain explicit UUIDs; confidential client secret remains a dedicated printable non-whitespace ASCII string, 1–4096 characters. A syntactically valid setting is not proof of provider compatibility.

No personal account is compiled into the image. Provision exact owner-approved settings privately, not in source, MCP arguments or dashboard input. There is no default, environment endpoint override or runtime account-switching tool. The complete selected mode, identity, cached account, caller policy, viewer independence and transport configuration validate offline before either listener starts. Returned credentials still undergo identity, issuer/audience and scope checks during acquisition.

Confidential policy has only key `work`, mapped to that exact account and the privately selected calendar ID. Each strict client has unique `id`, independent 32–256 character `secret`, and exactly `["work"]` calendar keys. Blank/synthetic examples are not deployment policies. Runtime constructs only `/me/calendars/<approved-id>/calendarView`, rejects a different mapping before token acquisition and provides the same five read-only tools.

Operator discovery (`npm run m365:discover -- --help`) is separate from MCP. After review and explicit authorization it can list bounded calendar IDs/names/default flags; discovery is not calendar approval and its output is private metadata. Select the exact intended ID privately, never infer approval from a default flag. This source import does not run discovery or alter policies.

## Minimum private injection sets

Use clean, narrowly selected Doppler injection rather than inheriting a shell full of provider secrets. Names below refer only to `CALENDAR_M365_DELEGATED_` keys unless explicitly prefixed otherwise:

| Operation | Minimum selected inputs |
|---|---|
| Historical public-client bootstrap | `TENANT_ID`, `CLIENT_ID`, `ACCOUNT_OBJECT_ID`, `EXPECTED_USERNAME`; explicit `--authorize` |
| Confidential code bootstrap | Those four identity inputs plus `CLIENT_SECRET`; explicit `--authorize` |
| Supabase-assisted bootstrap | The five confidential identity inputs plus the three `CALENDAR_SUPABASE_*` keys in M365_SUPABASE.md; explicit `--authorize` |
| Operator discovery | The five confidential identity inputs plus `MSAL_CACHE`, and `CALENDAR_M365_MODE=delegated-confidential`; no policy |
| Confidential runtime | The six discovery inputs plus `POLICY_JSON`, `CALENDAR_M365_MODE=delegated-confidential`, independent `CALENDAR_DASHBOARD_SECRET`, approved telemetry/transport settings |

Bootstrap does not need a preexisting cache or runtime policy. Runtime/discovery do not need Supabase settings or a temporary writer. Google-only/dashboard-only inject no Microsoft keys; app-only keys and Google contracts are unchanged. Microsoft unknown/mixed namespaces and Supabase custom API overrides are refused, not used as fallbacks.

Nonfunctional schema examples (synthetic, not accounts/credentials to deploy): `EXPECTED_USERNAME=owner@example.invalid`, `TENANT_ID=11111111-1111-4111-8111-111111111111`, `CLIENT_ID=22222222-2222-4222-8222-222222222222`, `ACCOUNT_OBJECT_ID=33333333-3333-4333-8333-333333333333`. Real secrets, cache, caller policy and calendar ID must be privately supplied; never generate usable defaults from these examples.

The helper's Doppler project/config remains exactly `m365-calendar-mcp` / `prd`; scope remains derived from executable cwd, with fixed `https://api.doppler.com` and `--no-read-env`. No scope/project/API override is added. Provisioning access to this executable checkout is a separate operator action; copying source does not migrate the installed sibling's scope. Do not inject a broad Doppler environment wholesale into Compose: explicitly select only the operation's inputs and keep populated overlays in private stdin/memory.

## Saved-credential live acceptance (separate approval)

1. Independently review the staged source/config contract, then privately provision the expected username in the intended scoped Doppler config. Confirm the existing dedicated tenant/client/object/secret/cache match the approved account; no values in logs. Do not change provider registrations, broker settings or stored cache as part of deployment.
2. Reuse the existing saved confidential MSAL cache and existing approved `work` mapping. If the exact calendar ID is not already approved, request owner-authorized read-only discovery and selection, not new OAuth. Validate the complete injected runtime configuration offline before starting any listener.
3. Stage the reviewed immutable image in an isolated unpublished container with approved read-only credentials. Only with explicit live-read approval, exercise authenticated allowed work reads; reject unknown caller, other account/calendar, cross-provider key, write tools and arbitrary URLs. Verify independent Google behavior without changing its config; retain only secret-safe pass/fail evidence.
4. Stop on `interaction_required`; report the fixed stage/reason and request separate reauthentication approval only if needed. Do not automatically start a bootstrap, request fresh login or overwrite cache.
5. Retain the installed immutable image/config privately and wait for explicit activation approval. After approved rollout, verify actual controls, binds, TLS and authenticated allowed/denied reads. Roll back by retained digest and compatible private configuration, never by a source edit or broader permission.

## Refresh and custody

Official MSAL ConfidentialClientApplication uses the explicit secret and strict cached identity. Silent refresh has a 15-second bound and propagates cancellation through metadata/token/body work; server capacity remains held until work settles. Refreshed state is memory-only, never exported or automatically written to Doppler. Restart reuses the privately stored bootstrap snapshot. Expiry/revocation/Conditional Access may require separately authorized rebootstrap; offline access is not perpetual access.

`Calendars.ReadBasic` is broader than one service-mapped calendar. A stolen cache/client secret can exceed service policy, and shared app grants are not narrowed by this helper. Same-user/root/Docker-equivalent access defeats credential isolation. Preserve the installed deployment and provider policies until explicit cutover approval; do not rerun consent merely because source moved.
