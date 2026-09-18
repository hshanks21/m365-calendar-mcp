import {
  ConfidentialClientApplication,
  type INetworkModule,
  ResponseMode,
} from "@azure/msal-node";
import { randomBytes, createHash } from "node:crypto";
import { loadDelegatedIdentity, DELEGATED_SCOPES } from "./m365-delegated.js";
import {
  microsoftNetwork,
  serializedOfflineCache,
  MicrosoftAuthorizationFailure,
} from "./m365-msal.js";
import {
  verifyDelegatedResult,
  silentToken,
  loadDelegatedConfig,
} from "./m365-delegated.js";
import { Graph } from "./graph.js";
import { runMicrosoftBootstrap } from "./m365-oauth.js";
import { microsoftMsalReason } from "./m365-diagnostics.js";
import type { PrivateRunner } from "./google-oauth.js";
const CODE_HELP =
  "Usage: npm run m365:oauth:code -- --authorize [--timeout-seconds 300]. Fixed Web redirect http://localhost:8766/. Requires owner-verified confidential app secret, consent and temporary scoped Doppler writer. Replaces only CALENDAR_M365_DELEGATED_MSAL_CACHE. See M365_CONFIDENTIAL.md.";
export async function runCodeBootstrap(
  args: string[],
  env: NodeJS.ProcessEnv,
  deps: {
    fetcher?: typeof fetch;
    runner?: PrivateRunner;
    log?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
) {
  if (args.length === 1 && args[0] === "--help")
    return { ok: true, message: CODE_HELP };
  let c: ConfidentialIdentity;
  try {
    c = loadConfidentialIdentity(env);
  } catch {
    return {
      ok: false,
      message:
        "Microsoft delegated bootstrap refused [stage=configuration]. " +
        CODE_HELP,
    };
  }
  return runMicrosoftBootstrap(args, env, {
    ...deps,
    help: CODE_HELP,
    authorize: async (_identity, signal, log) => {
      let stage = "authorization_start";
      let reason = "unclassified";
      let callback: Awaited<ReturnType<typeof startCodeCallback>> | undefined;
      try {
        signal.throwIfAborted();
        const client = createConfidentialClient(
          c,
          confidentialNetwork(c, deps.fetcher, signal, (r) => (reason = r)),
        );
        const session = await createCodeSession(c, client);
        signal.throwIfAborted();
        stage = "callback";
        callback = await startCodeCallback(session.state, signal);
        signal.throwIfAborted();
        log(
          "Open the consent URL in your own browser with the SSH tunnel active. Do not share callback URLs or credentials. Check this terminal for storage status.",
        );
        log(session.url);
        const code = await callback.code;
        signal.throwIfAborted();
        stage = "token_exchange";
        const authorized = await exchangeMicrosoftCode(
          c,
          client,
          session,
          code,
        );
        signal.throwIfAborted();
        return authorized;
      } catch (error) {
        throw new MicrosoftAuthorizationFailure(
          error instanceof MicrosoftAuthorizationFailure ? error.stage : stage,
          reason === "unclassified"
            ? error instanceof MicrosoftAuthorizationFailure
              ? error.reason
              : microsoftMsalReason(error)
            : reason,
        );
      } finally {
        await callback?.close();
      }
    },
  });
}

// No public-client endpoints, redirects, discovery tenants or endpoint overrides.
export function confidentialNetwork(
  c: ConfidentialIdentity,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  diagnose: (reason: string) => void = () => {},
): INetworkModule {
  const base = microsoftNetwork(
    c,
    (url, init) => {
      signal?.throwIfAborted();
      return fetcher(url, {
        ...init,
        signal: signal
          ? AbortSignal.any([signal, init!.signal!])
          : init?.signal,
      });
    },
    diagnose,
  );
  function allowed(url: string, method: string) {
    try {
      const u = new URL(url);
      if (
        u.origin !== "https://login.microsoftonline.com" ||
        u.username ||
        u.password ||
        u.hash ||
        u.pathname !==
          `/${c.tenantId}/${method === "GET" ? "v2.0/.well-known/openid-configuration" : "oauth2/v2.0/token"}` ||
        [...u.searchParams.keys()].some(
          (k) =>
            k !== "client-request-id" ||
            u.searchParams.getAll(k).length !== 1 ||
            !/^[0-9a-f-]{36}$/i.test(u.searchParams.get(k)!),
        )
      )
        throw Error();
    } catch {
      diagnose("endpoint_refused");
      throw Error("Microsoft endpoint refused.");
    }
  }
  return {
    sendGetRequestAsync: (url, options) => {
      allowed(url, "GET");
      return base.sendGetRequestAsync(url, options);
    },
    sendPostRequestAsync: (url, options) => {
      allowed(url, "POST");
      return base.sendPostRequestAsync(url, options);
    },
  };
}
export async function exchangeMicrosoftCode(
  c: ConfidentialIdentity,
  client: ConfidentialClientApplication,
  session: Awaited<ReturnType<typeof createCodeSession>>,
  code: string,
) {
  let stage = "token_exchange";
  try {
    const result = await client.acquireTokenByCode(
      {
        scopes: [...DELEGATED_SCOPES],
        redirectUri: CODE_REDIRECT,
        code,
        codeVerifier: session.verifier,
      },
      { code, nonce: session.nonce },
    );
    stage = "identity_scopes";
    verifyDelegatedResult(c, result);
    if (
      (result?.idTokenClaims as Record<string, unknown>)?.nonce !==
      session.nonce
    )
      throw Error();
    stage = "cache_validation";
    return { result, cache: serializedOfflineCache(client) };
  } catch (error) {
    throw new MicrosoftAuthorizationFailure(stage, microsoftMsalReason(error));
  }
}
// Explicit confidential factory selected only by delegated-confidential runtime mode.
export function createConfidentialReader(env: NodeJS.ProcessEnv) {
  const c = loadDelegatedConfig(env);
  return new Graph({
    token: createConfidentialToken(env),
    delegated: { ...c.calendars.work },
  });
}

// One SDK instance per acquisition binds cancellation to that request, not to
// another caller's concurrent refresh. Only successful cache state survives in
// memory; never write runtime refresh state back to Doppler or disk.
export function createConfidentialToken(
  env: NodeJS.ProcessEnv,
  deps: { fetcher?: typeof fetch; timeoutMs?: number } = {},
) {
  const c = loadConfidentialIdentity(env);
  let cache = env.CALENDAR_M365_DELEGATED_MSAL_CACHE ?? "";
  const initial = createConfidentialClient(c);
  silentToken(c, cache, initial);
  const offline = JSON.parse(serializedOfflineCache(initial));
  const account = Object.values(offline.Account)[0] as Record<string, unknown>;
  if (
    account.realm !== c.tenantId ||
    account.local_account_id !== c.objectId ||
    typeof account.username !== "string" ||
    account.username.toLowerCase() !== c.expectedUsername ||
    account.environment !== "login.microsoftonline.com" ||
    account.home_account_id !== `${c.objectId}.${c.tenantId}`
  )
    throw Error("Invalid dedicated Microsoft delegated cache identity.");
  return async (parent?: AbortSignal) => {
    const signal = parent
      ? AbortSignal.any([parent, AbortSignal.timeout(deps.timeoutMs ?? 15000)])
      : AbortSignal.timeout(deps.timeoutMs ?? 15000);
    try {
      signal.throwIfAborted();
      const client = createConfidentialClient(
        c,
        confidentialNetwork(c, deps.fetcher, signal),
      );
      const token = await silentToken(c, cache, client)(signal);
      signal.throwIfAborted();
      cache = serializedOfflineCache(client);
      return token;
    } catch {
      throw Error("interaction_required");
    }
  };
}

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
export async function startCodeCallback(state: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let consumed = false;
  let settled = false;
  let resolve!: (code: string) => void;
  let reject!: (error: Error) => void;
  const code = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void code.catch(() => {});
  const finish = (value?: string) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", cancel);
    server.close(() =>
      value === undefined
        ? reject(Error("Microsoft callback cancelled, denied or expired."))
        : resolve(value),
    );
    server.closeAllConnections();
  };
  const cancel = () => finish();
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Connection", "close");
    const invalid = () => {
      res.writeHead(400);
      res.end("Invalid callback.");
    };
    if (
      settled ||
      consumed ||
      req.method !== "GET" ||
      req.headers.host !== "localhost:8766" ||
      req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === "host")
        .length !== 1 ||
      !req.url?.startsWith("/?") ||
      req.url.length > 8192 ||
      /%(?![0-9a-f]{2})/i.test(req.url) ||
      req.url.includes("#")
    )
      return invalid();
    const q = new URL(req.url, CODE_REDIRECT).searchParams;
    const allowed = [
      "state",
      "code",
      "session_state",
      "error",
      "error_description",
      "error_uri",
    ];
    const a = Buffer.from(q.get("state") ?? ""),
      b = Buffer.from(state);
    if (
      [...q.keys()].some(
        (k) => !allowed.includes(k) || q.getAll(k).length !== 1,
      ) ||
      a.length !== b.length ||
      !timingSafeEqual(a, b) ||
      q.has("code") === q.has("error") ||
      (q.has("code") &&
        (!/^[\x21-\x7e]{1,4096}$/.test(q.get("code")!) ||
          q.has("error_description") ||
          q.has("error_uri"))) ||
      (q.has("error") && !q.get("error"))
    )
      return invalid();
    consumed = true;
    const value = q.get("code") ?? undefined;
    res.once("finish", () => finish(value));
    res.once("close", () => finish(value));
    res.end(
      "Authorization received. Check the host terminal for secure storage status. Close this tab.",
    );
  });
  server.on("connection", (socket) => {
    const deadline = setTimeout(() => socket.destroy(), 5000);
    socket.once("close", () => clearTimeout(deadline));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.setTimeout(5000, (socket) => socket.destroy());
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(Error("Microsoft callback listener unavailable.")),
    );
    server.listen(8766, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  return {
    address,
    code,
    close: async () => {
      finish();
      await code.catch(() => {});
    },
  };
}

export const CODE_REDIRECT = "http://localhost:8766/";
export function loadConfidentialIdentity(env: NodeJS.ProcessEnv) {
  const identity = loadDelegatedIdentity(env);
  const clientSecret = env.CALENDAR_M365_DELEGATED_CLIENT_SECRET;
  if (
    typeof clientSecret !== "string" ||
    !/^[\x21-\x7e]{1,4096}$/.test(clientSecret)
  )
    throw Error("Invalid dedicated Microsoft confidential configuration.");
  return { ...identity, clientSecret };
}
export type ConfidentialIdentity = ReturnType<typeof loadConfidentialIdentity>;
export function createConfidentialClient(
  c: ConfidentialIdentity,
  networkClient: INetworkModule = confidentialNetwork(c),
) {
  return new ConfidentialClientApplication({
    auth: {
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      authority: c.authority,
      knownAuthorities: ["login.microsoftonline.com"],
    },
    system: {
      networkClient,
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
    },
  });
}
export async function createCodeSession(
  c: ConfidentialIdentity,
  client = createConfidentialClient(c),
) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = await client.getAuthCodeUrl({
    scopes: [...DELEGATED_SCOPES],
    redirectUri: CODE_REDIRECT,
    state,
    nonce,
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    codeChallengeMethod: "S256",
    responseMode: ResponseMode.QUERY,
    loginHint: c.expectedUsername,
    prompt: "select_account",
  });
  return { url, state, nonce, verifier };
}
