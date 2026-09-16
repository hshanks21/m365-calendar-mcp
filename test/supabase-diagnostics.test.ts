import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseSession } from "../src/supabase-bootstrap.js";
import { MicrosoftAuthorizationFailure } from "../src/m365-msal.js";
import { sdkFixture, env } from "./supabase-fixtures.js";

test("actual auth-js refuses missing provider tenant with a fixed private diagnostic", async () => {
  const f = sdkFixture();
  f.userChange({
    identities: [
      {
        ...f.identity,
        identity_data: {
          ...f.identity.identity_data,
          custom_claims: { oid: f.identity.identity_data.custom_claims.oid },
        },
      },
    ],
  });
  const s = await createSupabaseSession(
    env,
    AbortSignal.timeout(5000),
    f.fetcher,
  );
  f.challenge(new URL(s.url).searchParams.get("code_challenge")!);
  try {
    await assert.rejects(s.exchange("SYNTHETIC-code"), (e: unknown) => {
      assert.ok(e instanceof MicrosoftAuthorizationFailure);
      assert.equal(e.stage, "identity_scopes");
      assert.equal(e.reason, "supabase_tenant");
      assert.equal(e.message, "Microsoft authorization failed.");
      assert.equal(e.cause, undefined);
      return true;
    });
  } finally {
    await s.close();
  }
});

// Every case runs the installed auth-js and MSAL SDKs on synthetic transport only.
type Fixture = ReturnType<typeof sdkFixture>;
const cases: [string, (f: Fixture) => void][] = [
  [
    "supabase_identity_count",
    (f) => f.userChange({ identities: [f.identity, f.identity] }),
  ],
  ["supabase_identity_count", (f) => f.userChange({ identities: [] })],
  [
    "supabase_identity_provider",
    (f) =>
      f.userChange({
        identities: [{ ...f.identity, provider: "SYNTHETIC-private" }],
      }),
  ],
  [
    "supabase_identity_user",
    (f) =>
      f.userChange({
        identities: [{ ...f.identity, user_id: "SYNTHETIC-private" }],
      }),
  ],
  [
    "supabase_subject",
    (f) =>
      f.userChange({
        identities: [
          {
            ...f.identity,
            identity_data: { ...f.identity.identity_data, sub: "" },
          },
        ],
      }),
  ],
  [
    "supabase_provider_id",
    (f) =>
      f.userChange({
        identities: [{ ...f.identity, id: "SYNTHETIC-private" }],
      }),
  ],
  [
    "supabase_issuer",
    (f) =>
      f.userChange({
        identities: [
          {
            ...f.identity,
            identity_data: {
              ...f.identity.identity_data,
              iss: "SYNTHETIC-private",
            },
          },
        ],
      }),
  ],
  [
    "supabase_object",
    (f) =>
      f.userChange({
        identities: [
          {
            ...f.identity,
            identity_data: {
              ...f.identity.identity_data,
              custom_claims: {
                tid: env.CALENDAR_M365_DELEGATED_TENANT_ID,
                oid: "SYNTHETIC-private",
              },
            },
          },
        ],
      }),
  ],
  [
    "supabase_user_mismatch",
    (f) => f.session({ user: { ...f.user, id: "SYNTHETIC-private" } }),
  ],
  ["microsoft_account_tenant", (f) => f.claims({ tid: "SYNTHETIC-private" })],
  ["microsoft_account_object", (f) => f.claims({ oid: "SYNTHETIC-private" })],
  [
    "microsoft_account_username",
    (f) => f.claims({ preferred_username: "SYNTHETIC-private" }),
  ],
  ["microsoft_audience", (f) => f.claims({ aud: "SYNTHETIC-private" })],
  ["microsoft_issuer", (f) => f.claims({ iss: "SYNTHETIC-private" })],
  ["microsoft_subject", (f) => f.claims({ sub: "SYNTHETIC-private" })],
  ["microsoft_home_account", (f) => f.token({ client_info: undefined })],
  ["microsoft_id_expiry", (f) => f.claims({ exp: 1 })],
  ["microsoft_id_expiry", (f) => f.claims({ exp: undefined })],
  ["microsoft_id_issued_at", (f) => f.claims({ iat: undefined })],
  [
    "microsoft_id_issued_at",
    (f) => f.claims({ iat: Math.floor(Date.now() / 1000) + 3600 }),
  ],
];
for (const [reason, mutate] of cases)
  test(`SDK fixed diagnostic: ${reason}`, async () => {
    const f = sdkFixture();
    mutate(f);
    const s = await createSupabaseSession(
      env,
      AbortSignal.timeout(5000),
      f.fetcher,
    );
    f.challenge(new URL(s.url).searchParams.get("code_challenge")!);
    try {
      await assert.rejects(s.exchange("SYNTHETIC-code"), (e: unknown) => {
        assert.ok(e instanceof MicrosoftAuthorizationFailure);
        assert.deepEqual({ ...e }, { stage: "identity_scopes", reason });
        assert.equal(e.message, "Microsoft authorization failed.");
        assert.equal(e.cause, undefined);
        assert.doesNotMatch(
          String(e) + JSON.stringify(e),
          /SYNTHETIC|azure-sub|supabase-user|example|11111111|22222222|33333333/,
        );
        return true;
      });
    } finally {
      await s.close();
    }
  });
