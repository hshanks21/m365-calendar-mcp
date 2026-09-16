import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, event, range } from "./fixtures.js";
test("calendarView traverses a real test HTTP fixture with narrow private-safe projection", async () => {
  const m = await import("../src/graph.js").catch(() => ({ Graph: undefined }));
  assert.equal(typeof m.Graph, "function");
  let calls = 0;
  const f = await fixture((req: any, res: any) => {
    calls++;
    const u = new URL(req.url, "http://fixture");
    assert.match(
      u.pathname,
      /\/users\/fake%40example.invalid\/calendars\/fake-id\/calendarView$/,
    );
    assert.equal(req.headers.authorization, "Bearer TEST-ONLY");
    assert.equal(req.headers.prefer, 'outlook.timezone="UTC"');
    assert.ok(!u.searchParams.get("$select")?.includes("body"));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        value: [
          event,
          {
            ...event,
            id: "private",
            subject: "HIDDEN",
            sensitivity: "private",
          },
        ],
      }),
    );
  });
  try {
    const g = new m.Graph!({
      token: async () => "TEST-ONLY",
      base: f.url,
      testOnly: true,
    });
    const r = await g.view(
      { mailbox: "fake@example.invalid", calendarId: "fake-id" },
      range,
    );
    assert.equal(r.complete, true);
    assert.equal(r.events.length, 2);
    assert.equal(r.events[1].subject, "Private event");
    assert.ok(!JSON.stringify(r).includes("HIDDEN"));
    assert.ok(!JSON.stringify(r).includes("SECRET"));
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
