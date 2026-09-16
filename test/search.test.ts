import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/server.js";
import { Graph } from "../src/graph.js";
import { fixture, event, range } from "./fixtures.js";
import { config } from "./fixtures.js";
test("subject search uses only complete views and never private subjects or body", async () => {
  let partial = false;
  const f = await fixture((_req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        value: [
          event,
          {
            ...event,
            id: "private",
            subject: "PRIVATE NEEDLE",
            sensitivity: "private",
          },
          {
            ...event,
            id: "body",
            subject: "unrelated",
            body: { content: "NEEDLE" },
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
    const call = async (query: string) => {
      const r = await c.callTool({
        name: "search_events",
        arguments: { calendarKey: "work", ...range, query },
      });
      return {
        r,
        data: r.isError ? null : JSON.parse((r.content as any)[0].text),
      };
    };
    let r = await call("planning");
    assert.equal(r.r.isError, undefined);
    assert.equal(r.data.events.length, 1);
    assert.equal((await call("NEEDLE")).data.events.length, 0);
    partial = true;
    r = await call("planning");
    assert.equal(r.data.complete, false);
    assert.deepEqual(r.data.events, []);
    assert.ok(r.data.error);
  } finally {
    await c.close();
    await s.close();
    await f.close();
  }
});
