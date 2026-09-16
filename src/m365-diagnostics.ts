// Never derive public strings from provider descriptions, claims, URLs or IDs.
const reasons = [
  "unclassified",
  "supabase_tenant",
  "supabase_provider",
  "supabase_identity_count",
  "supabase_identity_provider",
  "supabase_identity_user",
  "supabase_subject",
  "supabase_provider_id",
  "supabase_issuer",
  "supabase_object",
  "microsoft_account_missing",
  "microsoft_account_tenant",
  "microsoft_account_object",
  "microsoft_account_environment",
  "microsoft_account_username",
  "microsoft_result_tenant",
  "microsoft_claim_tenant",
  "microsoft_claim_object",
  "microsoft_audience",
  "microsoft_issuer",
  "microsoft_claim_username",
  "microsoft_access_missing",
  "microsoft_scope_missing",
  "microsoft_scope_extra",
  "supabase_get_user",
  "supabase_user_missing",
  "supabase_user_mismatch",
  "microsoft_id_missing",
  "microsoft_subject",
  "microsoft_home_account",
  "microsoft_id_expiry",
  "microsoft_id_issued_at",
  "endpoint_refused",
  "transport_failure",
  "transport_timeout",
  "response_empty",
  "response_limit",
  "response_json",
  "provider_grant_refused",
  "client_auth_required",
  "provider_other",
  "msal_token_parse",
  "msal_post_failed",
  "policy_blocked",
  "consent_required",
  "assignment_required",
  "provider_declined",
  "provider_expired",
  "provider_slow_down",
  "provider_client_refused",
] as const;
export function safeMicrosoftReason(value: unknown): string {
  return typeof value === "string" &&
    (reasons as readonly string[]).includes(value)
    ? value
    : "unclassified";
}
export function microsoftMsalReason(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "errorCode" in error &&
    error.errorCode === "post_request_failed"
  )
    return "msal_post_failed";
  if (
    error &&
    typeof error === "object" &&
    "errorCode" in error &&
    error.errorCode === "token_parsing_error"
  )
    return "msal_token_parse";
  return "unclassified";
}
// Observe the bounded JSON before MSAL DeviceCodeClient reduces all non-pending
// OAuth errors to post_request_failed, dropping structured AADSTS error_codes.
export function microsoftResponseReason(body: unknown): string {
  if (!body || typeof body !== "object") return "unclassified";
  const b = body as { error?: unknown; error_codes?: unknown };
  if (
    typeof b.error !== "string" ||
    !b.error ||
    b.error === "authorization_pending"
  )
    return "unclassified";
  if (Array.isArray(b.error_codes) && b.error_codes[0] === 7000218)
    return "client_auth_required";
  if (Array.isArray(b.error_codes)) {
    switch (b.error_codes[0]) {
      case 53003:
        return "policy_blocked";
      case 65001:
        return "consent_required";
      case 50105:
        return "assignment_required";
    }
  }
  switch (b.error) {
    case "invalid_grant":
      return "provider_grant_refused";
    case "invalid_client":
      return "provider_client_refused";
    case "authorization_declined":
      return "provider_declined";
    case "expired_token":
      return "provider_expired";
    case "slow_down":
      return "provider_slow_down";
  }
  return "provider_other";
}
