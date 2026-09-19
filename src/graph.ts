export type Range = { start: string; end: string };
export type Mapping = { mailbox: string; calendarId: string };
export type Event = {
  id: string;
  subject: string;
  start: string;
  end: string;
  showAs: string;
  isCancelled: boolean;
  isAllDay: boolean;
  /** Original calendar dates; endDate is exclusive. Never timezone-shift these. */
  startDate?: string;
  endDate?: string;
  private: boolean;
};
// Only losslessly recover all-day dates with a provider-supplied original zone.
// Custom/unsupported Windows zones or nonmidnight boundaries remain unavailable.
function allDayDates(
  start: string,
  end: string,
  startZone: unknown,
  endZone: unknown,
): { startDate?: string; endDate?: string } {
  if (typeof startZone !== "string" || startZone !== endZone) return {};
  const zone =
    startZone === "Eastern Standard Time" ? "America/New_York" : startZone;
  try {
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
    const dates = [start, end].map((value) => {
      // Inspect original Graph precision before Date truncates submilliseconds.
      // Recovery accepts only whole seconds or an explicitly all-zero fraction.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0+)?Z?$/.test(value))
        throw Error("not_exact_boundary");
      const parts = Object.fromEntries(
        fmt
          .formatToParts(new Date(value.endsWith("Z") ? value : value + "Z"))
          .map((p) => [p.type, p.value]),
      );
      if (parts.hour !== "00" || parts.minute !== "00" || parts.second !== "00")
        throw Error("not_midnight");
      return `${parts.year}-${parts.month}-${parts.day}`;
    });
    return dates[0] < dates[1]
      ? { startDate: dates[0], endDate: dates[1] }
      : {};
  } catch {
    return {};
  }
}

