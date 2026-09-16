import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../src/dashboard.js";
import { Telemetry } from "../src/telemetry.js";

test("typography fonts are pinned, licensed, self-hosted and explicitly served", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-type-"));
  const publicRoot = new URL(import.meta.url.endsWith(".ts") ? "../public/" : "../../public/", import.meta.url);
  const unexpected = new URL("typography-private-test.txt", publicRoot);
  const dashboard = await startDashboard({
    secret: "TEST-TYPOGRAPHY-" + "v".repeat(40),
    telemetry: new Telemetry(join(dir, "events.json")), config: null, mcpUp: false,
  }, 0);
  try {
    const manifest = JSON.parse(readFileSync(new URL("fonts/provenance.json", publicRoot), "utf8"));
    for (const file of ["CormorantGaramond.ttf", "SpaceGrotesk.ttf", "Rubik.ttf", "Rubik-Italic.ttf"]) {
      const response = await fetch(dashboard.url + "/fonts/" + file);
      assert.equal(response.status, 200, file);
      assert.match(response.headers.get("content-type")!, /^font\/ttf/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.match(response.headers.get("content-security-policy")!, /default-src 'self'/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.readUInt32BE(0), 0x00010000, "TrueType signature");
      const entry = manifest.files.find((item: { file: string }) => item.file === file);
      assert.ok(entry, file + " provenance");
      assert.match(entry.source, new RegExp("^https://raw.githubusercontent.com/google/fonts/" + manifest.commit + "/"));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    }
    for (const file of ["OFL.txt", "SpaceGrotesk-OFL.txt", "Rubik-OFL.txt"]) {
      const response = await fetch(dashboard.url + "/fonts/" + file);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /SIL OPEN FONT LICENSE/);
    }
    writeFileSync(unexpected, "TEST ONLY - must not be publicly served");
    for (const path of ["/typography-private-test.txt", "/fonts/missing.ttf", "/src/dashboard.ts"]) {
      assert.equal((await fetch(dashboard.url + path)).status, 404, path);
    }
  } finally {
    await dashboard.close();
    rmSync(unexpected, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
