// Synthetic credentials and loopback HTTP only; no live Microsoft Graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { Graph } from "../src/graph.js";
import { startServer } from "../src/server.js";
import { config, fixture, range } from "./fixtures.js";

test("disconnect cancels an in-flight real synthetic upstream HTTP read", async () => {
  let began!: () => void;
  let closed!: () => void;
  const upstreamStarted = new Promise<void>((resolve) => {
    began = resolve;
  });
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const f = await fixture((_req: any, res: any) => {
    res.once("close", closed);
    began(); // Intentionally hang; only cancellation should close this response.
  });
  const s = await startServer(
    config,
    new Graph({
      base: f.url,
      testOnly: true,
      timeoutMs: 10000,
      token: async () => "TEST-ONLY",
    }),
    0,
  );
  const controller = new AbortController();
  try {
    const request = fetch(s.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: "Bearer " + config.clients[0].secret,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_events",
          arguments: { calendarKey: "work", ...range },
        },
      }),
    }).catch(() => {});
    await upstreamStarted;
    controller.abort();
    await request;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        upstreamClosed,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error("disconnect did not cancel upstream before deadline"),
              ),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    controller.abort();
    await s.close();
    await f.close();
  }
});

test("authenticated disconnects retain operation slots until ignored-abort tokens settle", async () => {
  const pending: {
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    signal?: AbortSignal;
  }[] = [];
  let started = () => {};
  let upstreamCalls = 0;
  const f = await fixture((_req: any, res: any) => {
    upstreamCalls++;
    res.end(JSON.stringify({ value: [] }));
  });
  let hold = true;
  const g = new Graph({
    base: f.url,
    testOnly: true,
    timeoutMs: 1000,
    token: (signal) =>
      hold
        ? new Promise<string>((resolve, reject) => {
            pending.push({ resolve, reject, signal });
            started();
          })
        : Promise.resolve("TEST-ONLY"),
  });
  const s = await startServer(config, g, 0);
  const call = (
    signal?: AbortSignal,
    authorization = "Bearer " + config.clients[0].secret,
  ) =>
    fetch(s.url, {
      method: "POST",
      signal,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_events",
          arguments: { calendarKey: "work", ...range },
        },
      }),
    });
  try {
    const denied: any[] = [];
    for (let i = 0; i < 24; i++) {
      const began = new Promise<"started">((resolve) => {
        started = () => resolve("started");
      });
      const controller = new AbortController();
      const response = call(controller.signal);
      const first = await Promise.race([began, response]);
      if (first !== "started") denied.push(await first.json());
      controller.abort();
      await response.catch(() => {});
      if (first === "started") {
        // Client rejection does not acknowledge the server's socket close.
        // Await actual credential cancellation, bounded independently so a
        // missing close cannot hang; retain the AbortError check below so the
        // Graph deadline cannot masquerade as disconnect cancellation.
        const signal = pending.at(-1)?.signal;
        assert.ok(signal);
        if (!signal.aborted)
          await once(signal, "abort", { signal: AbortSignal.timeout(1000) });
        assert.equal(pending.at(-1)?.signal?.aborted, true);
        assert.equal(
          pending.at(-1)?.signal?.reason.name,
          "AbortError",
          "socket cancellation, not the deadline, aborts token acquisition",
        );
      }
    }
    assert.equal(
      pending.length,
      16,
      "disconnections must not admit more than 16 upstream operations",
    );
    assert.equal(denied.length, 8);
    assert.ok(
      denied.every(
        (r) =>
          r.result.isError &&
          JSON.parse(r.result.content[0].text).error === "server_busy",
      ),
    );
    assert.ok(
      pending.every((p) => p.signal?.aborted),
      "disconnect cancellation reaches credential acquisition",
    );
    assert.equal((await call(undefined, "Bearer wrong")).status, 401);
    await delay(1100); // Even the hard deadline must not release unsettled work.
    const stillBusy: any = await (await call()).json();
    assert.equal(
      JSON.parse(stillBusy.result.content[0].text).error,
      "server_busy",
    );
    assert.equal(pending.length, 16);
    // Both fulfilled and rejected uncooperative credentials release their slots.
    hold = false;
    pending.forEach((p, i) =>
      i % 2 ? p.reject(Error("synthetic failure")) : p.resolve("TEST-ONLY"),
    );
    await delay(20);
    assert.equal(
      upstreamCalls,
      0,
      "aborted tokens must not start a Graph request later",
    );
    hold = true;
    const recovery: Promise<Response>[] = [];
    for (let i = 0; i < 16; i++) {
      const began = new Promise<"started">((resolve) => {
        started = () => resolve("started");
      });
      const response = call();
      recovery.push(response);
      assert.equal(
        await Promise.race([began, response]),
        "started",
        "all 16 operation slots must be reusable simultaneously",
      );
    }
    assert.equal(pending.length, 32);
    pending.slice(16).forEach((p) => p.resolve("TEST-ONLY"));
    await Promise.all(
      recovery.map(async (response) => {
        const r = await response;
        assert.equal(r.status, 200);
        const body: any = await r.json();
        assert.ok(!body.result.isError);
        assert.equal(JSON.parse(body.result.content[0].text).complete, true);
      }),
    );
    assert.equal(upstreamCalls, 16);
  } finally {
    pending.forEach((p) => p.resolve("TEST-ONLY"));
    await s.close();
    await f.close();
  }
});
