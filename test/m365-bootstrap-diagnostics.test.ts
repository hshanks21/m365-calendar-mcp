import test from "node:test";
import {
  microsoftResponseReason,
  microsoftMsalReason,
} from "../src/m365-diagnostics.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runMicrosoftBootstrap } from "../src/m365-oauth.js";
import {
  authorizeInWorker,
  microsoftNetwork,
  MicrosoftAuthorizationFailure,
} from "../src/m365-msal.js";

const tenant = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";
const oid = "33333333-3333-4333-8333-333333333333";
const env = {
  CALENDAR_M365_DELEGATED_TENANT_ID: tenant,
  CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: "owner@example.invalid",
  CALENDAR_M365_DELEGATED_CLIENT_ID: client,
  CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID: oid,
};
// Import-only transport replacement; every request is answered in memory.
// The real MSAL client, worker, validation and bootstrap orchestration still run.
function worker(mode: string) {
  const claims = {
    tid: tenant,
    oid,
    aud: client,
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    preferred_username:
      mode === "identity_scopes"
        ? "other@example.invalid"
        : "owner@example.invalid",
    sub: oid,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const jwt =
    [{ alg: "RS256", typ: "JWT" }, claims]
      .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
      .join(".") + ".synthetic";
  const token = {
    token_type: "Bearer",
    scope:
      mode === "extra_scope"
        ? "Calendars.ReadBasic Mail.Read"
        : "Calendars.ReadBasic",
    expires_in: 3600,
    access_token: "SYNTHETIC-ACCESS",
    ...(mode === "cache_validation"
      ? {}
      : { refresh_token: "SYNTHETIC-REFRESH" }),
    id_token: jwt,
    client_info: Buffer.from(
      JSON.stringify({ uid: oid, utid: tenant }),
    ).toString("base64url"),
  };
  return new URL(
    "data:text/javascript," +
      encodeURIComponent(`
    import {tsImport} from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))};
    let polls=0;
    globalThis.fetch=async(url,init)=> {
      const path=new URL(String(url)).pathname;
      if(path.endsWith('/devicecode')) {
        if(${JSON.stringify(mode)}==='device_start') throw Error('RAW-PROVIDER-SECRET');
        return new Response(JSON.stringify({device_code:'PRIVATE-DEVICE-SECRET', user_code:'ABCDE1234', verification_uri:${JSON.stringify(mode === "device_display" ? "https://evil.invalid/RAW-PROVIDER-SECRET" : "https://login.microsoft.com/device")}, expires_in:300, interval:0, message:'RAW-PROVIDER-SECRET'}));
      }
      if(path.endsWith('/token')) {
        const form=new URLSearchParams(init.body);
        if(init.method!=='POST'||form.get('grant_type')!=='device_code'||form.get('device_code')!=='PRIVATE-DEVICE-SECRET'||form.has('client_secret')) throw Error('BAD-SYNTHETIC-REQUEST');
        if(${JSON.stringify(mode)}==='pending' && polls++===0) return Response.json({error:'authorization_pending'},{status:400});
        if(${JSON.stringify(mode)}==='bad_id_token') return Response.json({...${JSON.stringify(token)},id_token:'not-a-jwt'});
        if(${JSON.stringify(mode)}==='transport') throw Error('RAW-PROVIDER-SECRET');
        if(${JSON.stringify(mode)}==='malformed') return new Response('RAW-PROVIDER-SECRET');
        if(${JSON.stringify(mode)}==='client_auth') return new Response(JSON.stringify({error:'invalid_client',error_codes:[7000218],error_description:'RAW-PROVIDER-SECRET',claims:'RAW-PROVIDER-SECRET'}),{status:400});
        if(${JSON.stringify(mode)}==='unknown_provider') return new Response(JSON.stringify({error:'RAW-PROVIDER-SECRET',error_codes:[123456789]}),{status:400});
        if(${JSON.stringify(mode)}==='token_exchange') return new Response(JSON.stringify({error:'invalid_grant',error_description:'RAW-PROVIDER-SECRET'}),{status:400});
        return new Response(${JSON.stringify(JSON.stringify(token))});
      }
      throw Error('UNEXPECTED-NETWORK-SECRET');
    };
    await tsImport(${JSON.stringify(new URL(`../src/m365-device-worker.${import.meta.url.endsWith(".js") ? "js" : "ts"}`, import.meta.url).href)},${JSON.stringify(import.meta.url)});
  `),
  );
}

test("classifiers map only fixed provider and MSAL codes, never descriptions", () => {
  for (const [code, reason] of [
    [53003, "policy_blocked"],
    [65001, "consent_required"],
    [50105, "assignment_required"],
  ] as const)
    assert.equal(
      microsoftResponseReason({ error: "invalid_grant", error_codes: [code] }),
      reason,
    );
  for (const [code, reason] of [
    ["authorization_declined", "provider_declined"],
    ["expired_token", "provider_expired"],
    ["slow_down", "provider_slow_down"],
    ["invalid_client", "provider_client_refused"],
  ] as const)
    assert.equal(microsoftResponseReason({ error: code }), reason);
  assert.equal(
    microsoftMsalReason({ errorCode: "post_request_failed" }),
    "msal_post_failed",
  );
  assert.equal(
    microsoftResponseReason({
      error: "UNKNOWN-SECRET",
      error_description: "AADSTS7000218",
      error_codes: ["7000218"],
    }),
    "provider_other",
  );
  assert.equal(
    microsoftMsalReason({
      errorCode: "UNKNOWN-SECRET",
      message: "token_parsing_error",
    }),
    "unclassified",
  );
  assert.equal(
    microsoftResponseReason({
      error: "authorization_pending",
      error_codes: [7000218],
    }),
    "unclassified",
  );
});

test("bounded transport and provider reasons survive actual worker", async () => {
  for (const [mode, reason] of Object.entries({
    transport: "transport_failure",
    malformed: "response_json",
    client_auth: "client_auth_required",
    unknown_provider: "provider_other",
    bad_id_token: "msal_token_parse",
  })) {
    const result = await runMicrosoftBootstrap(["--authorize"], env, {
      authorize: (c, s, l) => authorizeInWorker(c, s, l, worker(mode)),
      log: () => {},
      runner: async () => assert.fail("no storage"),
    });
    assert.equal(result.ok, false);
    assert.ok(result.message.includes(`[reason=${reason}]`), result.message);
    assert.doesNotMatch(
      result.message,
      /SECRET|7000218|123456789|invalid_client/,
    );
  }
});

test("local network failures have bounded reasons without relaxing endpoints", async () => {
  const c = {
    tenantId: tenant,
    clientId: client,
    objectId: oid,
    authority: `https://login.microsoftonline.com/${tenant}`,
  } as any;
  for (const [path, response, expected] of [
    ["/common/oauth2/v2.0/token", () => Response.json({}), "endpoint_refused"],
    [
      `/${tenant}/oauth2/v2.0/token`,
      () => new Response(null, { status: 204 }),
      "response_empty",
    ],
    [
      `/${tenant}/oauth2/v2.0/token`,
      () => new Response("x".repeat(262145)),
      "response_limit",
    ],
    [
      `/${tenant}/oauth2/v2.0/token`,
      () => {
        throw new DOMException("SECRET", "TimeoutError");
      },
      "transport_timeout",
    ],
  ] as const) {
    let reason = "";
    let fetched = false;
    const network = microsoftNetwork(
      c,
      (async () => {
        fetched = true;
        return response();
      }) as typeof fetch,
      (value) => {
        reason = value;
      },
    );
    await assert.rejects(
      network.sendPostRequestAsync("https://login.microsoftonline.com" + path),
    );
    assert.equal(reason, expected);
    if (expected === "endpoint_refused") assert.equal(fetched, false);
  }
  assert.equal(
    new MicrosoftAuthorizationFailure("token_exchange", "RAW-SECRET").reason,
    "unclassified",
  );
});

test("CLI configuration refusal prints a fixed stage without injected values", async () => {
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        import.meta.url.endsWith(".js")
          ? "dist/src/m365-oauth-cli.js"
          : "src/m365-oauth-cli.ts",
        "--authorize",
      ],
      {
        env: {
          PATH: process.env.PATH,
          CALENDAR_M365_DELEGATED_TENANT_ID: "RAW-PROVIDER-SECRET",
        },
        timeout: 5000,
      },
    ),
    (e: any) => {
      assert.equal(e.code, 1);
      assert.equal(e.stdout, "");
      assert.match(e.stderr, /stage=configuration\]/);
      assert.doesNotMatch(e.stderr, /RAW-PROVIDER-SECRET/);
      return true;
    },
  );
});