test("getUser raw transport error cannot cross diagnostic boundary", async () => {
  const f = sdkFixture();
  const s = await createSupabaseSession(
    env,
    AbortSignal.timeout(5000),
    async (url, init) => {
      if (String(url).endsWith("/auth/v1/user"))
        throw Error("SYNTHETIC-private-raw-token");
      return f.fetcher(url, init);
    },
  );
  f.challenge(new URL(s.url).searchParams.get("code_challenge")!);
  try {
    await assert.rejects(s.exchange("SYNTHETIC-code"), (e: unknown) => {
      assert.ok(e instanceof MicrosoftAuthorizationFailure);
      assert.deepEqual(
        { ...e },
        { stage: "identity_scopes", reason: "supabase_get_user" },
      );
      assert.equal(e.message, "Microsoft authorization failed.");
      assert.equal(e.cause, undefined);
      return true;
    });
  } finally {
    await s.close();
  }
});

import { verifyDelegatedResult } from "../src/m365-delegated.js";
import { loadConfidentialIdentity } from "../src/m365-confidential.js";
import { safeMicrosoftReason } from "../src/m365-diagnostics.js";
test("delegated result diagnostics distinguish every assertion without changing default rejection", async () => {
  const f = sdkFixture();
  const s = await createSupabaseSession(
    env,
    AbortSignal.timeout(5000),
    f.fetcher,
  );
  f.challenge(new URL(s.url).searchParams.get("code_challenge")!);
  const { result } = await s.exchange("SYNTHETIC-code");
  const c = loadConfidentialIdentity(env);
  const cases: [string, (r: any) => void][] = [
    ["microsoft_account_missing", (r) => (r.account = null)],
    ["microsoft_account_tenant", (r) => (r.account.tenantId = "private")],
    ["microsoft_account_object", (r) => (r.account.localAccountId = "private")],
    [
      "microsoft_account_environment",
      (r) => (r.account.environment = "private"),
    ],
    ["microsoft_account_username", (r) => (r.account.username = "private")],
    ["microsoft_result_tenant", (r) => (r.tenantId = "private")],
    ["microsoft_claim_tenant", (r) => (r.idTokenClaims.tid = "private")],
    ["microsoft_claim_object", (r) => (r.idTokenClaims.oid = "private")],
    ["microsoft_audience", (r) => (r.idTokenClaims.aud = "private")],
    ["microsoft_issuer", (r) => (r.idTokenClaims.iss = "private")],
    [
      "microsoft_claim_username",
      (r) => (r.idTokenClaims.preferred_username = "private"),
    ],
    ["microsoft_access_missing", (r) => (r.accessToken = "")],
    ["microsoft_scope_missing", (r) => (r.scopes = [])],
    ["microsoft_scope_extra", (r) => r.scopes.push("Mail.Read")],
  ];
  for (const [expected, change] of cases) {
    const r = structuredClone(result);
    change(r);
    let reason = "unclassified";
    assert.throws(() =>
      verifyDelegatedResult(c, r, (value: string) => {
        reason = value;
      }),
    );
    assert.equal(reason, expected);
    assert.equal(safeMicrosoftReason(reason), expected);
    assert.throws(
      () => verifyDelegatedResult(c, r),
      /Microsoft delegated identity or scope mismatch/,
    );
  }
  assert.equal(
    safeMicrosoftReason("SYNTHETIC-private-raw-token"),
    "unclassified",
  );
});
