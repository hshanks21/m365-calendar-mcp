# Microsoft runtime modes

Microsoft selection is explicit and fail-closed. `CALENDAR_M365_MODE=app-only` uses the dedicated tenant/client/secret and exactly one strict policy source described in [SCHEMA.md](SCHEMA.md). `delegated-confidential` requires all of:

- `CALENDAR_M365_DELEGATED_TENANT_ID`
- `CALENDAR_M365_DELEGATED_CLIENT_ID`
- `CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID`
- `CALENDAR_M365_DELEGATED_CLIENT_SECRET`
- `CALENDAR_M365_DELEGATED_MSAL_CACHE`
- `CALENDAR_M365_DELEGATED_POLICY_JSON`

No Microsoft namespace disables Microsoft; mixed/unknown/partial settings refuse startup. Combined Google policies require distinct keys, caller IDs and bearers. There is no broad mail/default credential fallback.

## Exact account and calendar approval

The confidential adapter pins username, tenant, user Object ID, account environment, issuer, audience and scopes. **For public import the username pin in `src/m365-delegated.ts` is `owner@example.invalid`, not a usable account.** Replace it only in a separately reviewed deployment-specific source change with matching regression fixtures. Do not turn it into arbitrary caller input or remove identity validation.

Confidential policy has only key `work`, mapped to that exact account and the privately selected calendar ID. Each strict client has unique `id`, independent 32–256 character `secret`, and exactly `["work"]` calendar keys. Blank/synthetic examples are not deployment policies. Runtime constructs only `/me/calendars/<approved-id>/calendarView`, rejects a different mapping before token acquisition and provides the same five read-only tools.

Operator discovery (`npm run m365:discover -- --help`) is separate from MCP. After review and explicit authorization it can list bounded calendar IDs/names/default flags; discovery is not calendar approval and its output is private metadata. Select the exact intended ID privately, never infer approval from a default flag. This source import does not run discovery or alter policies.

## Refresh and custody

Official MSAL ConfidentialClientApplication uses the explicit secret and strict cached identity. Silent refresh has a 15-second bound and propagates cancellation through metadata/token/body work; server capacity remains held until work settles. Refreshed state is memory-only, never exported or automatically written to Doppler. Restart reuses the privately stored bootstrap snapshot. Expiry/revocation/Conditional Access may require separately authorized rebootstrap; offline access is not perpetual access.

`Calendars.ReadBasic` is broader than one service-mapped calendar. A stolen cache/client secret can exceed service policy, and shared app grants are not narrowed by this helper. Same-user/root/Docker-equivalent access defeats credential isolation. Preserve the installed deployment and provider policies until explicit cutover approval; do not rerun consent merely because source moved.