test("local timeout is distinct from cancellation without real sign-in waiting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = runMicrosoftBootstrap(
    ["--authorize", "--timeout-seconds", "30"],
    env,
    {
      authorize: async (_c, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(Error("RAW-PROVIDER-SECRET")),
            { once: true },
          ),
        ),
      runner: async () => {
        assert.fail("no storage after timeout");
      },
    },
  );
  t.mock.timers.tick(30000);
  assert.match((await pending).message, /stage=timeout\]/);
  t.mock.timers.reset();
  const stop = new AbortController();
  stop.abort("RAW-PROVIDER-SECRET");
  const cancelled = await runMicrosoftBootstrap(["--authorize"], env, {
    signal: stop.signal,
    authorize: async () => {
      assert.fail("no authorization after cancellation");
    },
  });
  assert.match(cancelled.message, /stage=cancelled\]/);
  assert.doesNotMatch(cancelled.message, /RAW-PROVIDER-SECRET/);
});

test("actual CLI relays token exchange stage and only two public device lines", async () => {
  // Child-only built-in replacement selects our import-only synthetic worker.
  const preload = new URL(
    "data:text/javascript," +
      encodeURIComponent(`
    import threads from 'node:worker_threads';
    import {syncBuiltinESMExports} from 'node:module';
    const Original=threads.Worker;
    threads.Worker=class extends Original { constructor(_url,options) { super(new URL(${JSON.stringify(worker("token_exchange").href)}),options); } };
    syncBuiltinESMExports();
  `),
  );
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        preload.href,
        import.meta.url.endsWith(".js")
          ? "dist/src/m365-oauth-cli.js"
          : "src/m365-oauth-cli.ts",
        "--authorize",
      ],
      { env: { PATH: process.env.PATH, ...env }, timeout: 5000 },
    ),
    (e: any) => {
      assert.equal(e.code, 1);
      assert.equal(e.stdout, "https://login.microsoft.com/device\nABCDE1234\n");
      assert.match(e.stderr, /stage=token_exchange\]/);
      assert.match(e.stderr, /reason=provider_grant_refused\]/);
      assert.doesNotMatch(e.stderr, /SECRET|SYNTHETIC|invalid_grant/);
      return true;
    },
  );
});

