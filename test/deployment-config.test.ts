import test from "node:test";
import assert from "node:assert/strict";
import {
  loadDelegatedIdentity,
  loadDelegatedConfig,
  verifyDelegatedResult,
} from "../src/m365-delegated.js";
import { env } from "./supabase-fixtures.js";
import {
  loadSupabaseIdentity,
  createSupabaseSession,
} from "../src/supabase-bootstrap.js";

test("trusted operator Supabase origin is mandatory and exact, not an arbitrary endpoint", async () => {
  const origin = "https://abcdefghijklmnopqrst.supabase.co";
  for (const pin of [
    undefined,
    "",
    "https://calendar-bootstrap.example.invalid",
    "http://abcdefghijklmnopqrst.supabase.co",
    origin + "/",
    origin + ":443",
    origin + "?q=1",
    origin + "#x",
    "https://user@abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.invalid",
    "https://short.supabase.co",
    "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
    " " + origin,
  ]) {
    assert.throws(() =>
      loadSupabaseIdentity({
        ...env,
        CALENDAR_SUPABASE_URL: pin,
        CALENDAR_SUPABASE_ALLOWED_ORIGIN: pin,
      }),
    );
  }
  const configured = {
    ...env,
    CALENDAR_SUPABASE_URL: origin,
    CALENDAR_SUPABASE_ALLOWED_ORIGIN: origin,
  };
  assert.equal(
    (loadSupabaseIdentity(configured) as any).supabaseOrigin,
    origin,
  );
  assert.throws(() =>
    loadSupabaseIdentity({
      ...configured,
      CALENDAR_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co",
    }),
  );
  const session = await createSupabaseSession(
    configured,
    AbortSignal.timeout(5000),
    async () => {
      assert.fail("authorization URL creation must be offline");
    },
  );
  assert.equal(new URL(session.url).origin, origin);
  await session.close();
});

test("operator username is mandatory, syntactically validated and has no ambient fallback", () => {
  for (const username of [
    undefined,
    "",
    " owner@example.invalid",
    "owner@example.invalid ",
    "owner",
    "a@localhost",
    "a\n@example.invalid",
    "a..b@example.invalid",
    "a@-example.invalid",
    "a".repeat(255) + "@example.invalid",
  ]) {
    assert.throws(() =>
      loadDelegatedIdentity({
        ...env,
        CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: username,
        M365_USERNAME: "owner@example.invalid",
      }),
    );
  }
  const configured = {
    ...env,
    CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: "second@example.invalid",
  };
  const c = loadDelegatedIdentity(configured);
  assert.equal((c as any).expectedUsername, "second@example.invalid");
  const policy = {
    calendars: {
      work: { mailbox: "second@example.invalid", calendarId: "synthetic-work" },
    },
    clients: [
      { id: "work", secret: "SYNTHETIC-".repeat(4), calendarKeys: ["work"] },
    ],
  };
  assert.equal(
    loadDelegatedConfig({
      ...configured,
      CALENDAR_M365_DELEGATED_MSAL_CACHE: "{}",
      CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify(policy),
    }).calendars.work.mailbox,
    "second@example.invalid",
  );
  const r: any = {
    account: {
      tenantId: c.tenantId,
      localAccountId: c.objectId,
      username: "second@example.invalid",
      environment: "login.microsoftonline.com",
    },
    tenantId: c.tenantId,
    accessToken: "synthetic",
    scopes: ["Calendars.ReadBasic"],
    idTokenClaims: {
      tid: c.tenantId,
      oid: c.objectId,
      aud: c.clientId,
      iss: `${c.authority}/v2.0`,
      preferred_username: "second@example.invalid",
    },
  };
  verifyDelegatedResult(c, r);
  assert.throws(() =>
    verifyDelegatedResult(c, {
      ...r,
      account: { ...r.account, username: "owner@example.invalid" },
    }),
  );
  assert.throws(() =>
    verifyDelegatedResult(c, {
      ...r,
      idTokenClaims: {
        ...r.idTokenClaims,
        preferred_username: "owner@example.invalid",
      },
    }),
  );
  policy.calendars.work.mailbox = "owner@example.invalid";
  assert.throws(() =>
    loadDelegatedConfig({
      ...configured,
      CALENDAR_M365_DELEGATED_MSAL_CACHE: "{}",
      CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify(policy),
    }),
  );
});

test("bootstrap rejects mixed dedicated identity keys and API overrides before network or storage", async () => {
  const { runCodeBootstrap } = await import("../src/m365-confidential.js");
  const { runSupabaseBootstrap } = await import("../src/supabase-bootstrap.js");
  const forbidden = async () => {
    assert.fail("no external operation before validated configuration");
  };
  for (const change of [
    { CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: undefined },
    { CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: "invalid" },
    { CALENDAR_M365_TENANT_ID: env.CALENDAR_M365_DELEGATED_TENANT_ID },
    { CALENDAR_M365_DELEGATED_AUTHORITY: "https://evil.invalid" },
  ]) {
    assert.throws(() => loadDelegatedIdentity({ ...env, ...change }));
    const r = await runCodeBootstrap(
      ["--authorize"],
      { ...env, ...change },
      { fetcher: forbidden, runner: forbidden },
    );
    assert.equal(r.ok, false);
    assert.match(r.message, /stage=configuration/);
  }
  for (const change of [
    { CALENDAR_SUPABASE_ALLOWED_ORIGIN: undefined },
    { CALENDAR_SUPABASE_API_URL: "https://evil.invalid" },
  ]) {
    const r = await runSupabaseBootstrap(
      ["--authorize"],
      { ...env, ...change },
      { fetcher: forbidden, runner: forbidden },
    );
    assert.equal(r.ok, false);
    assert.match(r.message, /stage=configuration/);
  }
});

