import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repository = "hshanks21/m365-calendar-mcp";
const image = `ghcr.io/${repository}`;
const fullMatch = (pattern, value) =>
  typeof value === "string" && pattern.test(value) && !value.includes("\n");

export function validateRelease(env, packageVersion) {
  if (
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_REF_TYPE !== "tag" ||
    env.GITHUB_REPOSITORY !== repository
  ) {
    throw new Error("Only pushed tags in the source repository may publish");
  }
  const version = env.GITHUB_REF_NAME;
  if (
    !fullMatch(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, version) ||
    version !== `v${packageVersion}`
  ) {
    throw new Error("Strict vMAJOR.MINOR.PATCH tag must match package.json");
  }
  if (!fullMatch(/^[0-9a-f]{40}$/, env.GITHUB_SHA))
    throw new Error("Expected full commit SHA");
  return { version, shaTag: `sha-${env.GITHUB_SHA}`, image };
}

export async function registryToken(env, request = fetch) {
  if (!env.GITHUB_ACTOR || !env.GHCR_TOKEN)
    throw new Error("Missing registry credentials");
  const url = new URL("https://ghcr.io/token");
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${repository}:pull,push`);
  const response = await request(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.GITHUB_ACTOR}:${env.GHCR_TOKEN}`).toString("base64")}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Registry authentication failed (${response.status})`);
  const { token } = await response.json();
  if (typeof token !== "string" || !token)
    throw new Error("Registry supplied no token");
  return token;
}

export async function checkManifest(
  tag,
  token,
  expectedDigest = null,
  request = fetch,
) {
  const response = await request(
    `https://ghcr.io/v2/${repository}/manifests/${encodeURIComponent(tag)}`,
    {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json",
      },
    },
  );
  if (expectedDigest === null) {
    if (response.status !== 404)
      throw new Error(
        `Refusing tag reuse or uncertain registry state: ${tag} (${response.status})`,
      );
  } else if (
    response.status !== 200 ||
    response.headers.get("docker-content-digest") !== expectedDigest
  ) {
    throw new Error(
      `Published digest readback failed: ${tag} (${response.status})`,
    );
  }
}

async function main() {
  const release = validateRelease(
    process.env,
    JSON.parse(readFileSync("package.json", "utf8")).version,
  );
  const command = process.argv[2];
  if (command === "validate") {
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version=${release.version}\nsha-tag=${release.shaTag}\nimage=${release.image}\n`,
      );
    }
    console.log(`Validated ${release.version} (${release.shaTag})`);
    return;
  }
  if (!["assert-new", "verify"].includes(command))
    throw new Error("Unknown release guard command");
  const digest = command === "verify" ? process.env.IMAGE_DIGEST : null;
  if (command === "verify" && !fullMatch(/^sha256:[0-9a-f]{64}$/, digest))
    throw new Error("Missing valid image digest");
  const token = await registryToken(process.env);
  for (const tag of [release.version, release.shaTag])
    await checkManifest(tag, token, digest);
  console.log(
    command === "verify"
      ? `Verified ${image}@${digest}`
      : "Both immutable tag names are unused",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    // Do not emit arbitrary fetch/registry errors or credential-bearing response bodies.
    console.error(
      "Release guard failed; check tag/version, registry access and digest. No overwrite is permitted.",
    );
    process.exitCode = 1;
  });
}
