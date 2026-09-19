import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, range } from "./fixtures.js";
export const ge = {
  id: "test-instance",
  summary: "Synthetic planning",
  status: "confirmed",
  visibility: "default",
  start: { dateTime: "2026-09-14T10:00:00-04:00" },
  end: { dateTime: "2026-09-14T11:00:00-04:00" },
  description: "NEVER RETURN",
  attendees: [{ email: "NEVER RETURN" }],
};
test("Google refresh and bounded recurring read use fixed paths and narrow private projection", async () => {
  const m = await import("../src/google.js").catch(() => ({
    GoogleCalendar: undefined,
  }));
  assert.equal(typeof m.GoogleCalendar, "function");
  let tokens = 0,
    reads = 0;
  const f = await fixture(async (req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    const u = new URL(req.url, "http://fixture");
    if (u.pathname === "/token") {
      tokens++;
      let body = "";
      for await (const c of req) body += c;
      assert.equal(
        new URLSearchParams(body).get("grant_type"),
        "refresh_token",
      );
      res.end(
        JSON.stringify({
          access_token: "TEST-access",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
      return;
    }
    reads++;
    assert.equal(
      u.pathname,
      "/calendar/v3/calendars/fake%2Ffamily%40example.invalid/events",
    );
    assert.equal(req.headers.authorization, "Bearer TEST-access");
    assert.equal(u.searchParams.get("singleEvents"), "true");
    assert.equal(u.searchParams.get("showDeleted"), "false");
    assert.equal(u.searchParams.get("timeMin"), range.start);
    assert.ok(!u.searchParams.get("fields")!.includes("description"));
    res.end(
      JSON.stringify(
        u.searchParams.has("pageToken")
          ? {
              items: [
                {
                  ...ge,
                  id: "private",
                  visibility: "private",
                  summary: "SECRET",
                },
              ],
            }
          : {
              items: [ge, { id: "cancelled", status: "cancelled" }],
              nextPageToken: "opaque/+?",
            },
      ),
    );
  });
  try {
    const g = new m.GoogleCalendar!(
      {
        clientId: "fake.apps.googleusercontent.com",
        clientSecret: "TEST-secret",
        refreshToken: "TEST-refresh",
      },
      { base: f.url, tokenUrl: f.url + "/token", testOnly: true },
    );
    const v = await g.view(
      { calendarId: "fake/family@example.invalid" },
      range,
    );
    assert.equal(v.complete, true);
    assert.equal(v.events.length, 2);
    assert.equal(v.events[1].id, "redacted");
    assert.equal(v.events[1].subject, "Private event");
    assert.ok(!JSON.stringify(v).includes("SECRET"));
    assert.ok(!JSON.stringify(v).includes("NEVER RETURN"));
    await g.view({ calendarId: "fake/family@example.invalid" }, range);
    assert.equal(tokens, 1);
    assert.equal(reads, 4);
    assert.equal(
      (await g.view({ calendarId: "primary" }, range)).complete,
      false,
    );
    assert.equal(
      (
        await g.view(
          { calendarId: "fake" },
          { ...range, start: "2026-09-14T09:00:00" },
        )
      ).complete,
      false,
    );
  } finally {
    await f.close();
  }
});
test("Google date-only events respect calendar timezone and DST; incomplete pages discard results", async () => {
  const { GoogleCalendar } = await import("../src/google.js");
  let mode = "allDay";
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
    const items = [
      { ...ge, start: { date: "2026-03-08" }, end: { date: "2026-03-09" } },
    ];
    if (mode === "error") {
      res.statusCode = 403;
      return res.end("SECRET");
    }
    if (mode === "redirect") {
      res.statusCode = 302;
      res.setHeader("Location", "https://example.invalid");
      return res.end();
    }
    res.end(
      JSON.stringify({
        timeZone: "America/New_York",
        items: mode === "allDay" ? items : [ge],
        ...(mode === "loop"
          ? { nextPageToken: "same" }
          : mode === "bad"
            ? { nextPageToken: { url: "https://evil.invalid" } }
            : {}),
      }),
    );
  });
  try {
    const g = new GoogleCalendar(
      {
        clientId: "fake.apps.googleusercontent.com",
        clientSecret: "TEST",
        refreshToken: "TEST",
      },
      { base: f.url, tokenUrl: f.url + "/token", testOnly: true },
    );
    const v = await g.view(
      { calendarId: "fake" },
      { start: "2026-03-08T00:00:00-05:00", end: "2026-03-10T00:00:00-04:00" },
    );
    assert.equal(v.complete, true);
    assert.equal(v.events[0].start, "2026-03-08T05:00:00.000Z");
    assert.equal(v.events[0].end, "2026-03-09T04:00:00.000Z");
    assert.equal(v.events[0].isAllDay, true);
    assert.equal((v.events[0] as any).startDate, "2026-03-08");
    assert.equal((v.events[0] as any).endDate, "2026-03-09");
    for (mode of ["loop", "bad", "error", "redirect"]) {
      const v = await g.view({ calendarId: "fake" }, range);
      assert.equal(v.complete, false);
      assert.deepEqual(v.events, []);
      assert.ok(!JSON.stringify(v).includes("SECRET"));
    }
  } finally {
    await f.close();
  }
});
