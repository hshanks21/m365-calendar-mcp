import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
test("operator discovery requires explicit command and projects calendar list only, no events or tokens", async () => {
  const m = await import("../src/google-discovery.js").catch(() => ({
    runDiscovery: undefined,
  }));
  assert.equal(typeof m.runDiscovery, "function");
  let calls = 0;
  const f = await fixture((req: any, res: any) => {
    calls++;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/token")
      return res.end(
        JSON.stringify({
          access_token: "TEST-access",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
    const u = new URL(req.url, "http://fixture");
    assert.equal(u.pathname, "/calendar/v3/users/me/calendarList");
    assert.equal(
      u.searchParams.get("fields"),
      "nextPageToken,items(id,summary,accessRole)",
    );
    res.end(
      JSON.stringify({
        items: [
          {
            id: "fake-calendar",
            summary: "Synthetic family",
            accessRole: "writer",
            description: "SECRET",
          },
        ],
      }),
    );
  });
  const env = {
    CALENDAR_GOOGLE_CLIENT_ID: "fake.apps.googleusercontent.com",
    CALENDAR_GOOGLE_CLIENT_SECRET: "TEST-secret",
    CALENDAR_GOOGLE_REFRESH_TOKEN: "TEST-refresh",
  };
  try {
    for (const args of [[], ["--help"], ["--discover", "--events"]]) {
      await m.runDiscovery!(args, env, {
        base: f.url,
        tokenUrl: f.url + "/token",
        testOnly: true,
      });
      assert.equal(calls, 0);
    }
    const r = await m.runDiscovery!(["--discover"], env, {
      base: f.url,
      tokenUrl: f.url + "/token",
      testOnly: true,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(r.message), {
      complete: true,
      calendars: [
        {
          id: "fake-calendar",
          summary: "Synthetic family",
          accessRole: "writer",
        },
      ],
    });
    assert.equal(calls, 2);
    assert.ok(!r.message.includes("TEST-access"));
    assert.ok(!r.message.includes("SECRET"));
  } finally {
    await f.close();
  }
});
