import { createHash } from "node:crypto";
export const tenant = "11111111-1111-4111-8111-111111111111";
export const client = "22222222-2222-4222-8222-222222222222";
export const oid = "33333333-3333-4333-8333-333333333333";
export const origin = "https://abcdefghijklmnopqrst.supabase.co";
export const env = {
  CALENDAR_M365_DELEGATED_TENANT_ID: tenant,
  CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: "owner@example.invalid",
  CALENDAR_M365_DELEGATED_CLIENT_ID: client,
  CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID: oid,
  CALENDAR_M365_DELEGATED_CLIENT_SECRET: "SYNTHETIC-secret",
  CALENDAR_SUPABASE_URL: origin,
  CALENDAR_SUPABASE_ALLOWED_ORIGIN: origin,
  CALENDAR_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SYNTHETIC-only",
};
export function sdkFixture(settings = env) {
  const tenant = settings.CALENDAR_M365_DELEGATED_TENANT_ID;
  const client = settings.CALENDAR_M365_DELEGATED_CLIENT_ID;
  const oid = settings.CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID;
  const origin = settings.CALENDAR_SUPABASE_ALLOWED_ORIGIN;
  const forms: URLSearchParams[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  let claimChange: Record<string, unknown> = {};
  let tokenChange: Record<string, unknown> = {};
  const identity = {
    provider: "azure",
    id: "azure-sub",
    identity_id: "fixture-identity",
    user_id: "supabase-user",
    identity_data: {
      sub: "azure-sub",
      provider_id: "azure-sub",
      iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
      custom_claims: { tid: tenant, oid },
    },
  };
  const user = {
    id: "supabase-user",
    aud: "authenticated",
    app_metadata: { provider: "azure", providers: ["azure"] },
    user_metadata: {},
    identities: [identity],
    created_at: "2026-01-01T00:00:00Z",
  };
  let userChange: Record<string, unknown> = {};
  let sessionChange: Record<string, unknown> = {};
  let challenge = "";
  const json = (v: unknown) =>
    new Response(JSON.stringify(v), {
      headers: { "Content-Type": "application/json" },
    });
  const fetcher: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    requests.push({ url: u.href, init });
    if (u.origin === origin) {
      if (u.pathname === "/auth/v1/user")
        return json({ ...user, ...userChange });
      if (u.pathname === "/auth/v1/token" && u.search === "?grant_type=pkce") {
        const b = JSON.parse(String(init?.body));
        if (
          b.auth_code !== "SYNTHETIC-code" ||
          createHash("sha256").update(b.code_verifier).digest("base64url") !==
            challenge
        )
          return new Response("{}", { status: 400 });
        return json({
          access_token: "SYNTHETIC-supabase-access",
          refresh_token: "SYNTHETIC-supabase-refresh",
          provider_token: "SYNTHETIC-graph-unused",
          provider_refresh_token: "SYNTHETIC-provider-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: { ...user, ...userChange },
          ...sessionChange,
        });
      }
      throw Error("unexpected synthetic Supabase route");
    }
    if (u.origin !== "https://login.microsoftonline.com")
      throw Error("external fixture request refused");
    if (u.pathname.endsWith("openid-configuration"))
      return json({
        authorization_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        token_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        jwks_uri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
      });
    forms.push(new URLSearchParams(String(init?.body)));
    const claims = {
      tid: tenant,
      oid,
      aud: client,
      iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
      sub: "azure-sub",
      preferred_username: settings.CALENDAR_M365_DELEGATED_EXPECTED_USERNAME,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claimChange,
    };
    const jwt =
      [{ alg: "RS256", typ: "JWT" }, claims]
        .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
        .join(".") + ".SYNTHETIC-signature";
    return json({
      token_type: "Bearer",
      scope: "Calendars.ReadBasic",
      expires_in: 3600,
      access_token: "SYNTHETIC-access",
      refresh_token: "SYNTHETIC-refresh",
      id_token: jwt,
      client_info: Buffer.from(
        JSON.stringify({ uid: oid, utid: tenant }),
      ).toString("base64url"),
      ...tokenChange,
    });
  };
  return {
    forms,
    requests,
    fetcher,
    user,
    identity,
    challenge: (v: string) => (challenge = v),
    claims: (v: Record<string, unknown>) => (claimChange = v),
    token: (v: Record<string, unknown>) => (tokenChange = v),
    userChange: (v: Record<string, unknown>) => (userChange = v),
    session: (v: Record<string, unknown>) => (sessionChange = v),
  };
}
