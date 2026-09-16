import { timingSafeEqual } from "node:crypto";
import {
  authorizeInWorker,
  MicrosoftAuthorizationFailure,
} from "./m365-msal.js";
import type { AuthenticationResult } from "@azure/msal-node";
import {
  loadDelegatedIdentity,
  verifyDelegatedResult,
  type DelegatedIdentity,
} from "./m365-delegated.js";
import {
  DOPPLER_FLAGS,
  IMPLEMENTATION_CWD,
  runPrivate,
  type PrivateRunner,
} from "./google-oauth.js";
export type Authorization = (
  identity: DelegatedIdentity,
  signal: AbortSignal,
  log: (line: string) => void,
) => Promise<{ result: AuthenticationResult | null; cache: string }>;
export async function runMicrosoftBootstrap(
  args: string[],
  env: NodeJS.ProcessEnv,
  deps: {
    authorize?: Authorization;
    runner?: PrivateRunner;
    log?: (line: string) => void;
    signal?: AbortSignal;
    help?: string;
  } = {},
) {
  const help =
    deps.help ??
    "Usage: npm run m365:oauth -- --authorize [--timeout-seconds 300]. Requires owner-verified public-client/delegated consent setup and temporary scoped Doppler write access. Replaces only CALENDAR_M365_DELEGATED_MSAL_CACHE. No permission bypass; see M365_DELEGATED.md.";
  if (args.length === 1 && args[0] === "--help")
    return { ok: true, message: help };
  let stage = "configuration";
  let timedOut = false;
  const stop = new AbortController();
  const cancel = () => stop.abort();
  let timer: NodeJS.Timeout | undefined;
  try {
    if (
      process.cwd() !== IMPLEMENTATION_CWD ||
      args[0] !== "--authorize" ||
      !(
        args.length === 1 ||
        (args.length === 3 &&
          args[1] === "--timeout-seconds" &&
          /^\d+$/.test(args[2]))
      )
    )
      throw Error();
    const seconds = Number(args[2] ?? 300);
    if (seconds < 30 || seconds > 900) throw Error();
    const identity = loadDelegatedIdentity(env);
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    deps.signal?.addEventListener("abort", cancel, { once: true });
    if (deps.signal?.aborted) cancel();
    timer = setTimeout(() => {
      if (!stop.signal.aborted) {
        timedOut = true;
        cancel();
      }
    }, seconds * 1000);
    stage = "authorization";
    stop.signal.throwIfAborted();
    const authorized = await (deps.authorize ?? authorizeInWorker)(
      identity,
      stop.signal,
      deps.log ?? console.log,
    );
    stop.signal.throwIfAborted();
    stage = "identity_scopes";
    verifyDelegatedResult(identity, authorized.result);
    stage = "cache_validation";
    const cache = authorized.cache;
    if (!cache || Buffer.byteLength(cache) > 60000) throw Error();
    clearTimeout(timer);
    const runner =
      deps.runner ??
      ((args, input) => runPrivate(args, input, { signal: stop.signal }));
    try {
      await runner(
        [
          "secrets",
          "set",
          "CALENDAR_M365_DELEGATED_MSAL_CACHE",
          "--no-interactive",
          ...DOPPLER_FLAGS,
        ],
        cache,
      );
    } catch {
      return {
        ok: false,
        message:
          "Doppler write failed or uncertain [stage=doppler_write]. Temporary scoped write access required; no credentials exported.",
      };
    }
    try {
      const actual = (
        await runner([
          "secrets",
          "get",
          "CALENDAR_M365_DELEGATED_MSAL_CACHE",
          "--plain",
          "--raw",
          ...DOPPLER_FLAGS,
        ])
      ).replace(/\r?\n$/, "");
      const a = Buffer.from(actual),
        b = Buffer.from(cache);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw Error();
    } catch {
      return {
        ok: false,
        message:
          "Doppler cache write is unverified [stage=doppler_readback]; remote value may have changed. No success claimed.",
      };
    }
    return {
      ok: true,
      message:
        "Microsoft delegated cache securely stored and read-back verified. Runtime integration and approved calendar configuration remain gated.",
    };
  } catch (error) {
    stage = stop.signal.aborted
      ? timedOut
        ? "timeout"
        : "cancelled"
      : error instanceof MicrosoftAuthorizationFailure
        ? error.stage
        : stage;
    return {
      ok: false,
      message: `Microsoft delegated bootstrap refused [stage=${stage}]${error instanceof MicrosoftAuthorizationFailure && !stop.signal.aborted ? ` [reason=${error.reason}]` : ""}. No permission bypass or raw diagnostics. ${help}`,
    };
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    deps.signal?.removeEventListener("abort", cancel);
  }
}