test("storage write and read-back failures remain distinct and never expose cache", async () => {
  for (const mode of ["write", "read", "mismatch"]) {
    let calls = 0;
    const outcome = await runMicrosoftBootstrap(["--authorize"], env, {
      authorize: (c, signal, log) =>
        authorizeInWorker(c, signal, log, worker("success")),
      log: () => {},
      runner: async () => {
        calls++;
        if (mode !== "mismatch" && calls === (mode === "write" ? 1 : 2))
          throw Error("RAW-PROVIDER-SECRET");
        return "MISMATCH-SECRET";
      },
    });
    assert.equal(outcome.ok, false);
    assert.match(
      outcome.message,
      mode === "write" ? /stage=doppler_write\]/ : /stage=doppler_readback\]/,
    );
    assert.match(
      outcome.message,
      mode === "write" ? /failed or uncertain/ : /unverified/,
    );
    assert.equal(calls, mode === "write" ? 1 : 2);
    assert.doesNotMatch(outcome.message, /SECRET|SYNTHETIC/);
  }
});

test("worker-supplied unknown stage is never reflected", async () => {
  const url = new URL(
    "data:text/javascript," +
      encodeURIComponent(
        "import {parentPort} from 'node:worker_threads';parentPort.postMessage({kind:'error',stage:'RAW-PROVIDER-SECRET',message:'RAW-PROVIDER-SECRET'});",
      ),
  );
  const outcome = await runMicrosoftBootstrap(["--authorize"], env, {
    authorize: (c, signal, log) => authorizeInWorker(c, signal, log, url),
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /stage=authorization\]/);
  assert.doesNotMatch(outcome.message, /SECRET/);
});

test("actual MSAL worker failures retain only fixed stages through bootstrap", async () => {
  for (const mode of [
    "device_start",
    "device_display",
    "token_exchange",
    "identity_scopes",
    "extra_scope",
    "cache_validation",
    "success",
    "pending",
  ]) {
    const logs: unknown[][] = [];
    let writes = 0;
    let saved = "";
    const outcome = await runMicrosoftBootstrap(["--authorize"], env, {
      authorize: (c, signal, log) =>
        authorizeInWorker(c, signal, log, worker(mode)),
      log: (...args) => logs.push(args),
      runner: async (_args, input) => {
        writes++;
        if (input) saved = input;
        return input ? "" : saved;
      },
    });
    assert.equal(outcome.ok, ["success", "pending"].includes(mode), mode);
    if (!["success", "pending"].includes(mode))
      assert.match(
        outcome.message,
        new RegExp(
          `stage=${mode === "extra_scope" ? "identity_scopes" : mode}\\]`,
        ),
      );
    assert.equal(writes, ["success", "pending"].includes(mode) ? 2 : 0, mode);
    assert.deepEqual(
      logs,
      ["device_start", "device_display"].includes(mode)
        ? []
        : [["https://login.microsoft.com/device"], ["ABCDE1234"]],
    );
    assert.doesNotMatch(
      outcome.message,
      /SECRET|SYNTHETIC|invalid_grant|other@example/,
    );
  }
});
