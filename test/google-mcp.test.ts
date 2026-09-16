import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GoogleCalendar } from "../src/google.js";
import { loadGoogleConfig } from "../src/google-config.js";
import { combinePolicies, routeProviders } from "../src/providers.js";
import { startServer } from "../src/server.js";
import { Telemetry } from "../src/telemetry.js";
import { fixture, range, config, event } from "./fixtures.js";
import { Graph } from "../src/graph.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("Google MCP scope and provider telemetry stay separate from M365; no creation or discovery MCP authority", async () => {
  const dir = mkdtempSync(join(tmpdir(), "google-mcp-"));
  const telemetry = new Telemetry(join(dir, "events.json"));
  let googleCalls = 0,
    graphCalls = 0;
  const f = await fixture((req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/token")
      return res.end(
        JSON.stringify({
          access_token: "TEST",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
    googleCalls++;
    res.end(
      JSON.stringify({
        items: [
          {
            id: "fake",
            summary: "Synthetic family",
            status: "confirmed",
            start: { dateTime: range.start },
            end: { dateTime: range.end },
          },
        ],
      }),
    );
  });
  const mf = await fixture((_req: any, res: any) => {
    graphCalls++;
    res.end(JSON.stringify({ value: [event] }));
  });
  const gc = loadGoogleConfig({
    CALENDAR_GOOGLE_CLIENT_ID: "fake.apps.googleusercontent.com",
    CALENDAR_GOOGLE_CLIENT_SECRET: "TEST",
    CALENDAR_GOOGLE_REFRESH_TOKEN: "TEST",
    CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify({
      calendars: { family: { calendarId: "fake-family" } },
      clients: [
        {
          id: "google",
          secret: "TEST-" + "g".repeat(40),
          calendarKeys: ["family"],
          writeCalendarKeys: ["family"],
        },
      ],
    }),
  });
  const combined = combinePolicies(config, gc)!;
  const client = new Client({ name: "synthetic-google-client", version: "1" });
  let s: any;
  try {
    s = await startServer(
      combined,
      routeProviders(
        new Graph({ token: async () => "TEST", base: mf.url, testOnly: true }),
        new GoogleCalendar(gc, {
          base: f.url,
          tokenUrl: f.url + "/token",
          testOnly: true,
        }),
      ),
      0,
      telemetry,
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(s.url), {
        requestInit: {
          headers: { Authorization: "Bearer " + gc.clients[0].secret },
        },
      }),
    );
    const invoke = (name: string, args: any = {}) =>
      client.callTool({ name, arguments: args });
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.equal(tools.length, 5);
    for (const name of [
      "create_event",
      "update_event",
      "delete_event",
      "discover_calendars",
      "set_acl",
    ])
      assert.equal((await invoke(name, { confirmed: true })).isError, true);
    assert.equal(
      (await invoke("list_events", { calendarKey: "work", ...range })).isError,
      true,
    );
    assert.equal(graphCalls, 0);
    assert.equal(googleCalls, 0);
    const r = await invoke("list_events", { calendarKey: "family", ...range });
    assert.equal(JSON.parse((r.content as any)[0].text).complete, true);
    assert.equal(googleCalls, 1);
    assert.equal(graphCalls, 0);
    const metrics = telemetry.snapshot("today");
    assert.equal(metrics.lastGraphSuccess, null);
    assert.ok((metrics as any).lastGoogleSuccess);
    assert.throws(() =>
      combinePolicies(config, {
        ...gc,
        clients: [{ ...gc.clients[0], secret: config.clients[0].secret }],
      }),
    );
  } finally {
    await client.close();
    await s?.close();
    await f.close();
    await mf.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
