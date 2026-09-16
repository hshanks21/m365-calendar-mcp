import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApplication } from "../src/runtime.js";
const policy = {
  calendars: { family: { calendarId: "fake-family@example.invalid" } },
  clients: [
    {
      id: "family",
      secret: "TEST-" + "g".repeat(40),
      calendarKeys: ["family"],
      writeCalendarKeys: [],
    },
  ],
};
const env = {
  CALENDAR_GOOGLE_CLIENT_ID: "fake.apps.googleusercontent.com",
  CALENDAR_GOOGLE_CLIENT_SECRET: "TEST-secret",
  CALENDAR_GOOGLE_REFRESH_TOKEN: "TEST-refresh",
  CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify(policy),
  CALENDAR_DASHBOARD_SECRET: "TEST-" + "v".repeat(40),
};
test("Google-only runtime opens MCP without M365 and dashboard reports Google unverified not Graph", async () => {
  const dir = mkdtempSync(join(tmpdir(), "google-runtime-"));
  let s: any;
  try {
    s = await startApplication(
      { ...env, CALENDAR_TELEMETRY_FILE: join(dir, "telemetry.json") },
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
    assert.equal(d.health.graph, "not_configured");
    assert.equal(d.health.google, "unverified");
    assert.equal(d.access.calendarCount, 1);
    assert.equal(d.metrics.calls, 0);
  } finally {
    await s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Google partial/invalid runtime refuses before listening, never downgrades or shares viewer credentials", async () => {
  for (const change of [
    { CALENDAR_GOOGLE_REFRESH_TOKEN: "" },
    { CALENDAR_GOOGLE_POLICY_JSON: "" },
    { CALENDAR_DASHBOARD_SECRET: env.CALENDAR_GOOGLE_REFRESH_TOKEN },
    { CALENDAR_GOOGLE_CREATE_ENABLED: "true" },
  ])
    await assert.rejects(async () => {
      const s = await startApplication(
        { ...env, ...change },
        { dashboard: 0, mcp: 0 },
      );
      await s.close();
    });
});
