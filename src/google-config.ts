import { z } from "zod";
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const calendarIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (v) =>
      !["primary", "*", ".", ".."].includes(v) && !/[\x00-\x20\x7f]/.test(v),
  );
const credentials = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/),
  clientSecret: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
  refreshToken: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
});
export function googleCredentials(env: NodeJS.ProcessEnv) {
  try {
    return credentials.parse({
      clientId: env.CALENDAR_GOOGLE_CLIENT_ID,
      clientSecret: env.CALENDAR_GOOGLE_CLIENT_SECRET,
      refreshToken: env.CALENDAR_GOOGLE_REFRESH_TOKEN,
    });
  } catch {
    throw Error("Invalid dedicated Google credentials");
  }
}
const policy = z
  .object({
    calendars: z.record(
      key,
      z.object({ calendarId: calendarIdSchema }).strict(),
    ),
    clients: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            secret: z.string().min(32).max(256),
            calendarKeys: z.array(key).min(1).max(32),
            writeCalendarKeys: z.array(key).max(32).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();
export function loadGoogleConfig(env: NodeJS.ProcessEnv) {
  try {
    const creds = googleCredentials(env);
    if (
      env.CALENDAR_GOOGLE_CREATE_ENABLED &&
      env.CALENDAR_GOOGLE_CREATE_ENABLED !== "false"
    )
      throw Error();
    const p = policy.parse(JSON.parse(env.CALENDAR_GOOGLE_POLICY_JSON ?? ""));
    if (
      new Set(p.clients.map((c) => c.id)).size !== p.clients.length ||
      new Set(p.clients.map((c) => c.secret)).size !== p.clients.length ||
      p.clients.some(
        (c) =>
          c.calendarKeys.some((k) => !Object.hasOwn(p.calendars, k)) ||
          c.writeCalendarKeys.some((k) => !c.calendarKeys.includes(k)),
      )
    )
      throw Error();
    return {
      ...creds,
      clients: p.clients,
      calendars: Object.fromEntries(
        Object.entries(p.calendars).map(([k, v]) => [
          k,
          { ...v, provider: "google" as const },
        ]),
      ),
    };
  } catch {
    throw Error(
      "Invalid Google configuration; explicit calendar policy required; creation disabled",
    );
  }
}
export type GoogleConfig = ReturnType<typeof loadGoogleConfig>;
