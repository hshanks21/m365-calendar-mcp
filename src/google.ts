import { z } from "zod";
import { calendarIdSchema, type googleCredentials } from "./google-config.js";
import type { Range, View, Event } from "./graph.js";
const instant = z.string().datetime({ offset: true });
const window = z
  .object({ start: instant, end: instant })
  .refine(
    (r) =>
      Date.parse(r.end) > Date.parse(r.start) &&
      Date.parse(r.end) - Date.parse(r.start) <= 31 * 86400000,
  );
const fields =
  "nextPageToken,timeZone,items(id,summary,status,visibility,start,end,transparency)";
function midnight(value: unknown, zone: unknown): string {
  const date = z.string().date().parse(value);
  if (typeof zone !== "string") throw Error("invalid_response");
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const desired = Date.parse(date + "T00:00:00Z");
  let time = desired;
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      fmt.formatToParts(time).map((p) => [p.type, p.value]),
    );
    const actual = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    if (actual === desired) return new Date(time).toISOString();
    time += desired - actual;
  }
  throw Error("invalid_response"); // Historical nonexistent midnight is incomplete, not guessed.
}
export type GoogleOptions = {
  base?: string;
  tokenUrl?: string;
  testOnly?: boolean;
  timeoutMs?: number;
  maxPages?: number;
  maxEvents?: number;
};
export class GoogleCalendar {
  readonly base: string;
  readonly tokenUrl: string;
  private access?: { token: string; expires: number };
  constructor(
    private credentials: ReturnType<typeof googleCredentials>,
    readonly options: GoogleOptions = {},
  ) {
    this.base = options.base ?? "https://www.googleapis.com";
    this.tokenUrl = options.tokenUrl ?? "https://oauth2.googleapis.com/token";
    if (
      (this.base !== "https://www.googleapis.com" ||
        this.tokenUrl !== "https://oauth2.googleapis.com/token") &&
      !(
        options.testOnly &&
        /^http:\/\/127\.0\.0\.1:\d+$/.test(this.base) &&
        this.tokenUrl === this.base + "/token"
      )
    )
      throw Error("Invalid Google origin");
  }
  private async json(
    url: URL | string,
    init: RequestInit,
    limit = 2000000,
  ): Promise<any> {
    const response = await fetch(url, { ...init, redirect: "error" });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw Error("upstream_http");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const c of response.body) {
      size += c.length;
      if (size > limit) throw Error("response_limit");
      chunks.push(c);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  private async token(signal: AbortSignal) {
    if (this.access && this.access.expires > Date.now() + 60000)
      return this.access.token;
    const c = this.credentials;
    const d = await this.json(
      this.tokenUrl,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: c.clientId,
          client_secret: c.clientSecret,
          refresh_token: c.refreshToken,
        }),
      },
      16384,
    );
    if (
      typeof d.access_token !== "string" ||
      !/^[\x21-\x7e]{1,4096}$/.test(d.access_token) ||
      d.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(d.expires_in) ||
      d.expires_in <= 0
    )
      throw Error("invalid_response");
    const scopes = [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ];
    if (
      d.scope !== undefined &&
      (typeof d.scope !== "string" ||
        new Set(d.scope.split(" ")).size !== scopes.length ||
        !scopes.every((s) => d.scope.split(" ").includes(s)))
    )
      throw Error("invalid_response");
    this.access = {
      token: d.access_token,
      expires: Date.now() + Math.min(d.expires_in, 3600) * 1000,
    };
    return this.access.token;
  }
  async discover() {
    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 15000);
    const url = new URL("/calendar/v3/users/me/calendarList", this.base);
    url.search = new URLSearchParams({
      maxResults: "100",
      showDeleted: "false",
      showHidden: "false",
      fields: "nextPageToken,items(id,summary,accessRole)",
    }).toString();
    const token = await this.token(signal);
    const calendars: { id: string; summary: string; accessRole: string }[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const d = await this.json(url, {
        signal,
        headers: { Authorization: "Bearer " + token },
      });
      if (!Array.isArray(d.items)) throw Error("Discovery failed");
      for (const e of d.items) {
        if (
          calendars.length >= 1000 ||
          typeof e?.id !== "string" ||
          e.id.length > 512 ||
          typeof e.summary !== "string" ||
          e.summary.length > 1024 ||
          ![
            "freeBusyReader",
            "reader",
            "writer",
            "writerWithoutPrivateAccess",
            "owner",
          ].includes(e.accessRole)
        )
          throw Error("Discovery failed");
        calendars.push({
          id: e.id,
          summary: e.summary,
          accessRole: e.accessRole,
        });
      }
      if (!Object.hasOwn(d, "nextPageToken"))
        return { complete: true, calendars };
      if (
        typeof d.nextPageToken !== "string" ||
        !d.nextPageToken.length ||
        d.nextPageToken.length > 2048 ||
        seen.has(d.nextPageToken)
      )
        throw Error("Discovery incomplete");
      seen.add(d.nextPageToken);
      url.searchParams.set("pageToken", d.nextPageToken);
    }
    throw Error("Discovery incomplete");
  }
  async view(
    mapping: { calendarId: string },
    range: Range,
    lifecycle: { signal?: AbortSignal; onSettled?: () => void } = {},
  ): Promise<View> {
    const signal = lifecycle.signal
      ? AbortSignal.any([
          lifecycle.signal,
          AbortSignal.timeout(this.options.timeoutMs ?? 15000),
        ])
      : AbortSignal.timeout(this.options.timeoutMs ?? 15000);
    try {
      calendarIdSchema.parse(mapping.calendarId);
      window.parse(range);
      signal.throwIfAborted();
      const url = new URL(
        `/calendar/v3/calendars/${encodeURIComponent(mapping.calendarId)}/events`,
        this.base,
      );
      url.search = new URLSearchParams({
        timeMin: range.start,
        timeMax: range.end,
        singleEvents: "true",
        showDeleted: "false",
        maxResults: "100",
        fields,
      }).toString();
      const token = await this.token(signal);
      const events: Event[] = [];
      const seen = new Set<string>();
      let count = 0;
      for (
        let page = 0;
        page < Math.min(this.options.maxPages ?? 10, 10);
        page++
      ) {
        const d = await this.json(url, {
          signal,
          headers: { Authorization: "Bearer " + token },
        });
        if (!Array.isArray(d.items)) throw Error("invalid_response");
        for (const e of d.items) {
          if (++count > Math.min(this.options.maxEvents ?? 1000, 1000))
            throw Error("event_limit");
          if (e?.status === "cancelled") continue;
          if (
            !e ||
            !["confirmed", "tentative"].includes(e.status) ||
            typeof e.id !== "string"
          )
            throw Error("invalid_response");
          const allDay = typeof e.start?.date === "string";
          if (
            allDay !== (typeof e.end?.date === "string") ||
            (allDay &&
              (e.start.dateTime !== undefined || e.end.dateTime !== undefined))
          )
            throw Error("invalid_response");
          const start = allDay
              ? midnight(e.start.date, d.timeZone)
              : new Date(instant.parse(e.start?.dateTime)).toISOString(),
            end = allDay
              ? midnight(e.end.date, d.timeZone)
              : new Date(instant.parse(e.end?.dateTime)).toISOString();
          if (end <= start) throw Error("invalid_response");
          const privateEvent = !["default", "public"].includes(
            e.visibility ?? "default",
          );
          events.push({
            id: privateEvent ? "redacted" : e.id,
            subject: privateEvent
              ? "Private event"
              : typeof e.summary === "string"
                ? e.summary.slice(0, 500)
                : "(untitled)",
            start,
            end,
            showAs:
              e.transparency === "transparent"
                ? "free"
                : e.status === "tentative"
                  ? "tentative"
                  : "busy",
            isCancelled: false,
            isAllDay: allDay,
            ...(allDay ? { startDate: e.start.date, endDate: e.end.date } : {}),
            private: privateEvent,
          });
        }
        if (!Object.hasOwn(d, "nextPageToken"))
          return { complete: true, events };
        if (
          typeof d.nextPageToken !== "string" ||
          !d.nextPageToken.length ||
          d.nextPageToken.length > 2048 ||
          seen.has(d.nextPageToken)
        )
          throw Error("unsafe_pagination");
        seen.add(d.nextPageToken);
        url.searchParams.set("pageToken", d.nextPageToken);
      }
      throw Error("page_limit");
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      return {
        complete: false,
        events: [],
        error: signal.aborted
          ? "cancelled_or_timeout"
          : [
                "upstream_http",
                "response_limit",
                "invalid_response",
                "event_limit",
                "unsafe_pagination",
                "page_limit",
              ].includes(message)
            ? message
            : "upstream_unavailable",
      };
    } finally {
      lifecycle.onSettled?.();
    }
  }
}
