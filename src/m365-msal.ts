import {
  PublicClientApplication,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
} from "@azure/msal-node";
import {
  microsoftResponseReason,
  safeMicrosoftReason,
} from "./m365-diagnostics.js";
import { Worker } from "node:worker_threads";
import { DELEGATED_SCOPES, type DelegatedIdentity } from "./m365-delegated.js";
export function serializedOfflineCache(
  pca: Pick<PublicClientApplication, "getTokenCache">,
) {
  const cache = pca.getTokenCache().serialize();
  const data = JSON.parse(cache);
  const refresh = Object.values(data.RefreshToken ?? {}) as {
    secret?: unknown;
  }[];
  if (
    Buffer.byteLength(cache) > 60000 ||
    refresh.length !== 1 ||
    typeof refresh[0].secret !== "string" ||
    !refresh[0].secret ||
    Object.keys(data.Account ?? {}).length !== 1
  )
    throw Error("Microsoft offline cache incomplete.");
  return cache;
}
export async function acquireDevice(
  pca: PublicClientApplication,
  log: (line: string) => void,
) {
  const result = await pca.acquireTokenByDeviceCode({
    scopes: [...DELEGATED_SCOPES],
    timeout: 900,
    deviceCodeCallback: (d) =>
      publicDeviceMessage(d).forEach((line) => log(line)),
  });
  return { result, cache: serializedOfflineCache(pca) };
}
import type { Authorization } from "./m365-oauth.js";
export function microsoftNetwork(
  c: DelegatedIdentity,
  fetcher: typeof fetch = fetch,
  diagnose: (reason: string) => void = () => {},
): INetworkModule {
  async function request<T>(
    url: string,
    method: string,
    options?: NetworkRequestOptions,
  ): Promise<NetworkResponse<T>> {
    let reason = "endpoint_refused";
    diagnose("unclassified");
    try {
      const u = new URL(url);
      const paths =
        method === "GET"
          ? [`/${c.tenantId}/v2.0/.well-known/openid-configuration`]
          : [
              `/${c.tenantId}/oauth2/v2.0/devicecode`,
              `/${c.tenantId}/oauth2/v2.0/token`,
            ];
      if (
        u.origin !== "https://login.microsoftonline.com" ||
        u.username ||
        u.password ||
        u.hash ||
        !paths.includes(u.pathname)
      )
        throw Error("Microsoft endpoint refused.");
      reason = "transport_failure";
      const response = await fetcher(u.href, {
        method,
        headers: options?.headers,
        body: method === "POST" ? options?.body : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      reason = "response_empty";
      if (!response.body) throw Error("Microsoft response refused.");
      let size = 0;
      const chunks: Uint8Array[] = [];
      reason = "transport_failure";
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 262144) {
          reason = "response_limit";
          throw Error("Microsoft response limit.");
        }
        chunks.push(chunk);
      }
      reason = "response_json";
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      diagnose(microsoftResponseReason(body));
      return {
        headers: Object.fromEntries(response.headers),
        status: response.status,
        body: body as T,
      };
    } catch (error) {
      diagnose(
        reason === "transport_failure" &&
          error instanceof DOMException &&
          error.name === "TimeoutError"
          ? "transport_timeout"
          : reason,
      );
      throw Error("Microsoft network request failed.");
    }
  }
  return {
    sendGetRequestAsync: <T>(url: string, options?: NetworkRequestOptions) =>
      request<T>(url, "GET", options),
    sendPostRequestAsync: <T>(url: string, options?: NetworkRequestOptions) =>
      request<T>(url, "POST", options),
  };
}
export function createMicrosoftClient(
  c: DelegatedIdentity,
  networkClient: INetworkModule = microsoftNetwork(c),
) {
  return new PublicClientApplication({
    auth: {
      clientId: c.clientId,
      authority: c.authority,
      knownAuthorities: ["login.microsoftonline.com"],
    },
    system: {
      networkClient,
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
    },
  });
}
export function publicDeviceMessage(d: {
  verificationUri: string;
  userCode: string;
}) {
  if (
    ![
      "https://microsoft.com/devicelogin",
      "https://www.microsoft.com/devicelogin",
      "https://login.microsoft.com/device",
    ].includes(d.verificationUri) ||
    !/^[A-Z0-9-]{6,20}$/.test(d.userCode)
  )
    throw Error("Unexpected Microsoft device response.");
  return [d.verificationUri, d.userCode];
}
// Only local fixed stage names cross the worker boundary, never provider errors.
export class MicrosoftAuthorizationFailure extends Error {
  readonly stage: string;
  readonly reason: string;
  constructor(stage: unknown, reason?: unknown) {
    super("Microsoft authorization failed.");
    this.reason = safeMicrosoftReason(reason);
    this.stage =
      typeof stage === "string" &&
      [
        "authorization_start",
        "callback",
        "device_start",
        "device_display",
        "token_exchange",
        "identity_scopes",
        "cache_validation",
      ].includes(stage)
        ? stage
        : "authorization";
  }
}
// Worker has no inherited credentials, no stdout/stderr relay, no storage or listeners.
// Termination actually stops MSAL polling/network work rather than racing a promise.
export async function authorizeInWorker(
  c: DelegatedIdentity,
  signal: AbortSignal,
  log: (line: string) => void,
  testWorkerUrl?: URL,
): ReturnType<Authorization> {
  signal.throwIfAborted();
  const worker = new Worker(
    testWorkerUrl ?? new URL("./m365-device-worker.js", import.meta.url),
    { workerData: c, env: {}, execArgv: [], stdout: true, stderr: true },
  );
  worker.stdout.resume();
  worker.stderr.resume();
  let cancel: () => void = () => {};
  try {
    return await new Promise<Awaited<ReturnType<Authorization>>>(
      (resolve, reject) => {
        cancel = () => reject(Error("Microsoft authorization cancelled."));
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        worker.once("error", () =>
          reject(Error("Microsoft authorization failed.")),
        );
        worker.once("exit", () =>
          reject(Error("Microsoft authorization ended.")),
        );
        worker.on("message", (message) => {
          try {
            if (message.kind === "device")
              publicDeviceMessage(message).forEach((line) => log(line));
            else if (message.kind === "result") resolve(message.value);
            else
              reject(
                new MicrosoftAuthorizationFailure(
                  message.kind === "error" ? message.stage : undefined,
                  message.kind === "error" ? message.reason : undefined,
                ),
              );
          } catch {
            reject(new MicrosoftAuthorizationFailure("device_display"));
          }
        });
      },
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    await worker.terminate();
  }
}
