// Synthetic loopback streaming responses; no live Graph or credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Graph } from "../src/graph.js";
import { config, fixture, range } from "./fixtures.js";

test("operation release awaits error-body cancellation, not just HTTP headers", async (t) => {
  const realFetch = globalThis.fetch;
  let allowCleanup!: () => void;
  let enteredCleanup!: () => void;
  const cleanupGate = new Promise<void>((resolve) => {
    allowCleanup = resolve;
  });
  const cleanupEntered = new Promise<void>((resolve) => {
    enteredCleanup = resolve;
  });
  let released = 0;
  let cancelled = false;
  const f = await fixture((_req: any, res: any) => {
    res.writeHead(500);
    res.write("unfinished");
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (...args: Parameters<typeof fetch>) => {
      const response = await realFetch(...args);
      const cancel = response.body!.cancel.bind(response.body);
      t.mock.method(response.body!, "cancel", async () => {
        enteredCleanup();
        await cleanupGate;
        await cancel();
        cancelled = true;
      });
      return response;
    },
  );
  try {
    const view = new Graph({
      base: f.url,
      testOnly: true,
      timeoutMs: 10000,
      token: async () => "TEST-ONLY",
    }).view(config.calendars.work, range, {
      onSettled: () => {
        assert.ok(cancelled);
        released++;
      },
    });
    await Promise.race([
      cleanupEntered,
      view.then(() => {
        throw Error("view settled without entering body cleanup");
      }),
    ]);
    assert.equal(released, 0, "capacity remains held during cleanup");
    allowCleanup();
    assert.equal((await view).error, "upstream_http");
    assert.equal(released, 1);
  } finally {
    allowCleanup();
    t.mock.restoreAll();
    await f.close();
  }
});

test("unfinished retry bodies close on recovery, exhaustion and rejected Retry-After", async () => {
  for (const status of [429, 503, 504]) {
    for (const mode of ["recover", "exhaust", "invalid-delay"]) {
      let open = 0;
      let calls = 0;
      let released = 0;
      const f = await fixture((_req: any, res: any) => {
        calls++;
        if (mode === "recover" && calls === 2) {
          res.end(JSON.stringify({ value: [] }));
          return;
        }
        open++;
        res.once("close", () => open--);
        res.writeHead(status, {
          "Retry-After": mode === "invalid-delay" ? "3" : "0",
        });
        res.write("unfinished retry body");
      });
      try {
        const result = await new Graph({
          base: f.url,
          testOnly: true,
          timeoutMs: 10000,
          token: async () => "TEST-ONLY",
        }).view(config.calendars.work, range, {
          onSettled: () => released++,
        });
        assert.deepEqual(
          result,
          mode === "recover"
            ? { complete: true, events: [] }
            : { complete: false, events: [], error: "throttled" },
        );
        assert.equal(
          calls,
          mode === "recover" ? 2 : mode === "exhaust" ? 3 : 1,
        );
        assert.equal(released, 1);
        for (let i = 0; open && i < 50; i++) await delay(10);
        assert.equal(open, 0, `${status}/${mode} left an unfinished response`);
      } finally {
        await f.close();
      }
    }
  }
});

test("unfinished HTTP 500 body is terminated when the operation settles", async () => {
  let open = 0;
  let released = 0;
  const f = await fixture((_req: any, res: any) => {
    open++;
    res.once("close", () => open--);
    res.writeHead(500);
    res.write("unfinished synthetic error"); // Never end the body.
  });
  try {
    const g = new Graph({
      base: f.url,
      testOnly: true,
      timeoutMs: 10000,
      token: async () => "TEST-ONLY",
    });
    assert.deepEqual(
      await g.view(config.calendars.work, range, {
        onSettled: () => released++,
      }),
      { complete: false, events: [], error: "upstream_http" },
    );
    assert.equal(released, 1);
    // Remote close notification is asynchronous, not the client cleanup promise.
    for (let i = 0; open && i < 50; i++) await delay(10);
    assert.equal(
      open,
      0,
      "settled operation must not leave an unfinished body open",
    );
  } finally {
    await f.close();
  }
});
