import assert from "node:assert/strict";
import test from "node:test";
import {
  validateRelease,
  checkManifest,
  registryToken,
} from "./release-guard.mjs";

const env = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF_TYPE: "tag",
  GITHUB_REF_NAME: "v0.1.0",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_REPOSITORY: "hshanks21/m365-calendar-mcp",
};

test("strict pushed release tag, version, repository and full commit identity", () => {
  assert.equal(validateRelease(env, "0.1.0").version, "v0.1.0");
  for (const tag of [
    "v01.1.0",
    "v0.01.0",
    "v0.1.00",
    "v0.1",
    "v0.1.0-rc.1",
    "v0.1.0+build",
    "v0.1.0\n",
    "v0.1.0/extra",
    "v1.2.3;id",
  ]) {
    assert.throws(() =>
      validateRelease({ ...env, GITHUB_REF_NAME: tag }, "0.1.0"),
    );
  }
  assert.throws(() => validateRelease(env, "0.2.0"));
  for (const overrides of [
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { GITHUB_REF_TYPE: "branch" },
    { GITHUB_SHA: "abc1234" },
    { GITHUB_SHA: "a".repeat(40) + "\r" },
    { GITHUB_SHA: "a".repeat(40) + "\u2028" },
    { GITHUB_REPOSITORY: "other/repo" },
  ]) {
    assert.throws(() => validateRelease({ ...env, ...overrides }, "0.1.0"));
  }
});

test("new tags require an explicit 404; auth, rate-limit and server errors fail closed", async () => {
  for (const status of [200, 401, 403, 429, 500]) {
    await assert.rejects(
      checkManifest(
        "v0.1.0",
        "fixture",
        null,
        async () => new Response(null, { status }),
      ),
    );
  }
  await checkManifest(
    "v0.1.0",
    "fixture",
    null,
    async () => new Response(null, { status: 404 }),
  );
  await assert.rejects(
    checkManifest("v0.1.0", "fixture", null, async () => {
      throw new Error("offline");
    }),
  );
});

test("readback must match the exact published index digest", async () => {
  const digest = `sha256:${"b".repeat(64)}`;
  await checkManifest(
    "v0.1.0",
    "fixture",
    digest,
    async () =>
      new Response(null, {
        status: 200,
        headers: { "docker-content-digest": digest },
      }),
  );
  for (const status of [404, 401, 500]) {
    await assert.rejects(
      checkManifest(
        "v0.1.0",
        "fixture",
        digest,
        async () => new Response(null, { status }),
      ),
    );
  }
  await assert.rejects(
    checkManifest(
      "v0.1.0",
      "fixture",
      digest,
      async () =>
        new Response(null, {
          status: 200,
          headers: { "docker-content-digest": "sha256:wrong" },
        }),
    ),
  );
});

test("registry token exchange is scoped, bounded and fails without a token", async () => {
  const credentials = {
    GITHUB_ACTOR: "fixture",
    GHCR_TOKEN: "synthetic-not-a-secret",
  };
  assert.equal(
    await registryToken(credentials, async (url, options) => {
      assert.equal(new URL(url).origin, "https://ghcr.io");
      assert.equal(
        new URL(url).searchParams.get("scope"),
        "repository:hshanks21/m365-calendar-mcp:pull,push",
      );
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return Response.json({ token: "synthetic-registry-token" });
    }),
    "synthetic-registry-token",
  );
  await assert.rejects(
    registryToken({}, async () => {
      throw new Error("must not fetch");
    }),
  );
  await assert.rejects(
    registryToken(credentials, async () => Response.json({}, { status: 200 })),
  );
  await assert.rejects(
    registryToken(credentials, async () => Response.json({}, { status: 403 })),
  );
});
