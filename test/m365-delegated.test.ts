import test from "node:test";
import assert from "node:assert/strict";
import * as delegated from "../src/m365-delegated.js";
import * as oauth from "../src/m365-oauth.js";
import { runPrivate } from "../src/google-oauth.js";
import * as msal from "../src/m365-msal.js";
import { fixture, event, range } from "./fixtures.js";
import { Graph } from "../src/graph.js";
import { combinePolicies, routeProviders } from "../src/providers.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("standalone CLI help is safe and missing authorize refuses without credentials", async () => {
  const run = promisify(execFile);
  const args = ["--import", "tsx", "src/m365-oauth-cli.ts"];
  const options = { env: { PATH: process.env.PATH }, timeout: 5000 };
  const help = await run(process.execPath, [...args, "--help"], options);
  assert.match(help.stdout, /--authorize/);
  assert.equal(help.stderr, "");
  await assert.rejects(
    run(process.execPath, args, options),
    (error: any) => error.code === 1 && /bootstrap refused/.test(error.stderr),
  );
});

test("delegated config requires explicit approved work policy and preserves provider caller separation", () => {
  const policy = {
    calendars: {
      work: { mailbox: "owner@example.invalid", calendarId: "work-id" },
    },
    clients: [
      {
        id: "work-reader",
        secret: "synthetic-work-".repeat(3),
        calendarKeys: ["work"],
      },
    ],
  };
  const complete = {
    ...env,
    CALENDAR_M365_DELEGATED_MSAL_CACHE: "{}",
    CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify(policy),
  };
  const c = delegated.loadDelegatedConfig(complete);
  assert.deepEqual(c.calendars, policy.calendars);
  for (const changed of [
    { CALENDAR_M365_DELEGATED_POLICY_JSON: undefined },
    { CALENDAR_M365_DELEGATED_MSAL_CACHE: undefined },
    {
      CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify({
        ...policy,
        calendars: {
          work: { mailbox: "other@example.com", calendarId: "work-id" },
        },
      }),
    },
  ])
    assert.throws(() =>
      delegated.loadDelegatedConfig({ ...complete, ...changed }),
    );
  const google = {
    calendars: { family: { provider: "google", calendarId: "family-id" } },
    clients: [
      {
        id: "family-reader",
        secret: "synthetic-family-".repeat(3),
        calendarKeys: ["family"],
      },
    ],
  };
  const combined = combinePolicies(c, google as any)!;
  assert.deepEqual(
    combined.clients.map((x) => x.calendarKeys),
    [["work"], ["family"]],
  );
  assert.throws(() =>
    combinePolicies(c, { ...google, clients: c.clients } as any),
  );
  const reader = delegated.createDelegatedReader(c);
  assert.equal(reader.options.delegated?.calendarId, "work-id");
  assert.equal(routeProviders(reader, null).mode, "m365-delegated");
});

test("delegated Graph fixes /me and one approved calendar, rejects other mappings and unsafe next links", async () => {
  let requests = 0;
  let malicious = false;
  const f = await fixture((req: any, res: any) => {
    requests++;
    assert.ok(req.url.startsWith("/v1.0/me/calendars/work-id/calendarView?"));
    res.end(
      JSON.stringify({
        value: [event],
        ...(malicious
          ? {
              "@odata.nextLink": `${f.url}/v1.0/users/other/calendars/work-id/calendarView`,
            }
          : {}),
      }),
    );
  });
  const mapping = { mailbox: "owner@example.invalid", calendarId: "work-id" };
  try {
    const reader = new Graph({
      token: async () => "SYNTHETIC",
      base: f.url,
      testOnly: true,
      delegated: mapping,
    } as any);
    assert.equal((await reader.view(mapping, range)).complete, true);
    for (const m of [
      { ...mapping, mailbox: "other@example.com" },
      { ...mapping, calendarId: "other" },
    ])
      assert.equal((await reader.view(m, range)).error, "forbidden_calendar");
    assert.equal(requests, 1);
    const expired = new Graph({
      token: async () => {
        throw Error("interaction_required");
      },
      base: f.url,
      testOnly: true,
      delegated: mapping,
    });
    assert.equal(
      (await expired.view(mapping, range)).error,
      "interaction_required",
    );
    malicious = true;
    assert.equal(
      (await reader.view(mapping, range)).error,
      "unsafe_pagination",
    );
    assert.equal(requests, 2);
  } finally {
    await f.close();
  }
});

