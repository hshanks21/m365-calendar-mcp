import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { config } from "./fixtures.js";
test("production entrypoint refuses to listen without credentials and uses dedicated Azure client secret credential", async () => {
  const m = await import("../src/identity.js").catch(() => ({
    createGraph: undefined,
  }));
  assert.equal(typeof m.createGraph, "function");
  const g = m.createGraph!(config);
  assert.equal(g.base, "https://graph.microsoft.com");
  assert.equal(g.options.testOnly, undefined);
  assert.equal(typeof g.options.token, "function");
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Invalid calendar configuration/);
  assert.ok(!r.stdout.includes("listening"));
});
