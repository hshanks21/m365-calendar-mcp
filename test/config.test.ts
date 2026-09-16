import { test } from "node:test";
import assert from "node:assert/strict";
const load = async () =>
  import("../src/config.js").catch(() => ({ loadConfig: undefined }));
test("configuration fails closed without dedicated credentials and client policy", async () => {
  const m = await load();
  assert.equal(typeof m.loadConfig, "function");
  assert.throws(() => m.loadConfig!({}), /configuration/);
  const e = {
    CALENDAR_M365_TENANT_ID: "11111111-1111-4111-8111-111111111111",
    CALENDAR_M365_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
    CALENDAR_M365_CLIENT_SECRET: "TEST-ONLY-NOT-A-REAL-SECRET",
    CALENDAR_M365_POLICY_JSON: JSON.stringify({
      calendars: {
        work: { mailbox: "fake@example.invalid", calendarId: "fake-id" },
      },
      clients: [
        {
          id: "agent",
          secret: "test-only-" + "a".repeat(40),
          calendarKeys: ["work"],
        },
      ],
    }),
  };
  const c = m.loadConfig!(e);
  assert.equal(c.clients[0].calendarKeys[0], "work");
  assert.throws(
    () => m.loadConfig!({ ...e, CALENDAR_M365_POLICY_JSON: "{}" }),
    /configuration/,
  );
  assert.throws(
    () => m.loadConfig!({ ...e, CALENDAR_M365_CLIENT_SECRET: "" }),
    /configuration/,
  );
});
