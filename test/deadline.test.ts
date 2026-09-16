import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/graph.js";
import { range } from "./fixtures.js";
test("token acquisition has a hard deadline even if credential ignores cancellation", async () => {
  const g = new Graph({ token: () => new Promise(() => {}), timeoutMs: 25 });
  let timer: ReturnType<typeof setTimeout>;
  const r = await Promise.race([
    g.view({ mailbox: "fake@example.invalid", calendarId: "fake-id" }, range),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), 200);
    }),
  ]);
  clearTimeout(timer!);
  assert.notEqual(r, undefined);
  assert.equal(r?.complete, false);
  assert.equal(r?.error, "timeout");
});