export type View = { complete: boolean; events: Event[]; error?: string };
export type GraphOptions = {
  delegated?: Mapping;
  token: (signal?: AbortSignal) => Promise<string>;
  base?: string;
  testOnly?: boolean;
  timeoutMs?: number;
  maxPages?: number;
  maxEvents?: number;
};
export class Graph {
  readonly base: string;
  constructor(readonly options: GraphOptions) {
    this.base = options.base ?? "https://graph.microsoft.com";
    if (
      this.base !== "https://graph.microsoft.com" &&
      !(options.testOnly && /^http:\/\/127\.0\.0\.1:\d+$/.test(this.base))
    )
      throw Error("Invalid Graph origin");
  }
  async view(
    mapping: Mapping,
    range: Range,
    lifecycle: {
      signal?: AbortSignal;
      // Called only after the view AND any abort-ignoring token work settle.
      onSettled?: () => void;
    } = {},
  ): Promise<View> {
    if (
      this.options.delegated &&
      (mapping.mailbox !== this.options.delegated.mailbox ||
        mapping.calendarId !== this.options.delegated.calendarId)
    ) {
      lifecycle.onSettled?.();
      return { complete: false, events: [], error: "forbidden_calendar" };
    }
    const url = new URL(
      this.options.delegated
        ? `/v1.0/me/calendars/${encodeURIComponent(this.options.delegated.calendarId)}/calendarView`
        : `/v1.0/users/${encodeURIComponent(mapping.mailbox)}/calendars/${encodeURIComponent(mapping.calendarId)}/calendarView`,
      this.base,
    );
    url.searchParams.set("startDateTime", range.start);
    url.searchParams.set("endDateTime", range.end);
    url.searchParams.set("$top", "100");
    url.searchParams.set(
      "$select",
      "id,subject,sensitivity,start,end,showAs,isCancelled,isAllDay,originalStartTimeZone,originalEndTimeZone",
    );
    const events: Event[] = [];
    let next: string | undefined = url.href;
    const seen = new Set<string>();
    const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 15000);
    const signal = lifecycle.signal
      ? AbortSignal.any([deadline, lifecycle.signal])
      : deadline;
    let tokenWork: Promise<string> | undefined;
    try {
      signal.throwIfAborted();
      tokenWork = this.options.token(signal);
      const token = await new Promise<string>((resolve, reject) => {
        const abort = () => reject(Error("timeout"));
        signal.addEventListener("abort", abort, { once: true });
        tokenWork!
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      for (let page = 0; next && page < (this.options.maxPages ?? 10); page++) {
        const target = new URL(next);
        if (
          target.origin !== url.origin ||
          target.pathname !== url.pathname ||
          target.username ||
          target.password ||
          target.hash ||
          seen.has(target.href)
        )
          throw Error("unsafe_pagination");
        seen.add(target.href);
        // Pin the projection and time window even if a nextLink changes them.
        for (const key of ["startDateTime", "endDateTime", "$select", "$top"])
          target.searchParams.set(key, url.searchParams.get(key)!);
        for (const key of target.searchParams.keys())
          if (
            ![
              "startDateTime",
              "endDateTime",
              "$select",
              "$top",
              "$skiptoken",
              "$skip",
            ].includes(key)
          )
            throw Error("unsafe_pagination");
        let response: Response | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await fetch(target, {
            signal,
            headers: {
              Authorization: `Bearer ${token}`,
              Prefer: 'outlook.timezone="UTC"',
            },
            redirect: "error",
          });
          if (![429, 503, 504].includes(response.status)) break;
          const retry = response.headers.get("retry-after");
          await response.body?.cancel();
          if (attempt === 2) throw Error("throttled");
          const seconds = retry === null ? 0.25 : Number(retry);
          if (!Number.isFinite(seconds) || seconds > 2 || seconds < 0)
            throw Error("throttled");
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(done, seconds * 1000);
            function done() {
              signal.removeEventListener("abort", abort);
              resolve();
            }
            function abort() {
              clearTimeout(timer);
              reject(Error("timeout"));
            }
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          });
        }
        if (!response?.ok) {
          // Fetch resolves at headers, not transport completion. Await disposal
          // of unused error bodies before onSettled can release operation capacity.
          await response?.body?.cancel();
          throw Error("upstream_http");
        }
        const reader = response.body!.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.length;
          if (size > 2000000) {
            await reader.cancel();
            throw Error("response_limit");
          }
          chunks.push(r.value);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!Array.isArray(data.value)) throw Error("invalid_response");
        for (const e of data.value) {
          if (events.length >= (this.options.maxEvents ?? 1000))
            throw Error("event_limit");
          const date = (v: any) => {
            if (v?.timeZone !== "UTC" || typeof v.dateTime !== "string")
              throw Error("invalid_response");
            const s = /Z$/.test(v.dateTime) ? v.dateTime : v.dateTime + "Z";
            if (!Number.isFinite(Date.parse(s)))
              throw Error("invalid_response");
            return new Date(s).toISOString();
          };
          if (
            typeof e.id !== "string" ||
            typeof e.subject !== "string" ||
            typeof e.isCancelled !== "boolean" ||
            typeof e.isAllDay !== "boolean" ||
            ![
              "free",
              "tentative",
              "busy",
              "oof",
              "workingElsewhere",
              "unknown",
            ].includes(e.showAs)
          )
            throw Error("invalid_response");
          const start = date(e.start),
            end = date(e.end);
          if (end <= start) throw Error("invalid_response");
          events.push({
            id: e.sensitivity === "normal" ? e.id : "redacted",
            subject:
              e.sensitivity === "normal"
                ? e.subject.slice(0, 500)
                : "Private event",
            start,
            end,
            showAs: e.showAs,
            isCancelled: e.isCancelled,
            isAllDay: e.isAllDay,
            ...(e.isAllDay
              ? allDayDates(
                  e.start.dateTime,
                  e.end.dateTime,
                  e.originalStartTimeZone,
                  e.originalEndTimeZone,
                )
              : {}),
            private: e.sensitivity !== "normal",
          });
        }
        next = undefined;
        if (Object.hasOwn(data, "@odata.nextLink")) {
          const link = data["@odata.nextLink"];
          if (
            typeof link !== "string" ||
            link.length === 0 ||
            !URL.canParse(link)
          )
            throw Error("invalid_response");
          next = link;
        }
      }
      if (next) throw Error("page_limit");
      return { complete: true, events };
    } catch (e) {
      const known = [
        "interaction_required",
        "unsafe_pagination",
        "throttled",
        "upstream_http",
        "response_limit",
        "invalid_response",
        "event_limit",
        "page_limit",
      ];
      const message = e instanceof Error ? e.message : "";
      return {
        complete: false,
        events,
        error: signal.aborted
          ? lifecycle.signal?.aborted
            ? "cancelled"
            : "timeout"
          : known.includes(message)
            ? message
            : "upstream_unavailable",
      };
    } finally {
      // A deadline/cancellation ends the response, not necessarily credential
      // acquisition. Never release capacity on the raced response alone.
      if (lifecycle.onSettled) {
        if (tokenWork)
          void tokenWork.then(lifecycle.onSettled, lifecycle.onSettled);
        else lifecycle.onSettled();
      }
    }
  }
}