test("official MSAL device flow builds a serialized cache using synthetic Microsoft HTTP responses", async () => {
  const c = delegated.loadDelegatedIdentity(env);
  const paths: string[] = [];
  const forms: URLSearchParams[] = [];
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const jwt =
    [
      { alg: "RS256", typ: "JWT" },
      {
        ...result.idTokenClaims,
        sub: oid,
        iat: expiry - 3600,
        exp: expiry,
        nbf: expiry - 3600,
      },
    ]
      .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
      .join(".") + ".synthetic-signature";
  const f = await fixture((req: any, res: any) => {
    let body = "";
    req.on("data", (d: any) => (body += d));
    req.on("end", () => {
      paths.push(req.url);
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("openid-configuration"))
        res.end(
          JSON.stringify({
            authorization_endpoint: `${c.authority}/oauth2/v2.0/authorize`,
            token_endpoint: `${c.authority}/oauth2/v2.0/token`,
            device_authorization_endpoint: `${c.authority}/oauth2/v2.0/devicecode`,
            issuer: `${c.authority}/v2.0`,
            jwks_uri: `${c.authority}/discovery/v2.0/keys`,
          }),
        );
      else if (req.url.includes("devicecode")) {
        forms.push(new URLSearchParams(body));
        res.end(
          JSON.stringify({
            device_code: "SYNTHETIC-PRIVATE",
            user_code: "ABCDE1234",
            verification_uri: "https://login.microsoft.com/device",
            expires_in: 300,
            interval: 0,
            message: "DO NOT LOG",
          }),
        );
      } else {
        forms.push(new URLSearchParams(body));
        res.end(
          JSON.stringify({
            token_type: "Bearer",
            scope: "Calendars.ReadBasic",
            expires_in: 3600,
            access_token: "SYNTHETIC-ACCESS",
            refresh_token: "SYNTHETIC-REFRESH",
            id_token: jwt,
            client_info: Buffer.from(
              JSON.stringify({ uid: oid, utid: tenant }),
            ).toString("base64url"),
          }),
        );
      }
    });
  });
  try {
    const network = msal.microsoftNetwork(c, (url, init) =>
      fetch(f.url + new URL(String(url)).pathname, init),
    );
    const pca = msal.createMicrosoftClient(c, network);
    const logs: string[] = [];
    const authorized = await msal.acquireDevice(pca, (s) => logs.push(s));
    delegated.verifyDelegatedResult(c, authorized.result);
    assert.ok(authorized.cache.includes("SYNTHETIC-REFRESH"));
    assert.throws(
      () => msal.serializedOfflineCache(msal.createMicrosoftClient(c, network)),
      /offline cache/,
    );
    assert.deepEqual(logs, ["https://login.microsoft.com/device", "ABCDE1234"]);
    assert.deepEqual(paths, [
      `/${tenant}/oauth2/v2.0/devicecode`,
      `/${tenant}/oauth2/v2.0/token`,
    ]);
    const scopes = new Set(forms[0].get("scope")!.split(" "));
    for (const s of [
      "https://graph.microsoft.com/Calendars.ReadBasic",
      "offline_access",
      "openid",
      "profile",
    ])
      assert.ok(scopes.has(s));
    assert.equal(forms[0].has("client_secret"), false);
    const workerUrl = new URL(
      "data:text/javascript," +
        encodeURIComponent(
          `import {tsImport} from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))}; const original=fetch;globalThis.fetch=(url,init)=>original(${JSON.stringify(f.url)}+new URL(String(url)).pathname,init);await tsImport(${JSON.stringify(new URL(import.meta.url.endsWith(".ts") ? "../src/m365-device-worker.ts" : "../src/m365-device-worker.js", import.meta.url).href)},${JSON.stringify(import.meta.url)});`,
        ),
    );
    const viaWorker = await msal.authorizeInWorker(
      c,
      AbortSignal.timeout(5000),
      () => {},
      workerUrl,
    );
    delegated.verifyDelegatedResult(c, viaWorker.result);
    assert.ok(viaWorker.cache.includes("SYNTHETIC-REFRESH"));
    const restored = msal.createMicrosoftClient(c, network);
    const token = await delegated.silentToken(c, authorized.cache, restored)();
    assert.equal(token, "SYNTHETIC-ACCESS");
    assert.equal(paths.length, 4); // Worker made two requests; silent cache hit made none.
    const failing = {
      getTokenCache: () => ({
        deserialize: () => {},
        getAllAccounts: async () => [account],
      }),
      acquireTokenSilent: async () => {
        throw Error("interaction_required SECRET");
      },
    };
    await assert.rejects(
      delegated.silentToken(c, authorized.cache, failing as any)(),
      /^Error: interaction_required$/,
    );
  } finally {
    await f.close();
  }
});

