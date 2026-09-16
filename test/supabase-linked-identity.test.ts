import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseSession } from "../src/supabase-bootstrap.js";
import { sdkFixture, env } from "./supabase-fixtures.js";
import { MicrosoftAuthorizationFailure } from "../src/m365-msal.js";

type LinkedFixture = ReturnType<typeof linkedFixture>;
const rejections: [string, string, (v: LinkedFixture) => void][] = [
  ["duplicate Azure", "supabase_identity_count", ({ f, linked }) =>
    f.userChange({ ...linked, identities: [...linked.identities, f.identity] })],
  ["one matching and one foreign Azure", "supabase_identity_count", ({ f, linked }) =>
    f.userChange({ ...linked, identities: [...linked.identities, { ...f.identity, user_id: "foreign-user", id: "foreign-sub" }] })],
  ["only editable metadata and email evidence", "supabase_identity_provider", ({ f, linked, email }) =>
    f.userChange({ ...linked, identities: [email], user_metadata: f.identity.identity_data })],
  ["foreign Azure user", "supabase_identity_user", ({ f }) => { f.identity.user_id = "foreign-user"; }],
  ["provider id mismatch", "supabase_provider_id", ({ f }) => { f.identity.id = "foreign-sub"; }],
  ["missing subject", "supabase_subject", ({ f }) => { f.identity.identity_data.sub = ""; }],
  ["foreign issuer", "supabase_issuer", ({ f }) => { f.identity.identity_data.iss = "https://evil.invalid"; }],
  ["foreign tenant", "supabase_tenant", ({ f }) => { f.identity.identity_data.custom_claims.tid = "foreign-tenant"; }],
  ["foreign object despite matching editable metadata", "supabase_object", ({ f, linked }) => {
    const good = structuredClone(f.identity.identity_data);
    f.identity.identity_data.custom_claims.oid = "foreign-object";
    f.userChange({ ...linked, user_metadata: good });
  }],
  ["session user switch", "supabase_user_mismatch", ({ f }) => f.session({ user: { ...f.user, id: "foreign-user" } })],
  ["Microsoft subject switch", "microsoft_subject", ({ f }) => f.claims({ sub: "foreign-sub" })],
  ["Microsoft tenant switch", "microsoft_account_tenant", ({ f }) => f.claims({ tid: "foreign-tenant" })],
  ["Microsoft object switch", "microsoft_account_object", ({ f }) => f.claims({ oid: "foreign-object" })],
  ["Microsoft audience switch", "microsoft_audience", ({ f }) => f.claims({ aud: "foreign-client" })],
  ["Microsoft issuer switch", "microsoft_issuer", ({ f }) => f.claims({ iss: "https://evil.invalid" })],
];
for (const [label, reason, mutate] of rejections)
  test(`linked account refuses ${label}`, async () => {
    const fixture = linkedFixture();
    mutate(fixture);
    const { f } = fixture;
    const s = await createSupabaseSession(env, AbortSignal.timeout(5000), f.fetcher);
    try {
      f.challenge(new URL(s.url).searchParams.get("code_challenge")!);
      await assert.rejects(s.exchange("SYNTHETIC-code"), (error: unknown) => {
        assert.ok(error instanceof MicrosoftAuthorizationFailure);
        assert.equal(error.reason, reason);
        assert.equal(error.stage, "identity_scopes");
        return true;
      });
      assert.equal(f.forms.length, reason.startsWith("supabase_") ? 0 : 1);
    } finally {
      await s.close();
    }
  });

// Synthetic, documented schema; not an observation of the live account.
function linkedFixture() {
  const f = sdkFixture();
  const email = {
    provider: "email",
    id: f.user.id,
    identity_id: "SYNTHETIC-email-identity",
    user_id: f.user.id,
    identity_data: { sub: f.user.id, email: "SYNTHETIC@example.invalid" },
  };
  const linked = {
    ...f.user,
    app_metadata: { provider: "email", providers: ["email", "azure"] },
    identities: [email, f.identity],
  };
  f.userChange(linked);
  return { f, linked, email };
}

test("original email signup plus linked Azure authorizes only the pinned Microsoft account", async () => {
  for (const reverse of [false, true]) {
    const { f, linked } = linkedFixture();
    if (reverse) f.userChange({ ...linked, identities: [...linked.identities].reverse() });
    const s = await createSupabaseSession(env, AbortSignal.timeout(5000), f.fetcher);
    try {
      const url = new URL(s.url);
      assert.equal(url.searchParams.get("provider"), "azure");
      assert.equal(url.searchParams.get("code_challenge_method"), "s256");
      f.challenge(url.searchParams.get("code_challenge")!);
      const result = await s.exchange("SYNTHETIC-code");
      assert.ok(result.cache.includes("SYNTHETIC-refresh"));
      assert.equal(f.forms.length, 1);
      const verified = f.requests.find((r) => r.url.endsWith("/auth/v1/user"));
      assert.equal(new Headers(verified?.init?.headers).get("Authorization"), "Bearer SYNTHETIC-supabase-access");
      await assert.rejects(s.exchange("SYNTHETIC-code"));
    } finally {
      await s.close();
    }
  }
});
