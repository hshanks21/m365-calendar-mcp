import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("telemetry persists only allowlisted fields, bounds retention and filters periods", async () => {
  const m = await import("../src/telemetry.js").catch(() => ({
    Telemetry: undefined,
  }));
  assert.equal(typeof m.Telemetry, "function");
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-"));
  try {
    let now = Date.parse("2026-09-14T12:00:00Z");
    const t = new m.Telemetry!(join(dir, "events.json"), {
      now: () => now,
      maxEvents: 3,
    });
    assert.equal(t.snapshot("today").successRate, null);
    t.record({
      caller: 1,
      operation: "list_events",
      outcome: "success",
      durationMs: 100,
      graphSuccess: true,
      subject: "PRIVATE",
      secret: "SECRET",
    } as any);
    now += 86400000;
    t.record({
      caller: 2,
      operation: "search_events",
      outcome: "denied",
      durationMs: 10,
    });
    assert.equal(t.snapshot("today").calls, 1);
    assert.equal(t.snapshot("week").calls, 2);
    assert.equal(t.snapshot("today").successRate, 0);
    assert.equal(
      t.snapshot("week").lastGraphSuccess,
      Date.parse("2026-09-14T12:00:00Z"),
    );
    t.record({
      caller: 2,
      operation: "RAW SECRET",
      outcome: "error",
      durationMs: 20,
    } as any);
    assert.equal(t.snapshot("week").calls, 2);
    t.record({
      caller: 1,
      operation: "list_calendars",
      outcome: "success",
      durationMs: 1,
    });
    t.record({
      caller: 1,
      operation: "list_calendars",
      outcome: "success",
      durationMs: 2,
    });
    assert.equal(t.snapshot("month").calls, 3);
    const disk = readFileSync(join(dir, "events.json"), "utf8");
    assert.ok(!/PRIVATE|SECRET|subject|secret/.test(disk));
    assert.equal(
      new m.Telemetry!(join(dir, "events.json"), {
        now: () => now,
        maxEvents: 3,
      }).snapshot("week").calls,
      3,
    );
    now += 32 * 86400000;
    // Restart must remove expired records from disk even without new requests.
    const later = new m.Telemetry!(join(dir, "events.json"), {
      now: () => now,
    });
    assert.equal(later.snapshot("month").calls, 0);
    assert.equal(
      JSON.parse(readFileSync(join(dir, "events.json"), "utf8")).length,
      0,
    );
    assert.throws(() => t.snapshot("bad" as any));
    assert.throws(() => t.snapshot("today", -1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
