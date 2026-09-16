import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
const mapping = z
  .object({
    mailbox: z.string().email().max(254),
    calendarId: z
      .string()
      .min(1)
      .max(512)
      .refine((v) => v !== "." && v !== ".."),
  })
  .strict();
export const policy = z
  .object({
    calendars: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), mapping),
    clients: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            secret: z.string().min(32).max(256),
            calendarKeys: z.array(z.string()).min(1).max(32),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();
export type Config = z.infer<typeof policy> & {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    const tenantId = z.string().uuid().parse(env.CALENDAR_M365_TENANT_ID),
      clientId = z.string().uuid().parse(env.CALENDAR_M365_CLIENT_ID),
      clientSecret = z.string().min(1).parse(env.CALENDAR_M365_CLIENT_SECRET);
    let raw = env.CALENDAR_M365_POLICY_JSON;
    if (env.CALENDAR_M365_POLICY_FILE) {
      if (raw) throw Error();
      const st = statSync(env.CALENDAR_M365_POLICY_FILE);
      if (!st.isFile() || (st.mode & 0o077) !== 0) throw Error();
      raw = readFileSync(env.CALENDAR_M365_POLICY_FILE, "utf8");
    }
    const p = policy.parse(JSON.parse(raw ?? ""));
    if (
      new Set(p.clients.map((c) => c.id)).size !== p.clients.length ||
      new Set(p.clients.map((c) => c.secret)).size !== p.clients.length ||
      p.clients.some((c) =>
        c.calendarKeys.some((k) => !Object.hasOwn(p.calendars, k)),
      )
    )
      throw Error();
    return { ...p, tenantId, clientId, clientSecret };
  } catch {
    throw Error(
      "Invalid calendar configuration; dedicated credentials and client policy required",
    );
  }
}
