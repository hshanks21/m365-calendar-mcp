import test from "node:test";
import assert from "node:assert/strict";
import { AuthClient } from "@supabase/auth-js";
import {
  createConfidentialClient,
  confidentialNetwork,
  loadConfidentialIdentity,
} from "../src/m365-confidential.js";
import { serializedOfflineCache } from "../src/m365-msal.js";
import { verifyDelegatedResult } from "../src/m365-delegated.js";
import { sdkFixture, env, origin } from "./supabase-fixtures.js";
test("SDK investigation: persistSession false uses internal ephemeral PKCE memory, not supplied storage", async () => {
  const f = sdkFixture();
  let external = 0;
  const auth = new AuthClient({
    url: origin + "/auth/v1",
    headers: { apikey: env.CALENDAR_SUPABASE_PUBLISHABLE_KEY },
    flowType: "pkce",
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    fetch: f.fetcher,
    storage: {
      getItem: () => {
        external++;
        return null;
      },
      setItem: () => {
        external++;
      },
      removeItem: () => {
        external++;
      },
    },
  });
  const { data, error } = await auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: "http://localhost:8766/supabase/callback?state=fixture",
      scopes:
        "openid profile email offline_access https://graph.microsoft.com/Calendars.ReadBasic",
      skipBrowserRedirect: true,
    },
  });
  assert.equal(error, null);
  const u = new URL(data.url!);
  f.challenge(u.searchParams.get("code_challenge")!);
  const exchanged = await auth.exchangeCodeForSession("SYNTHETIC-code");
  assert.equal(exchanged.error, null);
  assert.equal(
    exchanged.data.session?.provider_refresh_token,
    "SYNTHETIC-provider-refresh",
  );
  assert.equal(external, 0);
  const fresh = new AuthClient({
    url: origin + "/auth/v1",
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: "pkce",
    fetch: f.fetcher,
  });
  assert.notEqual(
    (await fresh.exchangeCodeForSession("SYNTHETIC-code")).error,
    null,
  );
});
test("SDK investigation: imported refresh needs forceCache; fresh ID claims and client_info populate real MSAL cache", async () => {
  const f = sdkFixture(),
    c = loadConfidentialIdentity(env);
  const make = () =>
    createConfidentialClient(c, confidentialNetwork(c, f.fetcher));
  const without = make();
  const result = await without.acquireTokenByRefreshToken({
    refreshToken: "SYNTHETIC-provider-refresh",
    scopes: [
      "https://graph.microsoft.com/Calendars.ReadBasic",
      "openid",
      "profile",
      "email",
      "offline_access",
    ],
  });
  verifyDelegatedResult(c, result);
  assert.throws(() => serializedOfflineCache(without));
  const cca = make();
  const r = await cca.acquireTokenByRefreshToken({
    refreshToken: "SYNTHETIC-provider-refresh",
    scopes: [
      "https://graph.microsoft.com/Calendars.ReadBasic",
      "openid",
      "profile",
      "email",
      "offline_access",
    ],
    forceCache: true,
  });
  verifyDelegatedResult(c, r);
  const cache = serializedOfflineCache(cca);
  assert.ok(cache.includes("SYNTHETIC-refresh"));
  assert.equal(f.forms[1].get("grant_type"), "refresh_token");
  assert.equal(f.forms[1].get("client_secret"), "SYNTHETIC-secret");
  for (const change of [{ id_token: undefined }, { client_info: undefined }]) {
    f.token(change);
    const next = make();
    const v = await next.acquireTokenByRefreshToken({
      refreshToken: "SYNTHETIC-provider-refresh",
      scopes: ["https://graph.microsoft.com/Calendars.ReadBasic"],
      forceCache: true,
    });
    if ("id_token" in change)
      assert.throws(() => {
        verifyDelegatedResult(c, v);
        serializedOfflineCache(next);
      });
    else {
      verifyDelegatedResult(c, v);
      serializedOfflineCache(next);
      assert.notEqual(v?.account?.homeAccountId, `${c.objectId}.${c.tenantId}`);
    }
  }
});