test("device message accepts the Microsoft device page and rejects URL lookalikes", () => {
  assert.deepEqual(
    msal.publicDeviceMessage({
      verificationUri: "https://login.microsoft.com/device",
      userCode: "ABCDE1234",
    }),
    ["https://login.microsoft.com/device", "ABCDE1234"],
  );
  for (const verificationUri of [
    "http://login.microsoft.com/device",
    "https://login.microsoft.com/device?code=SECRET",
    "https://login.microsoft.com/device#SECRET",
    "https://login.microsoft.com/device/",
    "https://login.microsoft.com/other",
    "https://login.microsoft.com.evil.invalid/device",
    "https://evil.invalid@login.microsoft.com/device",
  ])
    assert.throws(() =>
      msal.publicDeviceMessage({ verificationUri, userCode: "ABCDE1234" }),
    );
});

test("MSAL worker is forcibly terminated on cancellation and never prints raw responses", async () => {
  const stop = new AbortController();
  const logs: unknown[][] = [];
  const worker = new URL(
    "data:text/javascript," +
      encodeURIComponent(
        `import {parentPort} from 'node:worker_threads'; parentPort.postMessage({kind:'device',verificationUri:'https://microsoft.com/devicelogin',userCode:'ABCDE1234',message:'SECRET',deviceCode:'SECRET'}); setInterval(()=>{},1000);`,
      ),
  );
  setTimeout(() => stop.abort(), 150);
  await assert.rejects(
    msal.authorizeInWorker(
      delegated.loadDelegatedIdentity(env),
      stop.signal,
      (...args) => logs.push(args),
      worker,
    ),
  );
  assert.deepEqual(logs, [
    ["https://microsoft.com/devicelogin"],
    ["ABCDE1234"],
  ]);
  assert.throws(() =>
    msal.publicDeviceMessage({
      verificationUri: "https://evil.invalid",
      userCode: "ABCDE1234",
    }),
  );
  assert.throws(() =>
    msal.publicDeviceMessage({
      verificationUri: "https://microsoft.com/devicelogin",
      userCode: "SECRET\nDATA",
    }),
  );
});

