import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { request } from "node:https";
import { startApplication } from "../src/runtime.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../src/dashboard.js";
import { Telemetry } from "../src/telemetry.js";
// Ephemeral, self-signed TEST ONLY material. Never used to expose a LAN listener.
function fixture(dir: string) {
  const certFile = join(dir, "TEST-ONLY-cert.pem"),
    keyFile = join(dir, "TEST-ONLY-key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=TEST ONLY calendar",
      "-addext",
      "subjectAltName=IP:127.0.0.1,IP:192.168.2.40,DNS:localhost",
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore" },
  );
  chmodSync(keyFile, 0o600);
  return { bindAddress: "127.0.0.1", certFile, keyFile };
}
const secret = "TEST-ONLY-VIEWER-" + "x".repeat(40);
test("nonloopback dashboard refuses plaintext before binding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-TLS-"));
  let server: Awaited<ReturnType<typeof startDashboard>> | undefined;
  try {
    await assert.rejects(async () => {
      server = await startDashboard(
        {
          secret,
          telemetry: new Telemetry(join(dir, "events.json")),
          config: null,
          mcpUp: false,
          transport: { bindAddress: "192.168.2.40" },
        } as any,
        0,
      );
    }, /Invalid dashboard transport/);
  } finally {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real HTTPS dashboard enforces authentication, exact origin, secure cookies and throttling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-TLS-"));
  let server: Awaited<ReturnType<typeof startDashboard>> | undefined;
  try {
    const transport = fixture(dir);
    server = await startDashboard(
      {
        secret,
        telemetry: new Telemetry(join(dir, "events.json")),
        config: null,
        mcpUp: false,
        transport,
      },
      0,
    );
    assert.match(server.url, /^https:\/\/127\.0\.0\.1:/);
    const root = server.url;
    const call = (
      path: string,
      method = "GET",
      headers: Record<string, string> = {},
      token = secret,
    ) =>
      new Promise<{
        status: number;
        headers: import("node:http").IncomingHttpHeaders;
      }>((resolve, reject) => {
        const req = request(
          root + path,
          {
            method,
            servername: "localhost",
            ca: readFileSync(transport.certFile),
            headers: { "Content-Type": "application/json", ...headers },
          },
          (res) => {
            res.resume();
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers }),
            );
          },
        );
        req.on("error", reject);
        req.end(method === "POST" ? JSON.stringify({ token }) : undefined);
      });
    assert.equal((await call("/api/diagnostics")).status, 401);
    for (const origin of [
      "https://evil.invalid",
      root.replace("https:", "http:"),
      "https://127.0.0.1:1",
      "null",
      root + "/",
      root.replace("127.0.0.1", "localhost"),
    ]) {
      assert.equal(
        (await call("/login", "POST", { Origin: origin })).status,
        403,
      );
    }
    assert.equal((await call("/login", "POST")).status, 403);
    assert.equal(
      (
        await call("/", "GET", {
          Host: "evil.invalid",
          "X-Forwarded-Host": new URL(root).host,
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/", "GET", { "Sec-Fetch-Site": "cross-site" })).status,
      403,
    );
    assert.equal(
      (await call("/login", "POST", { Origin: root }, "wrong")).status,
      401,
    );
    const login = await call("/login", "POST", { Origin: root });
    assert.equal(login.status, 204);
    const cookie = login.headers["set-cookie"]![0];
    for (const flag of [
      /; Secure/,
      /; HttpOnly/,
      /; SameSite=Strict/,
      /; Path=\//,
    ])
      assert.match(cookie, flag);
    assert.doesNotMatch(cookie, /Domain=/);
    const headers = { Cookie: cookie.split(";")[0] };
    const data = await call("/api/diagnostics", "GET", headers);
    assert.equal(data.status, 200);
    assert.equal(data.headers["access-control-allow-origin"], undefined);
    assert.equal((await call("/logout", "POST", headers)).status, 403);
    const logout = await call("/logout", "POST", { ...headers, Origin: root });
    assert.equal(logout.status, 204);
    assert.match(logout.headers["set-cookie"]![0], /; Secure/);
    assert.equal((await call("/api/diagnostics", "GET", headers)).status, 401);
    for (let i = 0; i < 8; i++)
      await call("/login", "POST", { Origin: root }, "wrong");
    assert.equal((await call("/login", "POST", { Origin: root })).status, 429);
  } finally {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("transport validates explicit private IPv4 and TLS material without listening", async () => {
  const module = await import("../src/dashboard-transport.js").catch(() => ({
    validateDashboardTransport: undefined,
  }));
  assert.equal(typeof module.validateDashboardTransport, "function");
  const validate = module.validateDashboardTransport!;
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-TLS-"));
  try {
    const transport = fixture(dir);
    assert.equal(validate().bindAddress, "127.0.0.1");
    assert.equal(validate().tls, undefined);
    assert.equal(
      validate({ ...transport, bindAddress: "192.168.2.40" }).bindAddress,
      "192.168.2.40",
    );
    for (const bindAddress of [
      "",
      "0.0.0.0",
      "::",
      "::1",
      "localhost",
      "8.8.8.8",
      "192.168.2.40 ",
      "192.168.002.40",
      "192.168.2.41",
    ]) {
      assert.throws(
        () => validate({ ...transport, bindAddress }),
        /Invalid dashboard transport/,
      );
    }
    for (const bad of [
      { bindAddress: "192.168.2.40" },
      { certFile: transport.certFile },
      { keyFile: transport.keyFile },
      { ...transport, certFile: "relative.pem" },
      { ...transport, keyFile: "" },
      { ...transport, certFile: dir },
      { ...transport, keyFile: join(dir, "missing") },
      { ...transport, certFile: transport.keyFile },
      { ...transport, keyFile: transport.certFile },
    ])
      assert.throws(() => validate(bad), /Invalid dashboard transport/);
    chmodSync(transport.keyFile, 0o644);
    assert.throws(() => validate(transport), /Invalid dashboard transport/);
    chmodSync(transport.keyFile, 0o600);
    const other = mkdtempSync(join(dir, "other-"));
    assert.throws(
      () => validate({ ...transport, keyFile: fixture(other).keyFile }),
      /Invalid dashboard transport/,
    );
    writeFileSync(transport.certFile, "not a certificate");
    assert.throws(() => validate(transport), /Invalid dashboard transport/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime opts into HTTPS via env while MCP remains loopback HTTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-TLS-"));
  let s: Awaited<ReturnType<typeof startApplication>> | undefined;
  try {
    const transport = fixture(dir);
    s = await startApplication(
      {
        CALENDAR_DASHBOARD_SECRET: secret,
        CALENDAR_TELEMETRY_FILE: join(dir, "telemetry.json"),
        CALENDAR_DASHBOARD_BIND_ADDRESS: transport.bindAddress,
        CALENDAR_DASHBOARD_TLS_CERT_FILE: transport.certFile,
        CALENDAR_DASHBOARD_TLS_KEY_FILE: transport.keyFile,
        CALENDAR_GOOGLE_CLIENT_ID: "fake.apps.googleusercontent.com",
        CALENDAR_GOOGLE_CLIENT_SECRET: "TEST-secret",
        CALENDAR_GOOGLE_REFRESH_TOKEN: "TEST-refresh",
        CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify({
          calendars: { family: { calendarId: "fake@example.invalid" } },
          clients: [
            {
              id: "family",
              secret: "TEST-" + "g".repeat(40),
              calendarKeys: ["family"],
              writeCalendarKeys: [],
            },
          ],
        }),
      },
      { dashboard: 0, mcp: 0 },
    );
    assert.match(s.dashboard.url, /^https:\/\/127\.0\.0\.1:/);
    assert.match(s.mcp!.url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal((await fetch(s.mcp!.url)).status, 401);
    await new Promise<void>((resolve, reject) => {
      const req = request(
        s!.dashboard.url,
        { ca: readFileSync(transport.certFile) },
        (res) => {
          res.resume();
          res.on("end", () => {
            try {
              assert.equal(res.statusCode, 200);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid runtime TLS fails before either listen; valid LAN bind is exact (intercepted, never exposed)", async () => {
  const { Server } = await import("node:net");
  const original = Server.prototype.listen;
  const calls: unknown[][] = [];
  Server.prototype.listen = function (...args: any[]) {
    calls.push(args);
    throw Error("TEST-ONLY intercepted listen");
  } as any;
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-TLS-"));
  try {
    for (const env of [
      { CALENDAR_DASHBOARD_BIND_ADDRESS: "192.168.2.40" },
      {
        CALENDAR_DASHBOARD_TLS_CERT_FILE: "/missing-TEST-cert",
        CALENDAR_DASHBOARD_TLS_KEY_FILE: "/missing-TEST-key",
      },
      { CALENDAR_DASHBOARD_BIND_ADDRESS: "" },
    ]) {
      await assert.rejects(
        startApplication(
          {
            CALENDAR_DASHBOARD_SECRET: secret,
            CALENDAR_TELEMETRY_FILE: join(dir, "events.json"),
            ...env,
          },
          { dashboard: 0, mcp: 0 },
        ),
        /Invalid dashboard transport/,
      );
      assert.equal(calls.length, 0);
    }
    const transport = { ...fixture(dir), bindAddress: "192.168.2.40" };
    await assert.rejects(
      startDashboard(
        {
          secret,
          telemetry: new Telemetry(join(dir, "events.json")),
          config: null,
          mcpUp: false,
          transport,
        },
        3218,
      ),
      /TEST-ONLY intercepted listen/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 3218);
    assert.equal(calls[0][1], "192.168.2.40");
  } finally {
    Server.prototype.listen = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LAN HTTPS exact 192.168.2.40:3218 Host and Origin over redirected loopback fixture", async () => {
  // Redirect ONLY the socket binding in this test. The app retains the real LAN
  // transport/origin; no LAN interface or production port is ever opened.
  const { Server } = await import("node:net");
  const original = Server.prototype.listen;
  let actualPort = 0;
  Server.prototype.listen = function (
    this: import("node:net").Server,
    port: number,
    host: string,
    callback: () => void,
  ) {
    assert.equal(port, 3218);
    assert.equal(host, "192.168.2.40");
    return original.call(this, { port: 0, host: "127.0.0.1" }, () => {
      const address = this.address() as import("node:net").AddressInfo;
      actualPort = address.port;
      this.address = () => ({ ...address, address: host, port });
      callback();
    });
  } as any;
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-TLS-"));
  let s: Awaited<ReturnType<typeof startDashboard>> | undefined;
  try {
    const transport = { ...fixture(dir), bindAddress: "192.168.2.40" };
    s = await startDashboard(
      {
        secret,
        telemetry: new Telemetry(join(dir, "events.json")),
        config: null,
        mcpUp: false,
        transport,
      },
      3218,
    );
    assert.equal(s.url, "https://192.168.2.40:3218");
    const call = (host: string, origin?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port: actualPort,
            servername: "localhost",
            ca: readFileSync(transport.certFile),
            path: "/login",
            method: "POST",
            headers: {
              Host: host,
              ...(origin === undefined ? {} : { Origin: origin }),
              "Content-Type": "application/json",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify({ token: secret }));
      });
    assert.equal(await call("192.168.2.40:3218", s.url), 204);
    for (const host of [
      "localhost:3218",
      "127.0.0.1:3218",
      "192.168.2.40",
      "192.168.2.40:3217",
      "evil.invalid",
    ])
      assert.equal(await call(host, s.url), 403);
    for (const origin of [
      undefined,
      "http://192.168.2.40:3218",
      "https://192.168.2.40",
      "https://192.168.2.40:3217",
      "https://localhost:3218",
      "null",
    ])
      assert.equal(await call("192.168.2.40:3218", origin), 403);
  } finally {
    Server.prototype.listen = original;
    await s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
