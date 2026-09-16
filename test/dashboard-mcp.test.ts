import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/server.js";
import { Telemetry } from "../src/telemetry.js";
import { Graph } from "../src/graph.js";
import { fixture, config, range, event } from "./fixtures.js";
test("real MCP tools emit sanitized outcomes including SDK rejects and incomplete Graph", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-integration-"));
  const t = new Telemetry(join(dir, "events.json"));
  let bad = false;
  const recordedInputs: any[] = [];
  const record = t.record.bind(t);
  t.record = (e) => {
    recordedInputs.push(e);
    record(e);
  };
  const f = await fixture((_q: any, r: any) =>
    r.end(
      JSON.stringify(
        bad ? { value: [], "@odata.nextLink": null } : { value: [event] },
      ),
    ),
  );
  const s = await startServer(
    config,
    new Graph({ token: async () => "TEST-ONLY", testOnly: true, base: f.url }),
    0,
    t,
  );
  const c = new Client({ name: "TEST-FIXTURE", version: "1" });
  try {
    await c.connect(
      new StreamableHTTPClientTransport(new URL(s.url), {
        requestInit: {
          headers: { Authorization: "Bearer " + config.clients[0].secret },
        },
      }),
    );
    await c.callTool({
      name: "list_events",
      arguments: { calendarKey: "work", ...range },
    });
    await c.callTool({
      name: "list_events",
      arguments: { calendarKey: "other", ...range },
    });
    await c.callTool({
      name: "list_events",
      arguments: { calendarKey: "work", secret: "NEVER LOG RAW ARGS" },
    });
    bad = true;
    await c.callTool({
      name: "list_events",
      arguments: { calendarKey: "work", ...range },
    });
    await fetch(s.url, { method: "POST" });
    const m = t.snapshot("today");
    assert.ok(
      recordedInputs.find((e) => e.operation === "authentication").durationMs >
        0,
      "authentication latency must be measured, not a synthetic zero",
    );
    assert.equal(m.calls, 5);
    assert.equal(m.successes, 1);
    assert.equal(m.denied, 2);
    assert.equal(m.errors, 2);
    assert.ok(m.lastGraphSuccess);
    assert.ok(m.logs.every((e) => e.durationMs >= 0));
    assert.ok(
      !/TEST-ONLY|NEVER|planning|example.invalid|subject/.test(
        JSON.stringify(m),
      ),
    );
  } finally {
    await c.close();
    await s.close();
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
