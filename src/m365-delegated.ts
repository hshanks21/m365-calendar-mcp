import type {
  AuthenticationResult,
  PublicClientApplication,
} from "@azure/msal-node";
import { createMicrosoftClient } from "./m365-msal.js";
export function silentToken(
  c: DelegatedIdentity,
  serialized: string,
  pca: Pick<
    PublicClientApplication,
    "getTokenCache" | "acquireTokenSilent"
  > = createMicrosoftClient(c),
) {
  try {
    if (!serialized || Buffer.byteLength(serialized) > 60000) throw Error();
    pca.getTokenCache().deserialize(serialized);
  } catch {
    throw Error("Invalid dedicated Microsoft delegated cache.");
  }
  return async (signal?: AbortSignal): Promise<string> => {
    try {
      signal?.throwIfAborted();
      const accounts = await pca.getTokenCache().getAllAccounts();
      if (accounts.length !== 1) throw Error();
      const a = accounts[0];
      if (
        a.tenantId !== c.tenantId ||
        a.localAccountId !== c.objectId ||
        a.username.toLowerCase() !== EXPECTED_ACCOUNT ||
        a.environment !== "login.microsoftonline.com"
      )
        throw Error();
      const r = await pca.acquireTokenSilent({
        account: a,
        scopes: ["Calendars.ReadBasic"],
      });
      signal?.throwIfAborted();
      verifyDelegatedResult(c, r);
      return r.accessToken;
    } catch {
      throw Error("interaction_required");
    }
  };
}
import { z } from "zod";
import { policy } from "./config.js";
import { Graph } from "./graph.js";
export function loadDelegatedConfig(env: NodeJS.ProcessEnv) {
  try {
    const identity = loadDelegatedIdentity(env);
    const cache = z
      .string()
      .min(1)
      .max(60000)
      .parse(env.CALENDAR_M365_DELEGATED_MSAL_CACHE);
    const p = policy.parse(
      JSON.parse(env.CALENDAR_M365_DELEGATED_POLICY_JSON ?? ""),
    );
    if (
      Object.keys(p.calendars).length !== 1 ||
      !p.calendars.work ||
      p.calendars.work.mailbox !== EXPECTED_ACCOUNT ||
      new Set(p.clients.map((c) => c.id)).size !== p.clients.length ||
      new Set(p.clients.map((c) => c.secret)).size !== p.clients.length ||
      p.clients.some(
        (c) => c.calendarKeys.length !== 1 || c.calendarKeys[0] !== "work",
      )
    )
      throw Error();
    return { ...identity, ...p, cache };
  } catch {
    throw Error("Invalid dedicated Microsoft delegated cache or work policy.");
  }
}
export function createDelegatedReader(
  c: ReturnType<typeof loadDelegatedConfig>,
) {
  return new Graph({
    token: silentToken(c, c.cache),
    delegated: { ...c.calendars.work },
  });
}

export const EXPECTED_ACCOUNT = "owner@example.invalid";
export const DELEGATED_SCOPES = [
  "https://graph.microsoft.com/Calendars.ReadBasic",
  "offline_access",
];
export function loadDelegatedIdentity(env: NodeJS.ProcessEnv) {
  try {
    const tenantId = z
      .string()
      .uuid()
      .parse(env.CALENDAR_M365_DELEGATED_TENANT_ID);
    const clientId = z
      .string()
      .uuid()
      .parse(env.CALENDAR_M365_DELEGATED_CLIENT_ID);
    const objectId = z
      .string()
      .uuid()
      .parse(env.CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID);
    return {
      tenantId,
      clientId,
      objectId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    };
  } catch {
    throw Error(
      "Invalid dedicated Microsoft delegated identity configuration.",
    );
  }
}
export type DelegatedIdentity = ReturnType<typeof loadDelegatedIdentity>;
export function verifyDelegatedResult(
  c: DelegatedIdentity,
  r: AuthenticationResult | null,
  diagnose: (reason: string) => void = () => {},
) {
  const a = r?.account,
    claims = r?.idTokenClaims as Record<string, unknown> | undefined;
  const allowed = new Set([
    "calendars.readbasic",
    "https://graph.microsoft.com/calendars.readbasic",
    "openid",
    "email", // Azure Supabase bootstrap requires this OIDC identity scope.
    "profile",
    "offline_access",
  ]);
  function refuse(reason: string): never {
    diagnose(reason);
    throw Error("Microsoft delegated identity or scope mismatch.");
  }
  if (!a) refuse("microsoft_account_missing");
  if (a.tenantId !== c.tenantId) refuse("microsoft_account_tenant");
  if (a.localAccountId !== c.objectId) refuse("microsoft_account_object");
  if (a.environment !== "login.microsoftonline.com")
    refuse("microsoft_account_environment");
  if (a.username.toLowerCase() !== EXPECTED_ACCOUNT)
    refuse("microsoft_account_username");
  if (r?.tenantId !== c.tenantId) refuse("microsoft_result_tenant");
  if (claims?.tid !== c.tenantId) refuse("microsoft_claim_tenant");
  if (claims?.oid !== c.objectId) refuse("microsoft_claim_object");
  if (claims?.aud !== c.clientId) refuse("microsoft_audience");
  if (claims?.iss !== `${c.authority}/v2.0`) refuse("microsoft_issuer");
  if (
    typeof claims?.preferred_username !== "string" ||
    claims.preferred_username.toLowerCase() !== EXPECTED_ACCOUNT
  )
    refuse("microsoft_claim_username");
  if (!r!.accessToken) refuse("microsoft_access_missing");
  if (!r!.scopes.some((s) => s.toLowerCase().endsWith("calendars.readbasic")))
    refuse("microsoft_scope_missing");
  if (r!.scopes.some((s) => !allowed.has(s.toLowerCase())))
    refuse("microsoft_scope_extra");
}
