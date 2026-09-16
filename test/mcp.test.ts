import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Graph } from "../src/graph.js";
import { fixture, event, range } from "./fixtures.js";
import { config } from "./fixtures.js";
test("real authenticated MCP handshake enforces per-client scope and no browser origin access", async () => {
  const m = await import("../src/server.js").catch(() => ({
    startServer: undefined,
  }));
  assert.equal(typeof m.startServer, "function");
  const f = await fixture((_req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ value: [event] }));
  });
  let service: any;
  const clients: Client[] = [];
  try {
    service = await m.startServer!(
      config,
      new Graph({
        token: async () => "TEST-ONLY",
        base: f.url,
        testOnly: true,
      }),
      0,
    );
    const url = new URL(service.url);
    const unauthenticated = new Client({
      name: "test-unauthenticated",
      version: "1",
    });
    clients.push(unauthenticated);
    await assert.rejects(
      unauthenticated.connect(new StreamableHTTPClientTransport(url)),
      (error: any) => error.code === 401,
    );
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + config.clients[0].secret,
            Origin: "https://evil.invalid",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
      401,
    );
    for (const [i, c] of config.clients.entries()) {
      const client = new Client({
        name: "explicit-test-fixture-client",
        version: "1.0",
      });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit: { headers: { Authorization: "Bearer " + c.secret } },
        }),
      );
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(names, [
        "connection_status",
        "get_work_availability",
        "list_calendars",
        "list_events",
        "search_events",
      ]);
      const invoke = async (name: string, args: any = {}) => {
        const r = await client.callTool({ name, arguments: args });
        return {
          raw: r,
          data: r.isError ? null : JSON.parse((r.content as any)[0].text),
        };
      };
      assert.deepEqual((await invoke("list_calendars")).data, {
        calendars: [{ calendarKey: i ? "other" : "work" }],
      });
      assert.equal(
        (
          await invoke("list_events", {
            calendarKey: i ? "work" : "other",
            ...range,
          })
        ).raw.isError,
        true,
      );
      const status = await invoke("connection_status");
      assert.equal(status.data.liveVerified, false);
      assert.ok(!JSON.stringify(status).includes("TEST-ONLY"));
      if (!i) {
        const events = await invoke("list_events", {
          calendarKey: "work",
          ...range,
        });
        assert.equal(events.data.events[0].subject, event.subject);
        assert.equal(events.data.complete, true);
        assert.equal(
          (
            await invoke("list_events", {
              calendarKey: "work",
              start: "2026-09-14T09:00:00",
              end: range.end,
            })
          ).raw.isError,
          true,
        );
        assert.equal(
          (
            await invoke("list_events", {
              calendarKey: "work",
              start: range.start,
              end: "2027-01-01T00:00:00Z",
            })
          ).raw.isError,
          true,
        );
        assert.equal(
          (
            await invoke("list_events", {
              calendarKey: "work",
              ...range,
              url: "https://evil.invalid",
            })
          ).raw.isError,
          true,
        );
        assert.equal(
          (await invoke("delete_event", { calendarKey: "work" })).raw.isError,
          true,
        );
      }
    }
    console.log(
      "TEST FIXTURE ONLY: real loopback HTTP + official MCP client handshake and tool calls verified",
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    if (service) await service.close();
    await f.close();
  }
});
