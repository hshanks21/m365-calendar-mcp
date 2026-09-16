// Both fixed-port callback suites must share one test worker (port 8766).
import "./supabase-callback-cases.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
test("confidential transport denies device/common/foreign/query endpoints and bounds responses, redirects, cancellation", async () => {
  const m = await api();
  const c = m.loadConfidentialIdentity(env);
  let requests = 0;
  const network = m.confidentialNetwork(c, async () => {
    requests++;
    return new Response("{}");
  });
  const token = `${c.authority}/oauth2/v2.0/token`;
  for (const url of [
    token.replace(tenant, "common"),
    token.replace(tenant, client),
    token.replace("login.microsoftonline.com", "evil.invalid"),
    token + "#fragment",
    token + "?secret=secret",
    token.replace("/token", "/devicecode"),
    token.replace("https:", "http:"),
  ])
    await assert.rejects(async () => network.sendPostRequestAsync(url));
  assert.equal(requests, 0);
  const reasons: string[] = [];
  for (const response of [
    new Response("SYNTHETIC-secret-invalid-json"),
    new Response("x".repeat(262145)),
  ]) {
    const n = m.confidentialNetwork(
      c,
      async () => response,
      undefined,
      (r: string) => reasons.push(r),
    );
    await assert.rejects(
      n.sendPostRequestAsync(token),
      /^Error: Microsoft network request failed\.$/,
    );
  }
  assert.ok(reasons.includes("response_json"));
  assert.ok(reasons.includes("response_limit"));
  let closed!: () => void;
  const peerClosed = new Promise<void>((r) => (closed = r));
  const f = await fixture((req: any, res: any) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{");
    res.on("close", closed);
  });
  try {
    const n = m.confidentialNetwork(
      c,
      (url: any, init: any) => fetch(f.url, init),
      AbortSignal.timeout(50),
    );
    await assert.rejects(n.sendPostRequestAsync(token), /Microsoft/);
    await Promise.race([
      peerClosed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("HTTP body still running")),
          1000,
        ).unref(),
      ),
    ]);
  } finally {
    await f.close();
  }
  const redirect = await fixture((_req: any, res: any) => {
    res.writeHead(302, { Location: "https://evil.invalid/SYNTHETIC-secret" });
    res.end();
  });
  try {
    await assert.rejects(
      m
        .confidentialNetwork(c, (url: any, init: any) =>
          fetch(redirect.url, init),
        )
        .sendPostRequestAsync(token),
      /Microsoft/,
    );
  } finally {
    await redirect.close();
  }
});
test("code bootstrap cancellation removes callback and signal handlers without storage", async () => {
  const m = await api();
  const stop = new AbortController();
  const before = process.listenerCount("SIGINT");
  let stores = 0;
  const result = await m.runCodeBootstrap(["--authorize"], env, {
    signal: stop.signal,
    log: () => stop.abort(),
    fetcher: async () => {
      throw Error("no network expected");
    },
    runner: async () => {
      stores++;
      return "";
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /stage=cancelled/);
  assert.equal(stores, 0);
  assert.equal(process.listenerCount("SIGINT"), before);
  await assert.rejects(callbackRequest("/?state=anything&code=anything"));
});
test("code bootstrap suppresses real MSAL parse errors with fixed classification", async () => {
  const m = await api();
  const f = await microsoftFixture();
  let delivery: Promise<unknown> | undefined;
  try {
    f.response({ id_token: "SYNTHETIC-secret-invalid" });
    const result = await m.runCodeBootstrap(["--authorize"], env, {
      fetcher: f.fetcher,
      runner: async () => {
        throw Error("must not store");
      },
      log: (line: string) => {
        if (line.startsWith("https://")) {
          const u = new URL(line);
          delivery = callbackRequest(
            "/?" +
              new URLSearchParams({
                state: u.searchParams.get("state")!,
                code: "SYNTHETIC-code",
              }),
          );
        }
      },
    });
    await delivery;
    assert.equal(result.ok, false);
    assert.match(
      result.message,
      /stage=token_exchange.*reason=msal_token_parse/,
    );
    assert.ok(!result.message.includes("SYNTHETIC"));
  } finally {
    await f.close();
  }
});
test("callback kills active slow header connections within absolute five-second request limit", async () => {
  const m = await api();
  const cb = await m.startCodeCallback("state", AbortSignal.timeout(15000));
  const socket = connect(8766, "127.0.0.1");
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write("GET /? HTTP/1.1\r\nHost: localhost:8766\r\nX-Slow: ");
    timer = setInterval(() => socket.write("x"), 100);
    await Promise.race([
      new Promise<void>((resolve) => socket.once("close", () => resolve())),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(Error("absolute callback request limit missing")),
          6000,
        ).unref(),
      ),
    ]);
    assert.ok(performance.now() - started < 5800);
  } finally {
    clearInterval(timer);
    socket.destroy();
    await cb.close();
  }
});
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("actual CLI process with synthetic transport suppresses provider, code, and secret diagnostics", async () => {
  const f = await microsoftFixture();
  f.response({
    error: "invalid_client",
    error_description: "SYNTHETIC-sensitive-provider-message",
    access_token: undefined,
  });
  try {
    const source = `const originalFetch=fetch;globalThis.fetch=(url,init)=>originalFetch(${JSON.stringify(f.url)}+new URL(String(url)).pathname,init);const output=console.log;console.log=(line)=>{if(String(line).startsWith('https://')){const u=new URL(line);originalFetch('http://127.0.0.1:8766/?'+new URLSearchParams({state:u.searchParams.get('state'),code:'SYNTHETIC-code'}),{headers:{Host:'localhost:8766'}}).catch(()=>{});}else if(!String(line).startsWith('Open the consent'))output(line);};await import(${JSON.stringify(new URL("../src/m365-code-cli.js", import.meta.url).href)});`;
    // Node fetch can normalize Host; route the callback using node:http instead.
    const code = source.replace(
      "originalFetch('http://127.0.0.1:8766/?'+new URLSearchParams({state:u.searchParams.get('state'),code:'SYNTHETIC-code'}),{headers:{Host:'localhost:8766'}}).catch(()=>{});",
      "import('node:http').then(({get})=>get({host:'127.0.0.1',port:8766,path:'/?'+new URLSearchParams({state:u.searchParams.get('state'),code:'SYNTHETIC-code'}),headers:{Host:'localhost:8766'}},r=>r.resume()).on('error',()=>{}));",
    );
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          code,
          "--",
          "unused",
          "--authorize",
        ],
        { env: { PATH: process.env.PATH, ...env }, timeout: 10000 },
      ),
      (error: any) => {
        assert.equal(error.code, 1);
        assert.match(
          error.stderr,
          /stage=token_exchange.*reason=provider_client_refused/,
        );
        assert.ok(!error.stdout.includes("SYNTHETIC"));
        assert.ok(!error.stderr.includes("SYNTHETIC"));
        return true;
      },
    );
  } finally {
    await f.close();
  }
});
test("standalone code CLI is opt-in; actual MSAL callback stores privately with exact readback and classified failures", async () => {
  const m = await api();
  assert.equal(typeof m.runCodeBootstrap, "function");
  const run = promisify(execFile);
  const help = await run(
    process.execPath,
    ["--import", "tsx", "src/m365-code-cli.ts", "--help"],
    { env: { PATH: process.env.PATH }, timeout: 5000 },
  );
  assert.match(help.stdout, /http:\/\/localhost:8766\//);
  assert.ok(!help.stdout.includes("public-client"));
  const f = await microsoftFixture();
  try {
    let written = "";
    let calls: string[][] = [];
    let logs: string[] = [];
    let delivery: Promise<unknown> | undefined;
    const deps = {
      fetcher: f.fetcher,
      log: (line: string) => {
        logs.push(line);
        if (line.startsWith("https://")) {
          const u = new URL(line);
          f.nonce(u.searchParams.get("nonce")!);
          delivery = callbackRequest(
            "/?" +
              new URLSearchParams({
                state: u.searchParams.get("state")!,
                code: "SYNTHETIC-code",
              }),
          );
        }
      },
      runner: async (args: string[], input?: string) => {
        calls.push(args);
        if (input) {
          written = input;
          return "";
        }
        return written;
      },
    };
    assert.equal((await m.runCodeBootstrap([], env, deps)).ok, false);
    assert.equal(
      (await m.runCodeBootstrap(["--authorize", "--port", "1234"], env, deps))
        .ok,
      false,
    );
    assert.equal(calls.length, 0);
    assert.equal(logs.length, 0);
    let result = await m.runCodeBootstrap(["--authorize"], env, deps);
    await delivery;
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /read-back verified/);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((a) => a.slice(0, 3)),
      [
        ["secrets", "set", "CALENDAR_M365_DELEGATED_MSAL_CACHE"],
        ["secrets", "get", "CALENDAR_M365_DELEGATED_MSAL_CACHE"],
      ],
    );
    assert.ok(written.includes("SYNTHETIC-refresh"));
    for (const a of calls) {
      assert.ok(a.includes("--no-read-env"));
      assert.ok(a.includes("https://api.doppler.com"));
      assert.ok(!a.join(" ").includes("SYNTHETIC"));
    }
    for (const bad of ["write", "readback", "provider", "nonce"]) {
      calls = [];
      logs = [];
      f.response(
        bad === "provider"
          ? {
              error: "invalid_client",
              error_description: "SYNTHETIC-secret",
              access_token: undefined,
            }
          : {},
      );
      f.claims(bad === "nonce" ? { nonce: "SYNTHETIC-wrong" } : {});
      result = await m.runCodeBootstrap(["--authorize"], env, {
        ...deps,
        runner: async (args: string[], input?: string) => {
          calls.push(args);
          if (bad === "write") throw Error("SYNTHETIC-secret");
          return input ? "" : "SYNTHETIC-wrong";
        },
      });
      await delivery;
      assert.equal(result.ok, false);
      assert.match(
        result.message,
        bad === "write"
          ? /stage=doppler_write/
          : bad === "readback"
            ? /stage=doppler_readback/
            : bad === "provider"
              ? /stage=token_exchange.*reason=provider_client_refused/
              : /stage=(identity_scopes|token_exchange)/,
      );
      assert.ok(!result.message.includes("SYNTHETIC"));
      assert.ok(!logs.join(" ").includes("SYNTHETIC"));
      if (["provider", "nonce"].includes(bad)) assert.equal(calls.length, 0);
    }
  } finally {
    await f.close();
  }
});
import { fixture } from "./fixtures.js";
import { silentToken } from "../src/m365-delegated.js";
async function microsoftFixture() {
  let nonce = "";
  let change: Record<string, unknown> = {};
  let responseChange: Record<string, unknown> = {};
  const forms: URLSearchParams[] = [];
  const claims = () => ({
    tid: tenant,
    oid,
    aud: client,
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    preferred_username: "owner@example.invalid",
    sub: oid,
    nonce,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...change,
  });
  const f = await fixture((req: any, res: any) => {
    let body = "";
    req.on("data", (d: any) => (body += d));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("openid-configuration"))
        return res.end(
          JSON.stringify({
            authorization_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
            token_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
            jwks_uri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
          }),
        );
      forms.push(new URLSearchParams(body));
      const jwt =
        [{ alg: "RS256", typ: "JWT" }, claims()]
          .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
          .join(".") + ".SYNTHETIC-signature";
      res.end(
        JSON.stringify({
          token_type: "Bearer",
          scope: "Calendars.ReadBasic",
          expires_in: 3600,
          access_token: "SYNTHETIC-access",
          refresh_token: "SYNTHETIC-refresh",
          id_token: jwt,
          client_info: Buffer.from(
            JSON.stringify({ uid: oid, utid: tenant }),
          ).toString("base64url"),
          ...responseChange,
        }),
      );
    });
  });
  return {
    ...f,
    forms,
    nonce: (v: string) => (nonce = v),
    claims: (v: Record<string, unknown>) => (change = v),
    response: (v: Record<string, unknown>) => (responseChange = v),
    fetcher: ((url: any, init: any) =>
      fetch(f.url + new URL(String(url)).pathname, init)) as typeof fetch,
  };
}
test("real MSAL confidential code exchange and silent refresh use explicit secret; claims/scopes/nonce/offline cache fail closed", async () => {
  const m = await api();
  assert.equal(typeof m.exchangeMicrosoftCode, "function");
  const f = await microsoftFixture();
  try {
    const c = m.loadConfidentialIdentity(env);
    const cca = m.createConfidentialClient(
      c,
      m.confidentialNetwork(c, f.fetcher),
    );
    const s = await m.createCodeSession(c, cca);
    f.nonce(s.nonce);
    const a = await m.exchangeMicrosoftCode(c, cca, s, "SYNTHETIC-code");
    assert.ok(a.cache.includes("SYNTHETIC-refresh"));
    assert.ok(!a.cache.includes(env.CALENDAR_M365_DELEGATED_CLIENT_SECRET));
    const form = f.forms[0];
    assert.equal(
      form.get("client_secret"),
      env.CALENDAR_M365_DELEGATED_CLIENT_SECRET,
    );
    assert.equal(form.get("code_verifier"), s.verifier);
    assert.equal(form.get("redirect_uri"), "http://localhost:8766/");
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "SYNTHETIC-code");
    assert.deepEqual(
      new Set(form.get("scope")!.split(" ")),
      new Set([
        "https://graph.microsoft.com/Calendars.ReadBasic",
        "openid",
        "profile",
        "offline_access",
      ]),
    );
    const restored = m.createConfidentialClient(
      c,
      m.confidentialNetwork(c, f.fetcher),
    );
    assert.equal(await silentToken(c, a.cache, restored)(), "SYNTHETIC-access");
    assert.equal(f.forms.length, 1);
    const expired = JSON.parse(a.cache);
    for (const token of Object.values(expired.AccessToken) as any[]) {
      token.expires_on = "1";
      token.extended_expires_on = "1";
    }
    const refreshed = m.createConfidentialClient(
      c,
      m.confidentialNetwork(c, f.fetcher),
    );
    assert.equal(
      await silentToken(c, JSON.stringify(expired), refreshed)(),
      "SYNTHETIC-access",
    );
    assert.equal(f.forms[1].get("grant_type"), "refresh_token");
    assert.equal(
      f.forms[1].get("client_secret"),
      env.CALENDAR_M365_DELEGATED_CLIENT_SECRET,
    );
    for (const bad of [
      { nonce: "wrong" },
      { nonce: undefined },
      { tid: client },
      { oid: client },
      { aud: oid },
      { iss: "https://evil.invalid" },
      { preferred_username: "other@example.invalid" },
    ]) {
      f.claims(bad);
      const c2 = m.createConfidentialClient(
        c,
        m.confidentialNetwork(c, f.fetcher),
      );
      await assert.rejects(
        m.exchangeMicrosoftCode(c, c2, s, "SYNTHETIC-code"),
        /Microsoft/,
      );
    }
    f.claims({});
    for (const bad of [
      { scope: "Calendars.ReadBasic Mail.Read" },
      { scope: "User.Read" },
      { refresh_token: undefined },
      { id_token: "SYNTHETIC-invalid" },
    ]) {
      f.response(bad);
      const c2 = m.createConfidentialClient(
        c,
        m.confidentialNetwork(c, f.fetcher),
      );
      await assert.rejects(
        m.exchangeMicrosoftCode(c, c2, s, "SYNTHETIC-code"),
        /Microsoft/,
      );
    }
    f.response({});
    assert.equal(typeof m.createConfidentialReader, "function");
    const reader = m.createConfidentialReader({
      ...env,
      CALENDAR_M365_DELEGATED_MSAL_CACHE: a.cache,
      CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify({
        calendars: {
          work: {
            mailbox: "owner@example.invalid",
            calendarId: "SYNTHETIC-approved",
          },
        },
        clients: [
          {
            id: "synthetic",
            secret: "synthetic-bearer-".repeat(3),
            calendarKeys: ["work"],
          },
        ],
      }),
    });
    assert.equal(reader.options.delegated.calendarId, "SYNTHETIC-approved");
    assert.equal(await reader.options.token(), "SYNTHETIC-access");
  } finally {
    await f.close();
  }
});
import { request } from "node:http";
import { connect } from "node:net";
function callbackRequest(
  path: string,
  host = "localhost:8766",
  method = "GET",
) {
  return new Promise<{ status: number; body: string; headers: any }>(
    (resolve, reject) => {
      const r = request(
        {
          host: "127.0.0.1",
          port: 8766,
          path,
          method,
          headers: { Host: host },
        },
        (res) => {
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () =>
            resolve({ status: res.statusCode!, body, headers: res.headers }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    },
  );
}
test("fixed loopback callback rejects malicious inputs, consumes once, closes on denial/cancel/deadline and refuses busy port", async () => {
  const m = await api();
  assert.equal(typeof m.startCodeCallback, "function");
  const stop = new AbortController();
  const cb = await m.startCodeCallback("SYNTHETIC-state", stop.signal);
  try {
    assert.equal(cb.address.address, "127.0.0.1");
    assert.equal(cb.address.port, 8766);
    await assert.rejects(m.startCodeCallback("other", stop.signal), /callback/);
    for (const [path, host, method] of [
      ["/?state=bad&code=SYNTHETIC-code"],
      ["/?state=SYNTHETIC-state&code=SYNTHETIC-code", "evil.invalid"],
      ["/?state=SYNTHETIC-state&code=SYNTHETIC-code", "127.0.0.1:8766"],
      ["/?state=SYNTHETIC-state&code=SYNTHETIC-code", undefined, "POST"],
      ["/other?state=SYNTHETIC-state&code=SYNTHETIC-code"],
      ["/a/../?state=SYNTHETIC-state&code=SYNTHETIC-code"],
      ["/?state=SYNTHETIC-state&state=SYNTHETIC-state&code=SYNTHETIC-code"],
      ["/?state=SYNTHETIC-state&code=SYNTHETIC-code&error=SECRET"],
      ["/?state=SYNTHETIC-state&code=%0asecret"],
      ["/?state=SYNTHETIC-state&code=SYNTHETIC-code&unknown=SECRET"],
      ["/?state=SYNTHETIC-state&code=%GG"],
    ]) {
      const r = await callbackRequest(path!, host, method);
      assert.equal(r.status, 400);
      assert.ok(!r.body.includes("SYNTHETIC") && !r.body.includes("SECRET"));
      assert.equal(r.headers["cache-control"], "no-store");
      assert.equal(r.headers["referrer-policy"], "no-referrer");
      assert.match(r.headers["content-security-policy"], /default-src 'none'/);
    }
    const duplicateHost = await new Promise<string>((resolve, reject) => {
      const s = connect(8766, "127.0.0.1", () =>
        s.end(
          "GET /?state=SYNTHETIC-state&code=SYNTHETIC-code HTTP/1.1\r\nHost: localhost:8766\r\nHost: evil.invalid\r\nConnection: close\r\n\r\n",
        ),
      );
      let response = "";
      s.on("data", (d) => (response += d));
      s.on("end", () => resolve(response));
      s.on("error", reject);
    });
    assert.match(duplicateHost, /HTTP\/1.1 400/);
    const r = await callbackRequest(
      "/?state=SYNTHETIC-state&code=SYNTHETIC-code&session_state=unused",
    );
    assert.equal(r.status, 200);
    assert.equal(await cb.code, "SYNTHETIC-code");
    await assert.rejects(
      callbackRequest("/?state=SYNTHETIC-state&code=SYNTHETIC-code"),
    );
  } finally {
    await cb.close();
  }
  for (const mode of ["deny", "cancel", "timeout"]) {
    const stop = new AbortController();
    const cb = await m.startCodeCallback(
      "SYNTHETIC-state",
      mode === "timeout" ? AbortSignal.timeout(30) : stop.signal,
    );
    if (mode === "deny")
      await callbackRequest(
        "/?state=SYNTHETIC-state&error=access_denied&error_description=SECRET",
      );
    else if (mode === "cancel") stop.abort();
    await assert.rejects(cb.code, /callback/);
    await cb.close();
  }
});
const modulePath = "../src/m365-confidential.js";
const api = () => import(modulePath).catch(() => ({}) as any);
const tenant = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";
const oid = "33333333-3333-4333-8333-333333333333";
const env = {
  CALENDAR_M365_DELEGATED_TENANT_ID: tenant,
  CALENDAR_M365_DELEGATED_CLIENT_ID: client,
  CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID: oid,
  CALENDAR_M365_DELEGATED_CLIENT_SECRET: "SYNTHETIC-client-secret",
};
test("confidential MSAL authorization pins redirect, PKCE, nonce, state and only approved scopes; dedicated secret required", async () => {
  const m = await api();
  assert.equal(typeof m.createCodeSession, "function");
  for (const secret of [undefined, "", "bad\nsecret"]) {
    assert.throws(
      () =>
        m.loadConfidentialIdentity({
          ...env,
          CALENDAR_M365_DELEGATED_CLIENT_SECRET: secret,
          M365_SECRET: "SYNTHETIC-generic",
        }),
      /configuration/,
    );
  }
  const c = m.loadConfidentialIdentity(env);
  const s = await m.createCodeSession(c);
  const u = new URL(s.url);
  assert.equal(
    u.origin + u.pathname,
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
  );
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:8766/");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("response_mode"), "query");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    u.searchParams.get("code_challenge"),
    createHash("sha256").update(s.verifier).digest("base64url"),
  );
  assert.equal(u.searchParams.get("state"), s.state);
  assert.equal(u.searchParams.get("nonce"), s.nonce);
  assert.match(s.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(s.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(
    new Set(u.searchParams.get("scope")!.split(" ")),
    new Set([
      "https://graph.microsoft.com/Calendars.ReadBasic",
      "openid",
      "profile",
      "offline_access",
    ]),
  );
  assert.ok(!s.url.includes(env.CALENDAR_M365_DELEGATED_CLIENT_SECRET));
  assert.notEqual((await m.createCodeSession(c)).state, s.state);
});
