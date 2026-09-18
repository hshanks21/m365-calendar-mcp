import { startSupabaseCallback } from "./supabase-callback.js";
export { startSupabaseCallback };
import { runMicrosoftBootstrap } from "./m365-oauth.js";
import type { PrivateRunner } from "./google-oauth.js";
const HELP =
  "Usage: npm run m365:oauth:supabase -- --authorize [--timeout-seconds 300]. Dev-only Supabase PKCE, exact callback http://localhost:8766/supabase/callback. Requires private app compatibility checks and temporary scoped Doppler writer. Replaces only CALENDAR_M365_DELEGATED_MSAL_CACHE. See M365_SUPABASE.md.";
export async function runSupabaseBootstrap(
  args: string[],
  env: NodeJS.ProcessEnv,
  deps: {
    fetcher?: typeof fetch;
    runner?: PrivateRunner;
    log?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
) {
  if (args.length === 1 && args[0] === "--help")
    return { ok: true, message: HELP };
  try {
    loadSupabaseIdentity(env);
  } catch {
    return {
      ok: false,
      message: "Supabase bootstrap refused [stage=configuration]. " + HELP,
    };
  }
  return runMicrosoftBootstrap(args, env, {
    ...deps,
    help: HELP,
    authorize: async (_identity, signal, log) => {
      let session:
        Awaited<ReturnType<typeof createSupabaseSession>> | undefined;
      let callback:
        Awaited<ReturnType<typeof startSupabaseCallback>> | undefined;
      let stage = "authorization_start";
      try {
        session = await createSupabaseSession(env, signal, deps.fetcher);
        stage = "callback";
        callback = await startSupabaseCallback(
          session.url,
          signal,
          session.supabaseOrigin,
        );
        signal.throwIfAborted();
        log(
          "Open this one-use local start URL in your own browser with the SSH tunnel active. No callback URLs or credentials in chat. Check this terminal for storage status.",
        );
        log(callback.url);
        const code = await callback.code;
        signal.throwIfAborted();
        return await session.exchange(code);
      } catch (error) {
        throw error instanceof MicrosoftAuthorizationFailure
          ? error
          : new MicrosoftAuthorizationFailure(stage);
      } finally {
        await callback?.close();
        await session?.close();
      }
    },
  });
}
import { AuthClient, type User } from "@supabase/auth-js";
import {
  loadConfidentialIdentity,
  createConfidentialClient,
  confidentialNetwork,
  type ConfidentialIdentity,
} from "./m365-confidential.js";
import { verifyDelegatedResult } from "./m365-delegated.js";
import {
  serializedOfflineCache,
  MicrosoftAuthorizationFailure,
} from "./m365-msal.js";
// Operator-owned approval boundary; never accept a caller/returned URL as the pin.
export function validateSupabaseOrigin(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(value)
  )
    throw Error("Invalid dedicated Supabase origin.");
  return value;
}
export const SUPABASE_REDIRECT = "http://localhost:8766/supabase/callback";
export const SUPABASE_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/Calendars.ReadBasic",
];
// Auth-js ignores custom storage with persistSession:false. Use its per-instance
// memory storage, and explicitly discard it on every exit. Never call signOut:
// even a local signOut makes a remote request in some SDK versions.
class EphemeralAuth extends AuthClient {
  async discard() {
    await this.stopAutoRefresh();
    for (const key of Object.keys(this.memoryStorage ?? {}))
      await this.storage.removeItem(key);
  }
}
export function loadSupabaseIdentity(env: NodeJS.ProcessEnv) {
  const c = loadConfidentialIdentity(env);
  const supabaseOrigin = validateSupabaseOrigin(
    env.CALENDAR_SUPABASE_ALLOWED_ORIGIN,
  );
  if (
    Object.keys(env).some(
      (key) =>
        env[key] !== undefined &&
        key.startsWith("CALENDAR_SUPABASE_") &&
        ![
          "CALENDAR_SUPABASE_URL",
          "CALENDAR_SUPABASE_ALLOWED_ORIGIN",
          "CALENDAR_SUPABASE_PUBLISHABLE_KEY",
        ].includes(key),
    ) ||
    env.CALENDAR_SUPABASE_URL !== supabaseOrigin ||
    !/^sb_publishable_[A-Za-z0-9_-]{8,256}$/.test(
      env.CALENDAR_SUPABASE_PUBLISHABLE_KEY ?? "",
    )
  )
    throw Error("Invalid dedicated Supabase configuration.");
  return {
    ...c,
    supabaseOrigin,
    publishableKey: env.CALENDAR_SUPABASE_PUBLISHABLE_KEY!,
  };
}
// Only SDK code exchange and authenticated user verification may use this seam.
// Fixed error responses prevent the SDK from logging rejected transport errors.
export function supabaseNetwork(
  allowedOrigin: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  const origin = validateSupabaseOrigin(allowedOrigin);
  return async (input, init) => {
    try {
      signal.throwIfAborted();
      const url = String(input),
        method = init?.method ?? "GET";
      if (!(
        (method === "POST" &&
          url === origin + "/auth/v1/token?grant_type=pkce") ||
        (method === "GET" && url === origin + "/auth/v1/user")
      ))
        throw Error();
      const response = await fetcher(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw Error();
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 262144) throw Error();
        chunks.push(chunk);
      }
      signal.throwIfAborted();
      return new Response(Buffer.concat(chunks), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response('{"error":"bootstrap_request_refused"}', {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
function identityFailure(reason: string): never {
  throw new MicrosoftAuthorizationFailure("identity_scopes", reason);
}
function providerIdentity(c: ConfidentialIdentity, user: User) {
  // app_metadata.provider is the original signup provider, not this login.
  // Select from authenticated, provider-owned identities, never user_metadata.
  // Count ALL Azure identities before checking pins: do not choose a matching
  // account from an ambiguous set. Other linked providers are not Azure evidence.
  if (!user.identities?.length) identityFailure("supabase_identity_count");
  const identities = user.identities.filter((i) => i.provider === "azure");
  if (!identities.length) identityFailure("supabase_identity_provider");
  if (identities.length !== 1) identityFailure("supabase_identity_count");
  const identity = identities[0],
    claims = identity.identity_data;
  if (identity.user_id !== user.id) identityFailure("supabase_identity_user");
  if (typeof claims?.sub !== "string" || !claims.sub)
    identityFailure("supabase_subject");
  if (identity.id !== claims.sub) identityFailure("supabase_provider_id");
  if (claims.iss !== `${c.authority}/v2.0`) identityFailure("supabase_issuer");
  if (claims.custom_claims?.tid !== c.tenantId)
    identityFailure("supabase_tenant");
  if (claims.custom_claims?.oid !== c.objectId)
    identityFailure("supabase_object");
  return claims!.sub as string;
}
export async function createSupabaseSession(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const c = loadSupabaseIdentity(env);
  signal.throwIfAborted();
  const auth = new EphemeralAuth({
    url: c.supabaseOrigin + "/auth/v1",
    headers: { apikey: c.publishableKey },
    storageKey: "calendar-bootstrap",
    flowType: "pkce",
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    debug: false,
    fetch: supabaseNetwork(c.supabaseOrigin, signal, fetcher),
  });
  let consumed = false;
  const close = async () => {
    consumed = true;
    await auth.discard();
  };
  try {
    const { data, error } = await auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: SUPABASE_REDIRECT,
        scopes: SUPABASE_SCOPES.join(" "),
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) throw Error();
    signal.throwIfAborted();
    return {
      supabaseOrigin: c.supabaseOrigin,
      url: data.url,
      close,
      exchange: async (code: string) => {
        let stage = "token_exchange";
        try {
          if (consumed) throw Error();
          consumed = true;
          signal.throwIfAborted();
          const exchanged = await auth.exchangeCodeForSession(code);
          signal.throwIfAborted();
          const session = exchanged.data.session;
          if (
            exchanged.error ||
            !session ||
            typeof session.provider_refresh_token !== "string" ||
            !/^[\x21-\x7e]{1,16384}$/.test(session.provider_refresh_token)
          )
            throw Error();
          stage = "identity_scopes";
          const verified = await auth
            .getUser(session.access_token)
            .catch(() => identityFailure("supabase_get_user"));
          signal.throwIfAborted();
          if (verified.error) identityFailure("supabase_get_user");
          if (!verified.data.user) identityFailure("supabase_user_missing");
          if (verified.data.user.id !== session.user.id)
            identityFailure("supabase_user_mismatch");
          const sub = providerIdentity(c, verified.data.user);
          stage = "token_exchange";
          const network = confidentialNetwork(c, fetcher, signal);
          const cca = createConfidentialClient(c, {
            sendGetRequestAsync: network.sendGetRequestAsync,
            sendPostRequestAsync: async <T>(
              url: string,
              options?: import("@azure/msal-node").NetworkRequestOptions,
            ) => {
              const response = await network.sendPostRequestAsync<T>(
                url,
                options,
              );
              const scope = (response.body as Record<string, unknown>)?.scope;
              // MSAL can substitute request scopes when the response omits scope.
              // Require affirmative response scope evidence before cache construction.
              if (typeof scope !== "string" || !scope.trim()) throw Error();
              const granted = scope.toLowerCase().split(/\s+/);
              const allowed = new Set([
                ...SUPABASE_SCOPES.map((s) => s.toLowerCase()),
                "calendars.readbasic",
              ]);
              if (
                !granted.some(
                  (s) =>
                    s === "calendars.readbasic" ||
                    s === "https://graph.microsoft.com/calendars.readbasic",
                ) ||
                granted.some((s) => !allowed.has(s))
              )
                throw Error();
              return response;
            },
          });
          const result = await cca.acquireTokenByRefreshToken({
            refreshToken: session.provider_refresh_token,
            scopes: [...SUPABASE_SCOPES],
            forceCache: true,
          });
          signal.throwIfAborted();
          stage = "identity_scopes";
          verifyDelegatedResult(c, result, identityFailure);
          const claims = result?.idTokenClaims as
            Record<string, unknown> | undefined;
          const now = Math.floor(Date.now() / 1000);
          if (!result?.idToken) identityFailure("microsoft_id_missing");
          if (claims?.sub !== sub) identityFailure("microsoft_subject");
          if (result.account?.homeAccountId !== `${c.objectId}.${c.tenantId}`)
            identityFailure("microsoft_home_account");
          if (typeof claims?.exp !== "number" || claims.exp <= now)
            identityFailure("microsoft_id_expiry");
          if (typeof claims?.iat !== "number" || claims.iat > now + 300)
            identityFailure("microsoft_id_issued_at");
          stage = "cache_validation";
          return { result, cache: serializedOfflineCache(cca) };
        } catch (error) {
          throw error instanceof MicrosoftAuthorizationFailure
            ? error
            : new MicrosoftAuthorizationFailure(stage);
        } finally {
          await close();
        }
      },
    };
  } catch {
    await close();
    throw new MicrosoftAuthorizationFailure("authorization_start");
  }
}
