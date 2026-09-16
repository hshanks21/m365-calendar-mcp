// Additional regression matrix for boundaries implemented in earlier RED/GREEN slices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { Graph } from "../src/graph.js";
import { loadConfig } from "../src/config.js";
import { fixture, event, range, config } from "./fixtures.js";
test("regression: file policy permissions, duplicate bearers, unknown keys and unrelated mail env are rejected", () => {
  const dir = "test/.temporary-policy";
  mkdirSync(dir, { recursive: true });
  const file = dir + "/policy.json";
  const env = {
    CALENDAR_M365_TENANT_ID: config.tenantId,
    CALENDAR_M365_CLIENT_ID: config.clientId,
    CALENDAR_M365_CLIENT_SECRET: config.clientSecret,
  };
  const policy = { calendars: config.calendars, clients: config.clients };
  try {
    writeFileSync(file, JSON.stringify(policy), { mode: 0o600 });
    assert.equal(
      loadConfig({ ...env, CALENDAR_M365_POLICY_FILE: file }).clients.length,
      2,
    );
    chmodSync(file, 0o644);
    assert.throws(() =>
      loadConfig({ ...env, CALENDAR_M365_POLICY_FILE: file }),
    );
    assert.throws(() =>
      loadConfig({
        AZURE_TENANT_ID: config.tenantId,
        AZURE_CLIENT_ID: config.clientId,
        AZURE_CLIENT_SECRET: config.clientSecret,
      }),
    );
    for (const clients of [
      [
        config.clients[0],
        { ...config.clients[1], secret: config.clients[0].secret },
      ],
      [{ ...config.clients[0], calendarKeys: ["missing"] }],
    ])
      assert.throws(() =>
        loadConfig({
          ...env,
          CALENDAR_M365_POLICY_JSON: JSON.stringify({ ...policy, clients }),
        }),
      );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("regression: HTTP errors, event caps, malformed events and oversized responses cannot be complete", async () => {
  let mode = "unauthorized";
  const f = await fixture((_req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    if (mode === "unauthorized") {
      res.writeHead(401);
      res.end('{"secret":"NEVER EXPOSE"}');
      return;
    }
    res.end(
      JSON.stringify({
        value:
          mode === "oversized"
            ? [{ ...event, subject: "x".repeat(2000001) }]
            : mode === "malformed"
              ? [{ ...event, start: { dateTime: "bad", timeZone: "UTC" } }]
              : [event, event, event],
      }),
    );
  });
  try {
    const g = new Graph({
      token: async () => "TEST-ONLY",
      base: f.url,
      testOnly: true,
      maxEvents: 2,
    });
    for (const v of ["unauthorized", "eventcap", "malformed", "oversized"]) {
      mode = v;
      const r = await g.view(config.calendars.work, range);
      assert.equal(r.complete, false, v);
      assert.ok(r.error);
      assert.ok(!JSON.stringify(r).includes("NEVER EXPOSE"));
    }
  } finally {
    await f.close();
  }
});
