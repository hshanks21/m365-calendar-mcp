import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApplication } from "../src/runtime.js";
import { env as identity, sdkFixture } from "./supabase-fixtures.js";
import {
  createConfidentialClient,
  confidentialNetwork,
  loadConfidentialIdentity,
} from "../src/m365-confidential.js";

import * as confidential from "../src/m365-confidential.js";
import { fixture } from "./fixtures.js";
test("confidential silent refresh cancellation closes actual upstream body and never outlives request", async () => {
  const env = await runtimeEnv();
  const expired = JSON.parse(env.CALENDAR_M365_DELEGATED_MSAL_CACHE);
  for (const token of Object.values(expired.AccessToken) as any[])
    token.expires_on = token.extended_expires_on = "1";
  env.CALENDAR_M365_DELEGATED_MSAL_CACHE = JSON.stringify(expired);
  let opened!: () => void, closed!: () => void;
  const opening = new Promise<void>((r) => (opened = r)),
    closing = new Promise<void>((r) => (closed = r));
  const f = await fixture((_req: any, res: any) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write("{");
    opened();
    res.on("close", closed);
  });
  try {
    assert.equal(
      typeof (confidential as any).createConfidentialToken,
      "function",
    );
    const sdk = sdkFixture();
    const token = confidential.createConfidentialToken(env, {
      fetcher: (u, init) => {
        if (new URL(String(u)).pathname.endsWith("openid-configuration"))
          return sdk.fetcher(u, init);
        assert.equal(
          new URLSearchParams(String(init?.body)).get("grant_type"),
          "refresh_token",
        );
        assert.equal(
          new URLSearchParams(String(init?.body)).get("client_secret"),
          env.CALENDAR_M365_DELEGATED_CLIENT_SECRET,
        );
        return fetch(f.url, init);
      },
    });
    const stop = new AbortController();
    const work = token(stop.signal);
    const rejected = assert.rejects(work, /^Error: interaction_required$/);
    await opening;
    stop.abort();
    await Promise.race([
      Promise.all([rejected, closing]),
      new Promise((_, no) =>
        setTimeout(() => no(Error("refresh not cancelled")), 1500).unref(),
      ),
    ]);
  } finally {
    await f.close();
  }
});
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { event, range, config as appConfig } from "./fixtures.js";
import { selectMicrosoftProvider } from "../src/m365-runtime.js";
import { readFileSync } from "node:fs";
test("explicit app-only remains available without delegated fallback", () => {
  const app = {
    CALENDAR_M365_MODE: "app-only",
    CALENDAR_M365_TENANT_ID: appConfig.tenantId,
    CALENDAR_M365_CLIENT_ID: appConfig.clientId,
    CALENDAR_M365_CLIENT_SECRET: appConfig.clientSecret,
    CALENDAR_M365_POLICY_JSON: JSON.stringify({
      calendars: appConfig.calendars,
      clients: appConfig.clients,
    }),
  };
  assert.equal(
    selectMicrosoftProvider(app)?.reader.options.delegated,
    undefined,
  );
  assert.throws(() =>
    selectMicrosoftProvider({ ...app, CALENDAR_M365_MODE: undefined }),
  );
  assert.throws(() =>
    selectMicrosoftProvider({
      ...app,
      CALENDAR_M365_DELEGATED_MSAL_CACHE: "{}",
    }),
  );
});
test("actual combined runtime MCP allowed/denied callers, no writes or discovery authority and separate health", async () => {
  const env = await runtimeEnv();
  const family = {
    calendars: { family: { calendarId: "SYNTHETIC-family" } },
    clients: [
      {
        id: "family-reader",
        secret: "SYNTHETIC-family-bearer-".repeat(3),
        calendarKeys: ["family"],
        writeCalendarKeys: [],
      },
    ],
  };
  const dir = mkdtempSync(join(tmpdir(), "m365-mcp-"));
  const original = globalThis.fetch;
  let graphCalls = 0,
    googleCalls = 0,
    writes = 0;
  const f = await fixture((req: any, res: any) => {
    if (req.method !== "GET") writes++;
    if (req.url.startsWith("/v1.0/me/calendars/SYNTHETIC-work/calendarView?")) {
      graphCalls++;
      res.end(JSON.stringify({ value: [event] }));
    } else if (
      req.url.startsWith("/calendar/v3/calendars/SYNTHETIC-family/events?")
    ) {
      googleCalls++;
      res.end(
        JSON.stringify({
          items: [
            {
              id: "synthetic",
              summary: "Synthetic family",
              status: "confirmed",
              start: { dateTime: range.start },
              end: { dateTime: range.end },
            },
          ],
        }),
      );
    } else {
      res.statusCode = 400;
      res.end("{}");
    }
  });
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    if (
      ["https://graph.microsoft.com", "https://www.googleapis.com"].includes(
        u.origin,
      )
    )
      return original(f.url + u.pathname + u.search, init);
    if (u.href === "https://oauth2.googleapis.com/token")
      return Response.json({
        access_token: "SYNTHETIC-google-access",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (u.hostname === "127.0.0.1" && u.protocol === "http:")
      return original(input, init);
    throw Error("External fixture request forbidden");
  };
  let s: Awaited<ReturnType<typeof startApplication>> | undefined;
  const clients: Client[] = [];
  try {
    s = await startApplication(
      {
        ...env,
        CALENDAR_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
        CALENDAR_GOOGLE_CLIENT_SECRET: "SYNTHETIC-google-secret",
        CALENDAR_GOOGLE_REFRESH_TOKEN: "SYNTHETIC-google-refresh",
        CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify(family),
        CALENDAR_TELEMETRY_FILE: join(dir, "events.json"),
      },
      { dashboard: 0, mcp: 0 },
    );
    assert.ok(s.mcp);
    assert.match(s.mcp.url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(
      (
        await original(s.mcp.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    for (const [key, denied, secret] of [
      ["work", "family", workPolicy.clients[0].secret],
      ["family", "work", family.clients[0].secret],
    ]) {
      const client = new Client({ name: "synthetic-runtime", version: "1" });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(s.mcp.url), {
          requestInit: { headers: { Authorization: "Bearer " + secret } },
        }),
      );
      const invoke = (name: string, args: any = {}) =>
        client.callTool({ name, arguments: args });
      const decode = (r: any) => JSON.parse(r.content[0].text);
      assert.equal((await client.listTools()).tools.length, 5);
      assert.deepEqual(decode(await invoke("list_calendars")), {
        calendars: [{ calendarKey: key }],
      });
      const status = decode(await invoke("connection_status"));
      assert.equal(status.mode, "m365-and-google");
      assert.equal(status.liveVerified, false);
      assert.equal(status.createEnabled, false);
      const before = graphCalls + googleCalls;
      for (const forbidden of [denied, "unknown", "https://evil.invalid"])
        assert.equal(
          (await invoke("list_events", { calendarKey: forbidden, ...range }))
            .isError,
          true,
        );
      for (const name of [
        "create_event",
        "update_event",
        "delete_event",
        "discover_calendars",
        "set_acl",
      ])
        assert.equal((await invoke(name, { confirmed: true })).isError, true);
      assert.equal(graphCalls + googleCalls, before);
      assert.equal(
        decode(await invoke("list_events", { calendarKey: key, ...range }))
          .complete,
        true,
      );
    }
    assert.equal(graphCalls, 1);
    assert.equal(googleCalls, 1);
    assert.equal(writes, 0);
    const login = await original(s.dashboard.url + "/login", {
      method: "POST",
      headers: { Origin: s.dashboard.url, "Content-Type": "application/json" },
      body: JSON.stringify({ token: env.CALENDAR_DASHBOARD_SECRET }),
    });
    const d = await (
      await original(s.dashboard.url + "/api/diagnostics", {
        headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
      })
    ).json();
    assert.ok(d.metrics.lastGraphSuccess);
    assert.ok(d.metrics.lastGoogleSuccess);
    const raw = readFileSync(join(dir, "events.json"), "utf8");
    for (const secret of ["SYNTHETIC", event.subject, "owner@", "bodyPreview"])
      assert.ok(!raw.includes(secret));
  } finally {
    for (const c of clients) await c.close();
    await s?.close();
    globalThis.fetch = original;
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("actual operator discovery CLI uses confidential cache without policy and prints only projected calendar data", async () => {
  const all = await runtimeEnv();
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    CALENDAR_M365_MODE: all.CALENDAR_M365_MODE,
  };
  for (const [k, v] of Object.entries(all))
    if (k.startsWith("CALENDAR_M365_DELEGATED_") && !k.endsWith("POLICY_JSON"))
      env[k] = v;
  const entry = new URL("../src/m365-discovery-cli.js", import.meta.url).href;
  const source = `globalThis.fetch=async (url,init)=>{const u=new URL(String(url));if(u.origin!=='https://graph.microsoft.com'||u.pathname!=='/v1.0/me/calendars'||init.method!=='GET')throw Error('Unexpected network');return Response.json({value:[{id:'SYNTHETIC-calendar',name:'Calendar',isDefaultCalendar:true,owner:'MUST-NOT-RETURN'}]});};process.argv=['node','cli','--list'];await import(${JSON.stringify(entry)});`;
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source],
    { env, timeout: 5000 },
  );
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    calendars: [
      { id: "SYNTHETIC-calendar", name: "Calendar", isDefaultCalendar: true },
    ],
  });
  for (const change of [
    { CALENDAR_M365_MODE: "app-only" },
    { CALENDAR_M365_CLIENT_SECRET: "SYNTHETIC-mixed" },
    {
      CALENDAR_M365_DELEGATED_POLICY_JSON:
        all.CALENDAR_M365_DELEGATED_POLICY_JSON,
    },
  ])
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", source],
        { env: { ...env, ...change }, timeout: 5000 },
      ),
      (e: any) =>
        e.code === 1 && e.stdout === "" && !e.stderr.includes("SYNTHETIC"),
    );
});
test("confidential silent acquisition has isolated cancellation, a total deadline and memory-only refreshed cache", async () => {
  const env = await runtimeEnv();
  const cache = JSON.parse(env.CALENDAR_M365_DELEGATED_MSAL_CACHE);
  for (const t of Object.values(cache.AccessToken) as any[])
    t.expires_on = t.extended_expires_on = "1";
  env.CALENDAR_M365_DELEGATED_MSAL_CACHE = JSON.stringify(cache);
  const originalCache = env.CALENDAR_M365_DELEGATED_MSAL_CACHE;
  const sdk = sdkFixture();
  let attempts = 0;
  const token = confidential.createConfidentialToken(env, {
    timeoutMs: 100,
    fetcher: async (u, init) => {
      if (new URL(String(u)).pathname.endsWith("openid-configuration"))
        return sdk.fetcher(u, init);
      attempts++;
      if (attempts === 1)
        return new Promise((_yes, no) => {
          init!.signal!.addEventListener(
            "abort",
            () => no(Error("SYNTHETIC-upstream")),
            { once: true },
          );
        });
      return sdk.fetcher(u, init);
    },
  });
  const hanging = assert.rejects(token(), /^Error: interaction_required$/);
  // A separate successful acquisition is not aborted by the first's deadline.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await token(), "SYNTHETIC-access");
  await hanging;
  const count = attempts;
  assert.equal(await token(), "SYNTHETIC-access");
  assert.equal(attempts, count);
  assert.equal(env.CALENDAR_M365_DELEGATED_MSAL_CACHE, originalCache);
});
export const workPolicy = {
  calendars: {
    work: { mailbox: "owner@example.invalid", calendarId: "SYNTHETIC-work" },
  },
  clients: [
    {
      id: "work-reader",
      secret: "SYNTHETIC-work-bearer-".repeat(3),
      calendarKeys: ["work"],
    },
  ],
};
export async function runtimeEnv() {
  const f = sdkFixture();
  const c = loadConfidentialIdentity(identity);
  const client = createConfidentialClient(c, confidentialNetwork(c, f.fetcher));
  await client.acquireTokenByRefreshToken({
    refreshToken: "SYNTHETIC-refresh",
    scopes: ["Calendars.ReadBasic"],
    forceCache: true,
  });
  return {
    ...identity,
    CALENDAR_M365_MODE: "delegated-confidential",
    CALENDAR_M365_DELEGATED_MSAL_CACHE: client.getTokenCache().serialize(),
    CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify(workPolicy),
    CALENDAR_DASHBOARD_SECRET: "SYNTHETIC-viewer-".repeat(3),
  };
}
test("runtime selects explicit confidential provider with unverified Graph health and no startup network", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-runtime-"));
  const env = await runtimeEnv();
  let s: Awaited<ReturnType<typeof startApplication>> | undefined;
  try {
    s = await startApplication(
      { ...env, CALENDAR_TELEMETRY_FILE: join(dir, "events.json") },
      { dashboard: 0, mcp: 0 },
    );
    assert.ok(s.mcp);
    const login = await fetch(s.dashboard.url + "/login", {
      method: "POST",
      headers: { Origin: s.dashboard.url, "Content-Type": "application/json" },
      body: JSON.stringify({ token: env.CALENDAR_DASHBOARD_SECRET }),
    });
    const d = await (
      await fetch(s.dashboard.url + "/api/diagnostics", {
        headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
      })
    ).json();
    assert.equal(d.health.graph, "unverified");
    assert.equal(d.health.google, "not_configured");
    assert.equal(d.metrics.lastGraphSuccess, null);
    assert.equal(d.access.calendarCount, 1);
  } finally {
    await s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("runtime rejects missing/malformed/mixed auth and strict work policy, with no fallback", async () => {
  const env = await runtimeEnv();
  const dir = mkdtempSync(join(tmpdir(), "m365-runtime-"));
  try {
    const changes: NodeJS.ProcessEnv[] = [
      { CALENDAR_M365_MODE: undefined },
      { CALENDAR_M365_MODE: "public" },
      { CALENDAR_M365_MODE: "app-only" },
      { CALENDAR_M365_MODE: "" },
      { CALENDAR_M365_CLIENT_SECRET: "" },
      { CALENDAR_M365_POLICY_FILE: "/no/read" },
      { CALENDAR_M365_DELEGATED_TENANT_ID: "malformed" },
      {
        CALENDAR_M365_DELEGATED_CLIENT_SECRET: undefined,
        M365_SECRET: "SYNTHETIC-generic",
      },
      { CALENDAR_M365_DELEGATED_CLIENT_SECRET: "" },
      { CALENDAR_M365_DELEGATED_POLICY_JSON: undefined },
      { CALENDAR_M365_DELEGATED_MSAL_CACHE: "{}" },
      { CALENDAR_M365_DELEGATED_MSAL_CACHE: "bad" },
      { CALENDAR_DASHBOARD_SECRET: env.CALENDAR_M365_DELEGATED_CLIENT_SECRET },
      { CALENDAR_DASHBOARD_SECRET: workPolicy.clients[0].secret },
    ];
    for (const field of [
      "realm",
      "local_account_id",
      "username",
      "environment",
      "home_account_id",
    ]) {
      const bad = JSON.parse(env.CALENDAR_M365_DELEGATED_MSAL_CACHE);
      (Object.values(bad.Account)[0] as any)[field] = "SYNTHETIC-wrong";
      changes.push({ CALENDAR_M365_DELEGATED_MSAL_CACHE: JSON.stringify(bad) });
    }
    for (const p of [
      { ...workPolicy, extra: true },
      {
        ...workPolicy,
        calendars: {
          work: { mailbox: "other@example.invalid", calendarId: "no" },
        },
      },
      {
        ...workPolicy,
        clients: [{ ...workPolicy.clients[0], calendarKeys: ["family"] }],
      },
      {
        ...workPolicy,
        clients: [{ ...workPolicy.clients[0], writeCalendarKeys: ["work"] }],
      },
    ])
      changes.push({ CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify(p) });
    for (const change of changes)
      await assert.rejects(
        async () => {
          const s = await startApplication(
            {
              ...env,
              ...change,
              CALENDAR_TELEMETRY_FILE: join(dir, "events.json"),
            },
            { dashboard: 0, mcp: 0 },
          );
          await s.close();
        },
        JSON.stringify(Object.keys(change)),
      );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("runtime refuses partial delegated settings instead of silently starting dashboard-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-runtime-"));
  try {
    await assert.rejects(async () => {
      const s = await startApplication(
        {
          CALENDAR_DASHBOARD_SECRET: "SYNTHETIC-viewer-".repeat(3),
          CALENDAR_M365_DELEGATED_CLIENT_SECRET: "SYNTHETIC-secret",
          CALENDAR_TELEMETRY_FILE: join(dir, "events.json"),
        },
        { dashboard: 0, mcp: 0 },
      );
      await s.close();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
