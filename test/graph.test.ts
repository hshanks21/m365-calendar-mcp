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
    assert.ok(u.searchParams.get("$select")?.includes("originalStartTimeZone"));
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

test("Graph all-day dates recover only from supported original zones and midnight boundaries", async () => {
  const { Graph } = await import("../src/graph.js");
  let zone = "Eastern Standard Time";
  let startFraction = "",
    endFraction = "";
  const f = await fixture((_req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        value: [
          {
            ...event,
            isAllDay: true,
            originalStartTimeZone: zone,
            originalEndTimeZone: zone,
            start: {
              dateTime: "2026-03-08T05:00:00" + startFraction,
              timeZone: "UTC",
            },
            end: {
              dateTime: "2026-03-09T04:00:00" + endFraction,
              timeZone: "UTC",
            },
          },
        ],
      }),
    );
  });
  try {
    const g = new Graph({
      token: async () => "TEST-ONLY",
      base: f.url,
      testOnly: true,
    });
    const mapping = { mailbox: "fake@example.invalid", calendarId: "fake-id" };
    let view = await g.view(mapping, range);
    assert.equal(view.events[0].startDate, "2026-03-08");
    assert.equal(view.events[0].endDate, "2026-03-09");
    for (const fraction of [".001", ".0000001", ".000", ".0000000"]) {
      for (const boundary of ["start", "end"]) {
        startFraction = boundary === "start" ? fraction : "";
        endFraction = boundary === "end" ? fraction : "";
        view = await g.view(mapping, range);
        assert.equal(view.complete, true);
        assert.equal(
          view.events[0].startDate,
          /[1-9]/.test(fraction) ? undefined : "2026-03-08",
          `${boundary} ${fraction}`,
        );
      }
    }
    startFraction = endFraction = "";
    zone = "tzone://Microsoft/Custom";
    view = await g.view(mapping, range);
    assert.equal(view.events[0].startDate, undefined);
    zone = "UTC"; // UTC instants are not midnight; guessing their dates is unsafe.
    view = await g.view(mapping, range);
    assert.equal(view.events[0].startDate, undefined);
  } finally {
    await f.close();
  }
});
