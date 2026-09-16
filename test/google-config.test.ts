import { test } from "node:test";
import assert from "node:assert/strict";
export const googleEnv = {
  CALENDAR_GOOGLE_CLIENT_ID: "fake.apps.googleusercontent.com",
  CALENDAR_GOOGLE_CLIENT_SECRET: "TEST-secret",
  CALENDAR_GOOGLE_REFRESH_TOKEN: "TEST-refresh",
  CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify({
    calendars: { family: { calendarId: "fake/family@example.invalid" } },
    clients: [
      {
        id: "family-agent",
        secret: "TEST-" + "g".repeat(40),
        calendarKeys: ["family"],
        writeCalendarKeys: [],
      },
    ],
  }),
};
test("Google policy requires explicit scoped IDs and rejects implicit aliases, writes and partial credentials", async () => {
  const m = await import("../src/google-config.js").catch(() => ({
    loadGoogleConfig: undefined,
  }));
  assert.equal(typeof m.loadGoogleConfig, "function");
  const load = m.loadGoogleConfig!;
  const c = load(googleEnv);
  assert.equal(c.calendars.family.provider, "google");
  for (const calendarId of ["primary", "*", ".", "..", ""])
    assert.throws(() =>
      load({
        ...googleEnv,
        CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify({
          calendars: { family: { calendarId } },
          clients: c.clients,
        }),
      }),
    );
  assert.throws(() =>
    load({ ...googleEnv, CALENDAR_GOOGLE_REFRESH_TOKEN: "" }),
  );
  assert.throws(() =>
    load({ ...googleEnv, CALENDAR_GOOGLE_CREATE_ENABLED: "true" }),
  );
  const p = JSON.parse(googleEnv.CALENDAR_GOOGLE_POLICY_JSON);
  p.clients[0].calendarKeys = ["unknown"];
  assert.throws(() =>
    load({ ...googleEnv, CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify(p) }),
  );
  p.clients[0].calendarKeys = ["family"];
  p.clients[0].writeCalendarKeys = ["unknown"];
  assert.throws(() =>
    load({ ...googleEnv, CALENDAR_GOOGLE_POLICY_JSON: JSON.stringify(p) }),
  );
});
