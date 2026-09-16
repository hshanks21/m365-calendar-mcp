import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleCalendar } from "../src/google.js";
import { fixture, range } from "./fixtures.js";
const credentials = {
  clientId: "fake.apps.googleusercontent.com",
  clientSecret: "TEST-secret",
  refreshToken: "TEST-refresh",
};
test("Google bounded reads cancel bodies and never complete on limits, token errors, malformed dates or redirects", async () => {
  let mode = "eventLimit",
    reads = 0;
  const e = {
    id: "test",
    status: "confirmed",
    start: { dateTime: range.start },
    end: { dateTime: range.end },
  };
  const f = await fixture((req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/token") {
      if (mode === "tokenHang") {
        res.write("{");
        return;
      }
      if (mode === "tokenBad") {
        res.statusCode = 400;
        return res.end("TEST-secret");
      }
      return res.end(
        JSON.stringify({
          access_token: "TEST-access",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
    }
    reads++;
    if (mode === "hang") {
      res.write("{");
      return;
    }
    if (mode === "oversize") {
      res.end(" ".repeat(2000001));
      return;
    }
    if (mode === "badDate")
      return res.end(
        JSON.stringify({
          items: [{ ...e, start: { dateTime: "2026-09-14T09:00:00" } }],
        }),
      );
    if (mode === "badDay")
      return res.end(
        JSON.stringify({
          timeZone: "America/New_York",
          items: [
            {
              ...e,
              start: { date: "2026-02-30" },
              end: { date: "2026-03-01" },
            },
          ],
        }),
      );
    if (mode === "429") {
      res.statusCode = 429;
      return res.end("secret body");
    }
    res.end(
      JSON.stringify({
        items: [e, e],
        ...(mode === "pageLimit" ? { nextPageToken: "next" } : {}),
      }),
    );
  });
  try {
    for (mode of [
      "eventLimit",
      "pageLimit",
      "badDate",
      "badDay",
      "429",
      "oversize",
      "hang",
      "tokenHang",
      "tokenBad",
    ]) {
      let settled = 0;
      const g = new GoogleCalendar(credentials, {
        base: f.url,
        tokenUrl: f.url + "/token",
        testOnly: true,
        maxEvents: mode === "eventLimit" ? 1 : 1000,
        maxPages: 1,
        timeoutMs: 100,
      });
      const v = await g.view({ calendarId: "fake" }, range, {
        onSettled: () => settled++,
      });
      assert.equal(v.complete, false, mode);
      assert.deepEqual(v.events, [], mode);
      assert.equal(settled, 1);
      assert.ok(!JSON.stringify(v).includes("secret"));
    }
    const before = reads;
    const abort = new AbortController();
    abort.abort();
    const g = new GoogleCalendar(credentials, {
      base: f.url,
      tokenUrl: f.url + "/token",
      testOnly: true,
    });
    assert.equal(
      (await g.view({ calendarId: "fake" }, range, { signal: abort.signal }))
        .complete,
      false,
    );
    assert.equal(reads, before);
    assert.throws(
      () => new GoogleCalendar(credentials, { base: "https://evil.invalid" }),
    );
  } finally {
    await f.close();
  }
});
test("Google discovery preserves current provider access roles and rejects incomplete calendar lists", async () => {
  let mode = "role";
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
    res.end(
      JSON.stringify({
        items: [
          {
            id: "fake",
            summary: "Synthetic calendar",
            accessRole: "writerWithoutPrivateAccess",
          },
        ],
        ...(mode === "loop" ? { nextPageToken: "same" } : {}),
      }),
    );
  });
  try {
    const g = new GoogleCalendar(credentials, {
      base: f.url,
      tokenUrl: f.url + "/token",
      testOnly: true,
    });
    assert.equal(
      (await g.discover()).calendars[0].accessRole,
      "writerWithoutPrivateAccess",
    );
    mode = "loop";
    await assert.rejects(g.discover());
  } finally {
    await f.close();
  }
});
test("Google rejects refreshed token scopes that differ from the approved OAuth grant", async () => {
  const f = await fixture((_req: any, res: any) => {
    res.end(
      JSON.stringify({
        access_token: "TEST",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
      }),
    );
  });
  try {
    const g = new GoogleCalendar(credentials, {
      base: f.url,
      tokenUrl: f.url + "/token",
      testOnly: true,
    });
    await assert.rejects(g.discover(), /invalid_response/);
  } finally {
    await f.close();
  }
});
