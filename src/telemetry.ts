import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
export const operations = [
  "list_calendars",
  "list_events",
  "search_events",
  "get_work_availability",
  "connection_status",
  "protocol",
  "authentication",
] as const;
type Entry = {
  at: number;
  caller: number;
  operation: (typeof operations)[number];
  outcome: "success" | "denied" | "error";
  durationMs: number;
  graphSuccess: boolean;
  googleSuccess: boolean;
};
type Input = Omit<Entry, "at" | "graphSuccess" | "googleSuccess"> & {
  graphSuccess?: boolean;
  googleSuccess?: boolean;
};
export class Telemetry {
  private events: Entry[] = [];
  private now: () => number;
  private max: number;
  storageHealthy = true;
  constructor(
    private file: string,
    options: { now?: () => number; maxEvents?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.max = Math.min(5000, Math.max(1, options.maxEvents ?? 5000));
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    try {
      if (statSync(file).size > 2000000) throw Error();
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(data)) throw Error();
      this.events = data
        .filter((e) => this.valid(e) && Number.isFinite(e.at))
        .map((e) => this.clean(e, e.at))
        .slice(-this.max);
    } catch (e: any) {
      if (e.code !== "ENOENT") this.storageHealthy = false;
    }
    this.prune();
    if (this.storageHealthy) this.persist();
  }
  private valid(e: any): boolean {
    return (
      !!e &&
      operations.includes(e.operation) &&
      ["success", "denied", "error"].includes(e.outcome) &&
      Number.isInteger(e.caller) &&
      e.caller >= 0 &&
      e.caller <= 64 &&
      Number.isFinite(e.durationMs) &&
      e.durationMs >= 0
    );
  }
  private clean(e: Input, at: number): Entry {
    return {
      at,
      caller: e.caller,
      operation: e.operation,
      outcome: e.outcome,
      durationMs: Math.min(3600000, Math.round(e.durationMs)),
      graphSuccess: e.graphSuccess === true && e.outcome === "success",
      googleSuccess: e.googleSuccess === true && e.outcome === "success",
    };
  }
  private prune() {
    const now = this.now();
    this.events = this.events
      .filter((e) => e.at >= now - 31 * 86400000 && e.at <= now)
      .slice(-this.max);
  }
  private persist() {
    try {
      writeFileSync(this.file + ".tmp", JSON.stringify(this.events), {
        mode: 0o600,
      });
      renameSync(this.file + ".tmp", this.file);
      this.storageHealthy = true;
    } catch {
      this.storageHealthy = false;
    }
  }
  record(e: Input) {
    if (!this.valid(e)) return;
    this.events.push(this.clean(e, this.now()));
    this.prune();
    this.persist();
  }
  snapshot(period: "today" | "week" | "month", offset = 0, limit = 25) {
    if (
      !["today", "week", "month"].includes(period) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 5000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw Error("invalid_filter");
    const before = this.events.length;
    this.prune();
    if (before !== this.events.length) this.persist();
    const now = this.now(),
      start =
        period === "today"
          ? Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z")
          : now - (period === "week" ? 7 : 31) * 86400000;
    const rows = this.events.filter((e) => e.at >= start),
      successes = rows.filter((e) => e.outcome === "success").length;
    const latencies = rows.map((e) => e.durationMs).sort((a, b) => a - b);
    return {
      period,
      windowStart: start,
      asOf: now,
      calls: rows.length,
      successes,
      denied: rows.filter((e) => e.outcome === "denied").length,
      errors: rows.filter((e) => e.outcome === "error").length,
      successRate: rows.length ? successes / rows.length : null,
      medianMs: latencies.length
        ? latencies[Math.floor(latencies.length / 2)]
        : null,
      lastGoogleSuccess:
        this.events.filter((e) => e.googleSuccess).at(-1)?.at ?? null,
      lastGraphSuccess:
        this.events.filter((e) => e.graphSuccess).at(-1)?.at ?? null,
      storageHealthy: this.storageHealthy,
      retention: {
        maxEvents: this.max,
        maxDays: 31,
        retained: this.events.length,
        oldest: this.events[0]?.at ?? null,
      },
      callers: Array.from(new Set(rows.map((e) => e.caller))).map((caller) => ({
        caller,
        calls: rows.filter((e) => e.caller === caller).length,
      })),
      operations: operations.map((operation) => ({
        operation,
        calls: rows.filter((e) => e.operation === operation).length,
      })),
      logs: [...rows].reverse().slice(offset, offset + limit),
      offset,
      limit,
      total: rows.length,
      hasMore: offset + limit < rows.length,
    };
  }
}
