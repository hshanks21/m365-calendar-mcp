import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { SUPABASE_ORIGIN, SUPABASE_REDIRECT } from "./supabase-bootstrap.js";
// Reuses the reviewed confidential callback's raw-header checks, one-use finish,
// hard socket lifetime and close-all cleanup. Correlation differs intentionally:
// GoTrue owns OAuth state and an exact redirect allowlist cannot take ?state=.
// A one-use local start URL sets only an HttpOnly correlation cookie, not a login
// session. The returned code is additionally bound to this process by PKCE.
export async function startSupabaseCallback(
  authorizeUrl: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const authorize = new URL(authorizeUrl);
  if (
    authorize.origin !== SUPABASE_ORIGIN ||
    authorize.pathname !== "/auth/v1/authorize" ||
    authorize.username ||
    authorize.password ||
    authorize.hash
  )
    throw Error("Supabase authorization URL refused.");
  const state = randomBytes(32).toString("base64url");
  const cookieName = "calendar_bootstrap_state";
  const cookie = (value: string, age: number) =>
    `${cookieName}=${value}; Path=/supabase/callback; HttpOnly; SameSite=Lax; Max-Age=${age}`;
  const matches = (value: string) => {
    const a = Buffer.from(value),
      b = Buffer.from(state);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  let started = false,
    consumed = false,
    settled = false;
  let resolve!: (code: string) => void, reject!: (error: Error) => void;
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
        ? reject(Error("Supabase callback cancelled, denied or expired."))
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
      req.headers.origin ||
      req.headers["transfer-encoding"] ||
      (req.headers["content-length"] !== undefined &&
        req.headers["content-length"] !== "0") ||
      !req.url ||
      req.url.length > 8192 ||
      /%(?![0-9a-f]{2})/i.test(req.url) ||
      req.url.includes("#")
    )
      return invalid();
    if (
      !req.url.startsWith("/supabase/start?") &&
      !req.url.startsWith("/supabase/callback?")
    )
      return invalid();
    const q = new URL(req.url, SUPABASE_REDIRECT).searchParams;
    if ([...q.keys()].some((k) => q.getAll(k).length !== 1)) return invalid();
    if (req.url.startsWith("/supabase/start?")) {
      if (
        started ||
        [...q.keys()].some((k) => k !== "state") ||
        !matches(q.get("state") ?? "")
      )
        return invalid();
      started = true;
      res.setHeader("Set-Cookie", cookie(state, 900));
      res.setHeader("Location", authorizeUrl);
      res.writeHead(302);
      res.end("Continue authorization in this browser.");
      return;
    }
    const rawCookies = req.rawHeaders.filter(
      (v, i) => i % 2 === 0 && v.toLowerCase() === "cookie",
    );
    const cookies = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.split("=")[0] === cookieName);
    if (
      !started ||
      rawCookies.length !== 1 ||
      cookies.length !== 1 ||
      !matches(cookies[0].slice(cookieName.length + 1)) ||
      [...q.keys()].some(
        (k) =>
          !["code", "error", "error_code", "error_description"].includes(k),
      ) ||
      q.has("code") === q.has("error") ||
      (q.has("code") &&
        (!/^[\x21-\x7e]{1,4096}$/.test(q.get("code")!) ||
          q.has("error_description") ||
          q.has("error_code"))) ||
      (q.has("error") && !q.get("error"))
    )
      return invalid();
    consumed = true;
    const value = q.get("code") ?? undefined;
    res.setHeader("Set-Cookie", cookie("", 0));
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
      reject(Error("Supabase callback listener unavailable.")),
    );
    server.listen(8766, "127.0.0.1", resolve);
  });
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  return {
    url: `http://localhost:8766/supabase/start?state=${state}`,
    code,
    close: async () => {
      finish();
      await code.catch(() => {});
    },
  };
}
