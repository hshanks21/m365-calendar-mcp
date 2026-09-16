import { request } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Telemetry } from "../src/telemetry.js";
import { config } from "./fixtures.js";
const secret = "TEST-FIXTURE-VIEWER-" + "v".repeat(40);
test("dashboard authenticates separate viewers, protects origins and exposes no privileged data without M365", async () => {
  const m = await import("../src/dashboard.js").catch(() => ({
    startDashboard: undefined,
  }));
  assert.equal(typeof m.startDashboard, "function");
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-dashboard-"));
  let s: any;
  try {
    const telemetry = new Telemetry(join(dir, "events.json"));
    s = await m.startDashboard!(
      { secret, telemetry, config: null, mcpUp: false },
      0,
    );
    const root = s.url;
    const page = await fetch(root + "/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /A little calendar clarity\./);
    assert.match(html, /Who’s been asking/);
    assert.match(html, /The paper trail/);
    assert.equal((await fetch(root + "/app.css")).status, 200);
    const script = await (await fetch(root + "/app.js")).text();
    assert.match(script, /api\/diagnostics/);
    assert.ok(!script.includes("localStorage"));
    assert.equal((await fetch(root + "/api/diagnostics")).status, 401);
    assert.equal(
      (
        await fetch(root + "/api/diagnostics", {
          headers: { Authorization: "Bearer " + config.clients[0].secret },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(root + "/api/diagnostics", {
          headers: { Origin: "https://evil.invalid" },
        })
      ).status,
      403,
    );
    const login = (origin: string, token = secret) =>
      fetch(root + "/login", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    assert.equal((await login("https://evil.invalid")).status, 403);
    assert.equal((await login(root, config.clients[0].secret)).status, 401);
    const ok = await login(root);
    assert.equal(ok.status, 204);
    const cookie = ok.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const headers = { Cookie: cookie.split(";")[0] };
    const response = await fetch(root + "/api/diagnostics?period=week", {
      headers,
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy")!,
      /default-src 'self'/,
    );
    const data = await response.json();
    assert.equal(data.health.graph, "not_configured");
    assert.equal(data.health.service, "up");
    assert.equal(data.health.mcp, "not_configured");
    assert.equal(data.metrics.successRate, null);
    assert.ok(!JSON.stringify(data).includes("TEST-"));
    assert.equal(
      (await fetch(root + "/api/diagnostics?period=bad", { headers })).status,
      400,
    );
    assert.equal(
      (await fetch(root + "/api/diagnostics?offset=-1", { headers })).status,
      400,
    );
    assert.equal(
      (await fetch(root + "/api/diagnostics?limit=101", { headers })).status,
      400,
    );
    assert.equal(
      (
        await fetch(root + "/api/diagnostics", {
          headers: { ...headers, Origin: root },
          method: "POST",
        })
      ).status,
      405,
    );
    assert.equal(
      (await fetch(root + "/logout", { headers, method: "POST" })).status,
      403,
    );
    assert.equal(
      (
        await fetch(root + "/logout", {
          headers: { ...headers, Origin: root },
          method: "POST",
        })
      ).status,
      204,
    );
    assert.equal(
      (await fetch(root + "/api/diagnostics", { headers })).status,
      401,
    );
    // Same-site is not same-origin: another loopback port must not be trusted.
    assert.equal((await login("http://127.0.0.1:1")).status, 403);
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          root + "/api/diagnostics",
          { headers: { Host: "evil.invalid" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      }),
      403,
    );
    assert.equal(
      (
        await fetch(root + "/api/diagnostics", {
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(root + "/../src/config.ts")).status, 404);
    assert.equal(
      (await fetch(root + "/fonts/CormorantGaramond.ttf")).status,
      200,
    );
    assert.match(
      await (await fetch(root + "/fonts/OFL.txt")).text(),
      /SIL OPEN FONT LICENSE/,
    );
    for (let i = 0; i < 8; i++) await login(root, "wrong");
    assert.equal((await login(root)).status, 429);
    await assert.rejects(
      m.startDashboard!(
        { secret: config.clients[0].secret, telemetry, config, mcpUp: true },
        0,
      ),
    );
    await assert.rejects(
      m.startDashboard!(
        { secret: "", telemetry, config: null, mcpUp: false },
        0,
      ),
    );
    await s.close();
    s = await m.startDashboard!(
      {
        secret,
        telemetry,
        config: {
          ...config,
          clients: config.clients.map((c) => ({
            ...c,
            id: "PRIVATE CONFIG LABEL",
          })),
        },
        mcpUp: true,
      },
      0,
    );
    const configuredLogin = await fetch(s.url + "/login", {
      method: "POST",
      headers: { Origin: s.url, "Content-Type": "application/json" },
      body: JSON.stringify({ token: secret }),
    });
    const configuredHeaders = {
      Cookie: configuredLogin.headers.get("set-cookie")!.split(";")[0],
    };
    const configuredData = await (
      await fetch(s.url + "/api/diagnostics", { headers: configuredHeaders })
    ).json();
    assert.equal(configuredData.health.graph, "unverified");
    assert.equal(configuredData.health.mcp, "up");
    assert.equal(configuredData.access.callers.length, 2);
    assert.equal(configuredData.access.calendarCount, 2);
    const serialized = JSON.stringify(configuredData);
    for (const sensitive of [
      secret,
      config.clientSecret,
      config.clientId,
      config.tenantId,
      config.clients[0].secret,
      config.calendars.work.mailbox,
      config.calendars.work.calendarId,
      "PRIVATE CONFIG LABEL",
    ])
      assert.ok(!serialized.includes(sensitive));
  } finally {
    if (s) await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
