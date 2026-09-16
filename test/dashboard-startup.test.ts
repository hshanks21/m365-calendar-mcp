import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("runtime starts dashboard only without Graph and refuses partial credentials or missing viewer", async () => {
  const m = await import("../src/runtime.js").catch(() => ({
    startApplication: undefined,
  }));
  assert.equal(typeof m.startApplication, "function");
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-startup-"));
  const env = {
    CALENDAR_DASHBOARD_SECRET: "TEST-FIXTURE-" + "x".repeat(40),
    CALENDAR_TELEMETRY_FILE: join(dir, "events.json"),
  };
  let s: any;
  try {
    s = await m.startApplication!(env, { dashboard: 0, mcp: 0 });
    assert.equal(s.mcp, null);
    const login = await fetch(s.dashboard.url + "/login", {
      method: "POST",
      headers: { Origin: s.dashboard.url, "Content-Type": "application/json" },
      body: JSON.stringify({ token: env.CALENDAR_DASHBOARD_SECRET }),
    });
    assert.equal(login.status, 204);
    const d = await (
      await fetch(s.dashboard.url + "/api/diagnostics", {
        headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
      })
    ).json();
    assert.equal(d.health.graph, "not_configured");
    await assert.rejects(
      m.startApplication!(
        { ...env, CALENDAR_M365_TENANT_ID: "partial" },
        { dashboard: 0, mcp: 0 },
      ),
    );
    await assert.rejects(
      m.startApplication!(
        { CALENDAR_TELEMETRY_FILE: env.CALENDAR_TELEMETRY_FILE },
        { dashboard: 0, mcp: 0 },
      ),
    );
  } finally {
    if (s) await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
