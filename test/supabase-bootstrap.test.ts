import test from "node:test";
import assert from "node:assert/strict";
import { sdkFixture, env, origin } from "./supabase-fixtures.js";
test("refresh token scope must be explicitly returned; email is permitted identity scope but no extra resource", async () => {
  const m = await api();
  for (const scope of [
    undefined,
    "",
    "Calendars.ReadBasic email",
    "Calendars.ReadBasic Mail.Read",
  ]) {
    const f = sdkFixture();
    f.token({ scope });
    const s = await m.createSupabaseSession(
      env,
      AbortSignal.timeout(5000),
      f.fetcher,
    );
    f.challenge(new URL(s.url).searchParams.get("code_challenge")!);
    if (scope === "Calendars.ReadBasic email")
      assert.ok((await s.exchange("SYNTHETIC-code")).cache);
    else await assert.rejects(s.exchange("SYNTHETIC-code"));
    await s.close();
  }
});
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("standalone CLI help is credential-free and invalid invocation cannot start auth", async () => {
  const run = promisify(execFile);
  const help = await run(
    process.execPath,
    ["--import", "tsx", "src/supabase-cli.ts", "--help"],
    { env: { PATH: process.env.PATH }, timeout: 5000 },
  );
  assert.match(help.stdout, /http:\/\/localhost:8766\/supabase\/callback/);
  await assert.rejects(
    run(process.execPath, ["--import", "tsx", "src/supabase-cli.ts"], {
      env: { PATH: process.env.PATH },
      timeout: 5000,
    }),
    (e: any) => e.code === 1 && e.stderr.includes("stage=configuration"),
  );
});
test("provider-owned Azure identity and fresh Microsoft issuer/audience/account claims fail closed; editable metadata cannot authorize", async () => {
  const m = await api();
  const cases: [string, (f: ReturnType<typeof sdkFixture>) => void][] = [
    [
      "metadata-only",
      (f) =>
        f.userChange({
          identities: [],
          user_metadata: { ...f.identity.identity_data },
        }),
    ],
    [
      "wrong-provider",
      (f) =>
        f.userChange({ identities: [{ ...f.identity, provider: "google" }] }),
    ],
    [
      "missing-custom",
      (f) =>
        f.userChange({
          identities: [{ ...f.identity, identity_data: { sub: "azure-sub" } }],
        }),
    ],
    [
      "tenant",
      (f) =>
        f.userChange({
          identities: [
            {
              ...f.identity,
              identity_data: {
                ...f.identity.identity_data,
                custom_claims: {
                  tid: "wrong",
                  oid: env.CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID,
                },
              },
            },
          ],
        }),
    ],
    [
      "object",
      (f) =>
        f.userChange({
          identities: [
            {
              ...f.identity,
              identity_data: {
                ...f.identity.identity_data,
                custom_claims: {
                  tid: env.CALENDAR_M365_DELEGATED_TENANT_ID,
                  oid: "wrong",
                },
              },
            },
          ],
        }),
    ],
    [
      "duplicate-identity",
      (f) => f.userChange({ identities: [f.identity, f.identity] }),
    ],
    [
      "identity-user",
      (f) =>
        f.userChange({ identities: [{ ...f.identity, user_id: "wrong" }] }),
    ],
    [
      "provider-refresh",
      (f) => f.session({ provider_refresh_token: undefined }),
    ],
    ...["tid", "oid", "aud", "iss", "sub", "preferred_username"].map(
      (k) =>
        [
          k,
          (f: ReturnType<typeof sdkFixture>) => f.claims({ [k]: "wrong" }),
        ] as [string, (f: ReturnType<typeof sdkFixture>) => void],
    ),
    ["expired-id", (f) => f.claims({ exp: 1 })],
    ["missing-id", (f) => f.token({ id_token: undefined })],
    ["missing-client-info", (f) => f.token({ client_info: undefined })],
    ["missing-refresh", (f) => f.token({ refresh_token: undefined })],
    ["missing-scopes", (f) => f.token({ scope: undefined })],
    ["extra-scope", (f) => f.token({ scope: "Calendars.ReadBasic User.Read" })],
  ];
  for (const [label, change] of cases) {
    const f = sdkFixture();
    change(f);
    const s = await m.createSupabaseSession(
      env,
      AbortSignal.timeout(5000),
      f.fetcher,
    );
    f.challenge(new URL(s.url).searchParams.get("code_challenge")!);
    await assert.rejects(s.exchange("SYNTHETIC-code"), label);
    await s.close();
  }
});
test("dev host and publishable-only configuration fails before network; generic keys never substitute", async () => {
  const m = await api();
  for (const bad of [
    { CALENDAR_SUPABASE_URL: "https://production.supabase.co" },
    { CALENDAR_SUPABASE_URL: origin + "/" },
    { CALENDAR_SUPABASE_PUBLISHABLE_KEY: "sb_secret_SYNTHETIC" },
    { CALENDAR_SUPABASE_PUBLISHABLE_KEY: "SYNTHETIC-legacy-jwt-key" },
    {
      CALENDAR_M365_DELEGATED_CLIENT_SECRET: undefined,
      M365_SECRET: "SYNTHETIC-generic",
    },
  ]) {
    await assert.rejects(
      m.createSupabaseSession(
        { ...env, ...bad },
        AbortSignal.timeout(1000),
        async () => {
          assert.fail("network must not run");
        },
      ),
    );
  }
});
test("Supabase transport rejects foreign routes, redirects, excessive body, malformed JSON and cancels actual body reads", async () => {
  const m = await api();
  let requests = 0;
  const network = m.supabaseNetwork(AbortSignal.timeout(5000), async () => {
    requests++;
    return new Response("{}");
  });
  for (const u of [
    origin + "/rest/v1/users",
    origin + "/auth/v1/token?grant_type=refresh_token",
    origin + "/auth/v1/user#fragment",
    "https://evil.invalid/auth/v1/user",
  ])
    assert.equal((await network(u)).status, 400);
  assert.equal(requests, 0);
  for (const response of [
    new Response("x".repeat(262145)),
    new Response("", {
      status: 302,
      headers: { Location: "https://evil.invalid" },
    }),
  ])
    assert.equal(
      (
        await m.supabaseNetwork(
          AbortSignal.timeout(5000),
          async () => response,
        )(origin + "/auth/v1/user")
      ).status,
      400,
    );
  const { fixture } = await import("./fixtures.js");
  let closed!: () => void;
  const peerClosed = new Promise<void>((r) => (closed = r));
  const f = await fixture((_req: any, res: any) => {
    res.writeHead(200);
    res.write("{");
    res.once("close", closed);
  });
  try {
    const bounded = m.supabaseNetwork(
      AbortSignal.timeout(50),
      (_url: any, init: any) => fetch(f.url, init),
    );
    assert.equal((await bounded(origin + "/auth/v1/user")).status, 400);
    await Promise.race([
      peerClosed,
      new Promise((_, no) =>
        setTimeout(() => no(Error("body not aborted")), 1000).unref(),
      ),
    ]);
  } finally {
    await f.close();
  }
  const synthetic = sdkFixture();
  const session = await m.createSupabaseSession(
    env,
    AbortSignal.timeout(5000),
    async () => new Response("SYNTHETIC-not-json"),
  );
  await assert.rejects(session.exchange("SYNTHETIC-code"));
  await session.close();
});
const path = "../src/supabase-bootstrap.js";
const api = () => import(path).catch(() => ({}) as any);
test("isolated SDK session pins dev project and exact redirect, imports only validated Azure MSAL cache", async () => {
  const m = await api();
  assert.equal(typeof m.createSupabaseSession, "function");
  const f = sdkFixture();
  const s = await m.createSupabaseSession(
    env,
    AbortSignal.timeout(5000),
    f.fetcher,
  );
  try {
    const u = new URL(s.url);
    assert.equal(u.origin, origin);
    assert.equal(u.pathname, "/auth/v1/authorize");
    assert.equal(u.searchParams.get("provider"), "azure");
    assert.equal(
      u.searchParams.get("redirect_to"),
      "http://localhost:8766/supabase/callback",
    );
    assert.equal(u.searchParams.get("code_challenge_method"), "s256");
    assert.deepEqual(
      new Set(u.searchParams.get("scopes")!.split(" ")),
      new Set([
        "openid",
        "profile",
        "email",
        "offline_access",
        "https://graph.microsoft.com/Calendars.ReadBasic",
      ]),
    );
    f.challenge(u.searchParams.get("code_challenge")!);
    const a = await s.exchange("SYNTHETIC-code");
    const { silentToken } = await import("../src/m365-delegated.js");
    const {
      loadConfidentialIdentity,
      createConfidentialClient,
      confidentialNetwork,
    } = await import("../src/m365-confidential.js");
    const c = loadConfidentialIdentity(env);
    assert.equal(
      await silentToken(
        c,
        a.cache,
        createConfidentialClient(c, confidentialNetwork(c, f.fetcher)),
      )(),
      "SYNTHETIC-access",
    );
    assert.equal(f.forms.length, 1);
    const expired = JSON.parse(a.cache);
    for (const value of Object.values(expired.AccessToken) as any[]) {
      value.expires_on = "1";
      value.extended_expires_on = "1";
    }
    assert.equal(
      await silentToken(
        c,
        JSON.stringify(expired),
        createConfidentialClient(c, confidentialNetwork(c, f.fetcher)),
      )(),
      "SYNTHETIC-access",
    );
    assert.equal(f.forms.length, 2);
    assert.equal(f.forms[1].get("client_secret"), "SYNTHETIC-secret");
    assert.ok(a.cache.includes("SYNTHETIC-refresh"));
    assert.ok(!a.cache.includes("SYNTHETIC-supabase"));
    assert.ok(!a.cache.includes("SYNTHETIC-provider-refresh"));
    assert.equal(
      f.requests.filter((r) => r.url.endsWith("/auth/v1/user")).length,
      1,
    );
    assert.equal(f.forms[0].get("refresh_token"), "SYNTHETIC-provider-refresh");
    await assert.rejects(s.exchange("SYNTHETIC-code"));
  } finally {
    await s.close();
  }
});