test("MSAL network client pins exact tenant endpoints and forbids redirects", async () => {
  const f = await fixture((_req: any, res: any) =>
    res.end(JSON.stringify({ test: true })),
  );
  try {
    const requests: string[] = [];
    const network = msal.microsoftNetwork(
      delegated.loadDelegatedIdentity(env),
      async (url, init) => {
        requests.push(String(url));
        assert.equal(init?.redirect, "error");
        return fetch(f.url, init);
      },
    );
    assert.equal(
      (
        await network.sendPostRequestAsync<any>(
          `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
          { body: "synthetic" },
        )
      ).body.test,
      true,
    );
    for (const url of [
      "https://evil.invalid/token",
      `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
      `https://login.microsoftonline.com/${tenant}/arbitrary`,
    ])
      await assert.rejects(network.sendPostRequestAsync(url, {}));
    assert.equal(requests.length, 1);
  } finally {
    await f.close();
  }
});

test("bootstrap requires explicit approval and privately verifies only the dedicated cache", async () => {
  let calls = 0;
  const logs: string[] = [];
  const writes: string[][] = [];
  const runner = async (args: string[], input?: string) => {
    writes.push(args);
    assert.ok(!args.includes("SYNTHETIC-CACHE"));
    return input ? "" : "SYNTHETIC-CACHE";
  };
  const authorize = async (
    _c: any,
    _signal: AbortSignal,
    log: (s: string) => void,
  ) => {
    calls++;
    log("https://microsoft.com/devicelogin");
    return { result: result as any, cache: "SYNTHETIC-CACHE" };
  };
  const deps = { authorize, runner, log: (s: string) => logs.push(s) };
  assert.equal((await oauth.runMicrosoftBootstrap([], env, deps)).ok, false);
  assert.equal(
    (await oauth.runMicrosoftBootstrap(["--help"], {}, deps)).ok,
    true,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await oauth.runMicrosoftBootstrap(["--authorize"], env, deps)).ok,
    true,
  );
  assert.equal(writes.length, 2);
  assert.equal(writes[0][2], "CALENDAR_M365_DELEGATED_MSAL_CACHE");
  assert.ok(!logs.join("").includes("SYNTHETIC"));
  const bad = await oauth.runMicrosoftBootstrap(["--authorize"], env, {
    ...deps,
    authorize: async () => ({
      result: {
        ...result,
        account: { ...account, username: "other@example.com" },
      },
      cache: "bad",
    }),
  } as any);
  assert.equal(bad.ok, false);
  assert.equal(writes.length, 2);
  const mismatch = await oauth.runMicrosoftBootstrap(["--authorize"], env, {
    ...deps,
    runner: async () => "different",
  });
  assert.match(mismatch.message, /unverified/);
  // Exercise the existing actual private child runner, no Doppler or real secrets.
  assert.equal(
    await runPrivate([], "SYNTHETIC-CACHE", {
      executable: process.execPath,
      prefix: ["-e", "process.stdin.pipe(process.stdout)"],
    }),
    "SYNTHETIC-CACHE",
  );
});
const tenant = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";
const oid = "33333333-3333-4333-8333-333333333333";
const env = {
  CALENDAR_M365_DELEGATED_TENANT_ID: tenant,
  CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: "owner@example.invalid",
  CALENDAR_M365_DELEGATED_CLIENT_ID: client,
  CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID: oid,
};
const account = {
  homeAccountId: `${oid}.${tenant}`,
  localAccountId: oid,
  environment: "login.microsoftonline.com",
  tenantId: tenant,
  username: "owner@example.invalid",
};
const result = {
  account,
  tenantId: tenant,
  scopes: ["Calendars.ReadBasic"],
  accessToken: "SYNTHETIC",
  idTokenClaims: {
    tid: tenant,
    oid,
    aud: client,
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    preferred_username: "owner@example.invalid",
  },
};
test("dedicated identity config and MSAL claims reject other accounts and generic fallback", () => {
  const c = delegated.loadDelegatedIdentity(env);
  assert.equal(c.authority, `https://login.microsoftonline.com/${tenant}`);
  assert.throws(() =>
    delegated.loadDelegatedIdentity({
      M365_TENANT_ID: tenant,
      M365_CLIENT_ID: client,
    }),
  );
  delegated.verifyDelegatedResult(c, result as any);
  for (const changed of [
    { account: { ...account, username: "other@example.invalid" } },
    { idTokenClaims: { ...result.idTokenClaims, oid: client } },
    { tenantId: client },
    { scopes: ["Calendars.ReadWrite"] },
  ])
    assert.throws(() =>
      delegated.verifyDelegatedResult(c, { ...result, ...changed } as any),
    );
});
