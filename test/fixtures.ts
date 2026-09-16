// Synthetic test data only. No live Graph credentials or calls.
import { createServer } from "node:http";
export async function fixture(
  handler: Parameters<typeof createServer>[0] extends never ? never : any,
) {
  const s = createServer(handler);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(s.address() as any).port}`,
    close: () =>
      new Promise<void>((r) => {
        s.closeAllConnections();
        s.close(() => r());
      }),
  };
}
export const range = {
  start: "2026-09-14T09:00:00-04:00",
  end: "2026-09-14T17:00:00-04:00",
};
export const event = {
  id: "fixture-event",
  subject: "TEST FIXTURE planning",
  sensitivity: "normal",
  start: { dateTime: "2026-09-14T14:00:00", timeZone: "UTC" },
  end: { dateTime: "2026-09-14T15:00:00", timeZone: "UTC" },
  showAs: "busy",
  isCancelled: false,
  isAllDay: false,
  bodyPreview: "DO NOT EXPOSE",
  body: { content: "SECRET" },
};
export const config = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "TEST-ONLY",
  calendars: {
    work: { mailbox: "fake@example.invalid", calendarId: "fake-id" },
    other: { mailbox: "other@example.invalid", calendarId: "other-id" },
  },
  clients: [
    {
      id: "one",
      secret: "TEST-ONLY-" + "a".repeat(40),
      calendarKeys: ["work"],
    },
    {
      id: "two",
      secret: "TEST-ONLY-" + "b".repeat(40),
      calendarKeys: ["other"],
    },
  ],
};