test("same compiled service accepts a different operator-approved deployment and refuses cache impersonation offline", async () => {
  const { sdkFixture } = await import("./supabase-fixtures.js");
  const { createConfidentialToken } =
    await import("../src/m365-confidential.js");
  const { selectMicrosoftProvider } = await import("../src/m365-runtime.js");
  const { startApplication } = await import("../src/runtime.js");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const settings = {
    ...env,
    CALENDAR_M365_DELEGATED_TENANT_ID: "44444444-4444-4444-8444-444444444444",
    CALENDAR_M365_DELEGATED_CLIENT_ID: "55555555-5555-4555-8555-555555555555",
    CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID:
      "66666666-6666-4666-8666-666666666666",
    CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: "second@example.invalid",
    CALENDAR_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co",
    CALENDAR_SUPABASE_ALLOWED_ORIGIN:
      "https://zyxwvutsrqponmlkjihg.supabase.co",
  };
  const f = sdkFixture(settings);
  const session = await createSupabaseSession(
    settings,
    AbortSignal.timeout(5000),
    f.fetcher,
  );
  assert.equal(
    new URL(session.url).origin,
    settings.CALENDAR_SUPABASE_ALLOWED_ORIGIN,
  );
  f.challenge(new URL(session.url).searchParams.get("code_challenge")!);
  const authorized = await session.exchange("SYNTHETIC-code");
  await session.close();
  const policy = {
    calendars: {
      work: {
        mailbox: settings.CALENDAR_M365_DELEGATED_EXPECTED_USERNAME,
        calendarId: "SYNTHETIC-second",
      },
    },
    clients: [
      {
        id: "second",
        secret: "SYNTHETIC-second-caller-".repeat(3),
        calendarKeys: ["work"],
      },
    ],
  };
  const runtime = {
    ...Object.fromEntries(
      Object.entries(settings).filter(([key]) =>
        key.startsWith("CALENDAR_M365_"),
      ),
    ),
    CALENDAR_M365_MODE: "delegated-confidential",
    CALENDAR_M365_DELEGATED_MSAL_CACHE: authorized.cache,
    CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify(policy),
    CALENDAR_DASHBOARD_SECRET: "SYNTHETIC-independent-viewer-".repeat(3),
  };
  assert.equal(
    await createConfidentialToken(runtime, {
      fetcher: async () => {
        assert.fail("unexpired saved cache must not request new login");
      },
    })(),
    "SYNTHETIC-access",
  );
  assert.equal(
    selectMicrosoftProvider(runtime)?.config.calendars.work.mailbox,
    "second@example.invalid",
  );
  const dir = mkdtempSync(join(tmpdir(), "deployment-config-"));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("offline validation must not contact providers");
  };
  try {
    for (const change of [
      { CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: undefined },
      { CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: "owner@example.invalid" },
      {
        CALENDAR_M365_DELEGATED_TENANT_ID:
          env.CALENDAR_M365_DELEGATED_TENANT_ID,
      },
      {
        CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID:
          env.CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID,
      },
      { CALENDAR_M365_CLIENT_SECRET: "SYNTHETIC-broad" },
    ]) {
      await assert.rejects(async () => {
        const app = await startApplication(
          {
            ...runtime,
            ...change,
            CALENDAR_TELEMETRY_FILE: join(dir, "telemetry.json"),
          },
          { dashboard: 0, mcp: 0 },
        );
        await app.close();
      });
    }
    const app = await startApplication(
      { ...runtime, CALENDAR_TELEMETRY_FILE: join(dir, "telemetry.json") },
      { dashboard: 0, mcp: 0 },
    );
    try {
      assert.ok(app.mcp);
      assert.equal(
        (await previousFetch(app.dashboard.url + "/api/diagnostics")).status,
        401,
      );
    } finally {
      await app.close();
    }
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returned URLs cannot choose another valid Supabase project and transport pins only two routes", async () => {
  const { startSupabaseCallback, supabaseNetwork } =
    await import("../src/supabase-bootstrap.js");
  const origin = env.CALENDAR_SUPABASE_ALLOWED_ORIGIN;
  const other = "https://zyxwvutsrqponmlkjihg.supabase.co";
  await assert.rejects(
    startSupabaseCallback(
      other + "/auth/v1/authorize?provider=azure",
      AbortSignal.timeout(500),
      origin,
    ),
  );
  let calls = 0;
  const network = supabaseNetwork(
    origin,
    AbortSignal.timeout(1000),
    async (_u, init) => {
      calls++;
      assert.equal(init?.redirect, "error");
      return Response.json({ synthetic: true });
    },
  );
  for (const url of [
    other + "/auth/v1/user",
    origin + "/auth/v1/user?extra=1",
    origin + ":443/auth/v1/user",
    origin + "/rest/v1/anything",
  ]) {
    assert.equal((await network(url)).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await network(origin + "/auth/v1/user")).status, 200);
  assert.equal(
    (
      await network(origin + "/auth/v1/token?grant_type=pkce", {
        method: "POST",
      })
    ).status,
    200,
  );
  assert.equal(calls, 2);
});
