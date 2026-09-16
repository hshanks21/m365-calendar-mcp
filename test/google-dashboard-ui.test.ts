import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
test("dashboard renders both provider labels and distinct last-read timestamps without fabricated Google health", () => {
  const elements = new Map<string, any>();
  const element = () => ({
    textContent: "",
    hidden: false,
    classList: { toggle() {} },
    addEventListener() {},
    replaceChildren() {},
    append() {},
    setAttribute() {},
  });
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const context: any = {
    document: {
      getElementById: get,
      querySelector: get,
      querySelectorAll: () => [],
      createElement: element,
    },
    setInterval() {},
    fetch: () => new Promise(() => {}),
  };
  runInNewContext(readFileSync("public/app.js", "utf8"), context);
  const d = {
    health: {
      graph: "not_configured",
      google: "unverified",
      mcp: "up",
      service: "up",
      mode: "local",
    },
    access: { callers: [], calendarCount: 1 },
    metrics: {
      calls: 0,
      errors: 0,
      denied: 0,
      medianMs: null,
      storageHealthy: true,
      lastGraphSuccess: null,
      lastGoogleSuccess: null,
      callers: [],
      operations: [],
      logs: [],
      total: 0,
      retention: { maxEvents: 5000, maxDays: 31, retained: 0 },
      asOf: 0,
    },
  };
  context.d = d;
  runInNewContext("render(d)", context);
  assert.match(get("connection").textContent, /Google.*unverified/);
  assert.match(get("connection").textContent, /Microsoft 365.*not configured/);
  assert.doesNotMatch(get("attention-title").textContent, /isn’t configured/);
  assert.match(
    get("last-read").textContent,
    /Google: No successful read observed/,
  );
  d.health.google = "previous_read_succeeded";
  d.metrics.lastGoogleSuccess = Date.parse("2026-09-14T14:00:00Z") as any;
  runInNewContext("render(d)", context);
  assert.match(
    get("last-read").textContent,
    /Microsoft 365: No successful read observed/,
  );
  assert.doesNotMatch(
    get("last-read").textContent,
    /Google: No successful read observed/,
  );
});
