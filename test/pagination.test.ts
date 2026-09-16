import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/graph.js";
import { fixture, event, range } from "./fixtures.js";
const mapping = { mailbox: "fake@example.invalid", calendarId: "fake-id" };
test("pagination stays on exact origin/path and reports bounded incomplete failures", async () => {
  let mode = "paginate",
    calls = 0;
  let origin = "";
  const f = await fixture((req: any, res: any) => {
    calls++;
    res.setHeader("Content-Type", "application/json");
    const next =
      origin +
      req.url +
      (req.url.includes("skiptoken") ? "x" : "&$skiptoken=2");
    if (mode === "throttle") {
      res.writeHead(429, { "Retry-After": "0" });
      res.end("{}");
      return;
    }
    if (mode === "timeout") return;
    if (mode === "redirect") {
      res.writeHead(302, { Location: "http://127.0.0.1:1/leak" });
      res.end();
      return;
    }
    res.end(
      JSON.stringify({
        value: [event],
        ...(mode === "paginate" && req.url.includes("skiptoken")
          ? {}
          : {
              "@odata.nextLink":
                mode === "evil"
                  ? "https://evil.invalid/leak"
                  : mode === "otherpath"
                    ? origin + "/v1.0/users/other/calendar/calendarView"
                    : next,
            }),
      }),
    );
  });
  origin = f.url;
  try {
    const g = new Graph({
      token: async () => "TEST-ONLY",
      base: f.url,
      testOnly: true,
      timeoutMs: 80,
      maxPages: 2,
      maxEvents: 3,
    });
    let r = await g.view(mapping, range);
    assert.equal(r.events.length, 2);
    assert.equal(r.complete, true);
    for (const v of [
      "evil",
      "otherpath",
      "limit",
      "throttle",
      "timeout",
      "redirect",
    ]) {
      mode = v;
      calls = 0;
      r = await g.view(mapping, range);
      assert.equal(r.complete, false, v);
      assert.ok(r.error, v);
      assert.ok(calls <= 3, v);
    }
  } finally {
    await f.close();
  }
});
