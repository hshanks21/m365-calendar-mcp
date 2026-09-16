import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/server.js";
import { Graph } from "../src/graph.js";
import { fixture, event, range, config } from "./fixtures.js";
test("availability merges busy intervals from complete allowed calendarView and refuses partial free claims", async () => {
  let partial = false;
  const f = await fixture((req: any, res: any) => {
    assert.ok(!req.url.includes("getSchedule"));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        value: [
          event,
          {
            ...event,
            id: "private",
            sensitivity: "private",
            start: { dateTime: "2026-09-14T14:30:00", timeZone: "UTC" },
            end: { dateTime: "2026-09-14T16:00:00", timeZone: "UTC" },
          },
          {
            ...event,
            id: "cancel",
            isCancelled: true,
            start: { dateTime: "2026-09-14T17:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-09-14T18:00:00", timeZone: "UTC" },
          },
        ],
        ...(partial ? { "@odata.nextLink": "https://evil.invalid/" } : {}),
      }),
    );
  });
  const s = await startServer(
    config,
    new Graph({ token: async () => "TEST-ONLY", base: f.url, testOnly: true }),
    0,
  );
  const c = new Client({ name: "test", version: "1" });
  try {
    await c.connect(
      new StreamableHTTPClientTransport(new URL(s.url), {
        requestInit: {
          headers: { Authorization: "Bearer " + config.clients[0].secret },
        },
      }),
    );
    const call = async () => {
      const r = await c.callTool({
        name: "get_work_availability",
        arguments: { calendarKey: "work", ...range },
      });
      assert.ok(!r.isError);
      return JSON.parse((r.content as any)[0].text);
    };
    let r = await call();
    assert.deepEqual(r.free, [
      { start: "2026-09-14T13:00:00.000Z", end: "2026-09-14T14:00:00.000Z" },
      { start: "2026-09-14T16:00:00.000Z", end: "2026-09-14T21:00:00.000Z" },
    ]);
    assert.equal(r.complete, true);
    assert.ok(!JSON.stringify(r).includes("subject"));
    partial = true;
    r = await call();
    assert.deepEqual(r.free, []);
    assert.equal(r.complete, false);
    assert.ok(r.error);
  } finally {
    await c.close();
    await s.close();
    await f.close();
  }
});
