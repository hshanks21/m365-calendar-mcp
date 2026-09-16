// Real synthetic loopback responses only; no live Graph requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/server.js";
import { Graph } from "../src/graph.js";
import { config, fixture, range } from "./fixtures.js";

test("present invalid nextLink never completes a view or reports free availability", async () => {
  let payload: object = { value: [] };
  const f = await fixture((_req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  });
  const g = new Graph({
    base: f.url,
    testOnly: true,
    token: async () => "TEST-ONLY",
  });
  const s = await startServer(config, g, 0);
  const c = new Client({ name: "synthetic-continuation-test", version: "1" });
  try {
    await c.connect(
      new StreamableHTTPClientTransport(new URL(s.url), {
        requestInit: {
          headers: { Authorization: "Bearer " + config.clients[0].secret },
        },
      }),
    );
    assert.equal(
      (await g.view(config.calendars.work, range)).complete,
      true,
      "absent continuation is complete",
    );
    for (const nextLink of [
      "",
      " ",
      "/relative",
      "not a URL",
      null,
      false,
      0,
      [],
      {},
    ]) {
      payload = { value: [], "@odata.nextLink": nextLink };
      const view = await g.view(config.calendars.work, range);
      const result = await c.callTool({
        name: "get_work_availability",
        arguments: { calendarKey: "work", ...range },
      });
      const data = JSON.parse((result.content as any)[0].text);
      assert.deepEqual(
        data.free,
        [],
        `invalid continuation ${JSON.stringify(nextLink)} must never mean all-free`,
      );
      assert.equal(data.complete, false);
      assert.ok(data.error);
      assert.equal(view.complete, false);
      assert.equal(view.error, "invalid_response");
    }
  } finally {
    await c.close();
    await s.close();
    await f.close();
  }
});
