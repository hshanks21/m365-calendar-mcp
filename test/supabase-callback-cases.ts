import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { connect } from "node:net";
import { env, sdkFixture } from "./supabase-fixtures.js";
test("Supabase standalone bootstrap stores real MSAL cache through private exact-key write/readback only; errors suppressed", async () => {
  const m = await api();
  assert.equal(typeof m.runSupabaseBootstrap, "function");
  for (const mode of [
    "success",
    "write",
    "readback",
    "provider",
    "cancel",
    "identity_pre",
    "identity_post",
  ]) {
    const f = sdkFixture();
    let written = "";
    const calls: string[][] = [];
    const logs: string[] = [];
    let delivery: Promise<unknown> | undefined;
    const stop = new AbortController();
    if (mode === "provider")
      f.token({
        error: "invalid_client",
        error_description: "SYNTHETIC-private-error",
        access_token: undefined,
      });
    if (mode === "identity_pre") f.userChange({ identities: [] });
    if (mode === "identity_post")
      f.claims({ sub: "SYNTHETIC-private-subject" });
    const result = await m.runSupabaseBootstrap(["--authorize"], env, {
      fetcher: f.fetcher,
      signal: stop.signal,
      log: (line: string) => {
        logs.push(line);
        if (!line.startsWith("http://")) return;
        if (mode === "cancel") {
          stop.abort();
          return;
        }
        delivery = (async () => {
          const u = new URL(line);
          const begin = await req(u.pathname + u.search);
          const consent = new URL(begin.headers.location);
          f.challenge(consent.searchParams.get("code_challenge")!);
          const cookie = begin.headers["set-cookie"][0].split(";")[0];
          await req("/supabase/callback?code=SYNTHETIC-code", {
            Cookie: cookie,
          });
        })();
      },
      runner: async (args: string[], input?: string) => {
        calls.push(args);
        if (mode === "write") throw Error("SYNTHETIC-private-error");
        if (input) {
          written = input;
          return "";
        }
        return mode === "readback" ? "SYNTHETIC-mismatch" : written;
      },
    });
    await delivery;
    assert.equal(result.ok, mode === "success");
    assert.ok(!result.message.includes("SYNTHETIC"));
    assert.ok(!logs.join(" ").includes("SYNTHETIC"));
    if (mode === "success") {
      assert.equal(calls.length, 2);
      assert.deepEqual(
        calls.map((a) => a.slice(0, 3)),
        [
          ["secrets", "set", "CALENDAR_M365_DELEGATED_MSAL_CACHE"],
          ["secrets", "get", "CALENDAR_M365_DELEGATED_MSAL_CACHE"],
        ],
      );
      assert.ok(written.includes("SYNTHETIC-refresh"));
      assert.ok(!written.includes("SYNTHETIC-supabase"));
    } else
      assert.match(
        result.message,
        new RegExp(
          "stage=" +
            (
              {
                write: "doppler_write",
                readback: "doppler_readback",
                provider: "token_exchange",
                cancel: "cancelled",
                identity_pre: "identity_scopes",
                identity_post: "identity_scopes",
              } as any
            )[mode],
        ),
      );
    if (["provider", "cancel", "identity_pre", "identity_post"].includes(mode))
      assert.equal(calls.length, 0);
    if (mode.startsWith("identity_")) {
      assert.match(
        result.message,
        new RegExp(
          "reason=" +
            (mode === "identity_pre"
              ? "supabase_identity_count"
              : "microsoft_subject"),
        ),
      );
      assert.doesNotMatch(
        result.message + logs.join(" "),
        /SYNTHETIC|azure-sub|supabase-user|example|11111111|22222222|33333333/,
      );
    }
  }
});
test("Supabase callback cancel, timeout, denial, occupied port and active slow headers clean up", async () => {
  const m = await api();
  const url =
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?provider=azure";
  for (const mode of ["cancel", "timeout", "denial", "slow"]) {
    const stop = new AbortController();
    const cb = await m.startSupabaseCallback(
      url,
      mode === "timeout" ? AbortSignal.timeout(50) : stop.signal,
      "https://abcdefghijklmnopqrst.supabase.co",
    );
    try {
      await assert.rejects(
        m.startSupabaseCallback(
          url,
          stop.signal,
          "https://abcdefghijklmnopqrst.supabase.co",
        ),
      );
      if (mode === "cancel") stop.abort();
      if (mode === "denial") {
        const u = new URL(cb.url);
        const begin = await req(u.pathname + u.search);
        await req(
          "/supabase/callback?error=denied&error_description=SYNTHETIC-secret",
          { Cookie: begin.headers["set-cookie"][0].split(";")[0] },
        );
      }
      if (mode === "slow") {
        const socket = connect(8766, "127.0.0.1");
        let timer: NodeJS.Timeout | undefined;
        try {
          await new Promise<void>((yes, no) => {
            socket.once("connect", yes);
            socket.once("error", no);
          });
          socket.write(
            "GET /supabase/callback? HTTP/1.1\r\nHost: localhost:8766\r\nX-Slow: ",
          );
          timer = setInterval(() => socket.write("x"), 100);
          await Promise.race([
            new Promise<void>((yes) => socket.once("close", () => yes())),
            new Promise((_, no) =>
              setTimeout(
                () => no(Error("socket lifetime exceeded")),
                6000,
              ).unref(),
            ),
          ]);
        } finally {
          clearInterval(timer);
          socket.destroy();
          stop.abort();
        }
      }
      await assert.rejects(cb.code);
    } finally {
      await cb.close();
    }
  }
});
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("actual Supabase CLI suppresses provider details and tokens through SDK failure", async () => {
  const source = `
 const {sdkFixture}=await import(${JSON.stringify(new URL("./supabase-fixtures.js", import.meta.url).href)});
 const f=sdkFixture();f.token({error:'invalid_client',error_description:'SYNTHETIC-private-provider-error',access_token:undefined});globalThis.fetch=f.fetcher;
 const {request}=await import('node:http');
 const call=(path,headers={})=>new Promise((yes,no)=>{const r=request({host:'127.0.0.1',port:8766,path,headers:{Host:'localhost:8766',...headers}},res=>{res.resume();res.on('end',()=>yes(res.headers));});r.on('error',no);r.end();});
 const out=console.log;console.log=line=>{if(!line.startsWith('http://'))return out(line);(async()=>{const u=new URL(line);const h=await call(u.pathname+u.search);f.challenge(new URL(h.location).searchParams.get('code_challenge'));await call('/supabase/callback?code=SYNTHETIC-code',{Cookie:h['set-cookie'][0].split(';')[0]});})().catch(()=>{});};
 await import(${JSON.stringify(new URL("../src/supabase-cli.js", import.meta.url).href)});
 `;
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        source,
        "--",
        "unused",
        "--authorize",
      ],
      { env: { PATH: process.env.PATH, ...env }, timeout: 10000 },
    ),
    (e: any) => {
      assert.equal(e.code, 1);
      assert.match(e.stderr, /stage=token_exchange/);
      assert.ok(!e.stdout.includes("SYNTHETIC"));
      assert.ok(!e.stderr.includes("SYNTHETIC"));
      return true;
    },
  );
});
const modulePath = "../src/supabase-bootstrap.js";
const api = () => import(modulePath).catch(() => ({}) as any);
function req(
  path: string,
  headers: Record<string, string> = {},
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
          headers: { Host: "localhost:8766", ...headers },
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
test("Supabase exact callback uses one-time local start state cookie, strict raw callback and no token browser response", async () => {
  const m = await api();
  assert.equal(typeof m.startSupabaseCallback, "function");
  const stop = new AbortController();
  const cb = await m.startSupabaseCallback(
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?provider=azure",
    stop.signal,
    "https://abcdefghijklmnopqrst.supabase.co",
  );
  try {
    const start = new URL(cb.url);
    assert.equal(start.origin, "http://localhost:8766");
    assert.match(start.searchParams.get("state")!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(
      (await req("/supabase/callback?code=SYNTHETIC-code")).status,
      400,
    );
    const begin = await req(start.pathname + start.search);
    assert.equal(begin.status, 302);
    assert.match(begin.headers["set-cookie"][0], /HttpOnly/);
    assert.match(begin.headers["set-cookie"][0], /SameSite=Lax/);
    const cookie = begin.headers["set-cookie"][0].split(";")[0];
    assert.equal((await req(start.pathname + start.search)).status, 400);
    for (const [path, headers, method] of [
      [
        "/supabase/callback?code=SYNTHETIC-code",
        { Cookie: "calendar_bootstrap_state=wrong" },
      ],
      [
        "/supabase/callback?code=SYNTHETIC-code",
        { Cookie: cookie + "; " + cookie },
      ],
      [
        "/supabase/callback?code=SYNTHETIC-code",
        { Cookie: cookie, Host: "evil.invalid" },
      ],
      ["/supabase/callback?code=SYNTHETIC-code", { Cookie: cookie }, "POST"],
      [
        "/supabase/callback?code=SYNTHETIC-code",
        { Cookie: cookie, "Content-Length": "1" },
      ],
      [
        "/supabase/callback?code=SYNTHETIC-code&code=duplicate",
        { Cookie: cookie },
      ],
      [
        "/supabase/callback?code=SYNTHETIC-code&state=ignored",
        { Cookie: cookie },
      ],
      [
        "/supabase/callback?code=SYNTHETIC-code&error=SECRET",
        { Cookie: cookie },
      ],
      ["/supabase/callback?code=%GG", { Cookie: cookie }],
      ["/supabase/x/../callback?code=SYNTHETIC-code", { Cookie: cookie }],
    ] as [string, Record<string, string>, string?][]) {
      const r = await req(path, headers, method);
      assert.equal(r.status, 400);
      assert.ok(!r.body.includes("SYNTHETIC"));
    }
    const raw = await new Promise<string>((resolve, reject) => {
      const s = connect(8766, "127.0.0.1", () =>
        s.end(
          `GET /supabase/callback?code=SYNTHETIC-code HTTP/1.1\r\nHost: localhost:8766\r\nHost: evil.invalid\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`,
        ),
      );
      let out = "";
      s.on("data", (d) => (out += d));
      s.on("end", () => resolve(out));
      s.on("error", reject);
    });
    assert.match(raw, /400/);
    const done = await req("/supabase/callback?code=SYNTHETIC-code", {
      Cookie: cookie,
    });
    assert.equal(done.status, 200);
    assert.equal(done.headers["cache-control"], "no-store");
    assert.match(done.headers["set-cookie"][0], /Max-Age=0/);
    assert.ok(!done.body.includes("SYNTHETIC"));
    assert.equal(await cb.code, "SYNTHETIC-code");
    await assert.rejects(
      req("/supabase/callback?code=replay", { Cookie: cookie }),
    );
  } finally {
    await cb.close();
  }
});
