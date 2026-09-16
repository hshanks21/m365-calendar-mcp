import express from "express";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import {
  validateDashboardTransport,
  type DashboardTransport,
} from "./dashboard-transport.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ServiceConfig as Config } from "./providers.js";
import type { Telemetry } from "./telemetry.js";
export type DashboardOptions = {
  secret: string;
  telemetry: Telemetry;
  config: Config | null;
  mcpUp: boolean;
  testOnly?: boolean;
  transport?: DashboardTransport;
};
const hash = (s: string) => createHash("sha256").update(s).digest();
export async function startDashboard(options: DashboardOptions, port = 3218) {
  const { secret, telemetry, config } = options;
  const { bindAddress, tls } = validateDashboardTransport(options.transport);
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.length > 256 ||
    config?.clients.some((c) => c.secret === secret) ||
    config?.clientSecret === secret
  )
    throw Error("Invalid independent dashboard credential");
  const app = express();
  app.disable("x-powered-by");
  const sessions = new Map<string, number>();
  let attempts = 0,
    attemptWindow = Date.now();
  let origin = "";
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin !== undefined && req.headers.origin !== origin) ||
      (req.headers["sec-fetch-site"] &&
        !["same-origin", "none"].includes(
          String(req.headers["sec-fetch-site"]),
        ))
    ) {
      res.status(403).end();
      return;
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin !== origin
    ) {
      res.status(403).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1kb" }));
  app.post("/login", (req, res) => {
    const now = Date.now();
    if (now - attemptWindow > 60000) {
      attemptWindow = now;
      attempts = 0;
    }
    if (++attempts > 10) {
      res.set("Retry-After", "60").status(429).end();
      return;
    }
    if (
      typeof req.body?.token !== "string" ||
      !timingSafeEqual(hash(req.body.token), hash(secret))
    ) {
      res.status(401).end();
      return;
    }
    for (const [key, expiry] of sessions)
      if (expiry <= now) sessions.delete(key);
    if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    sessions.set(hash(token).toString("hex"), now + 3600000);
    // HTTP is deliberately loopback-only. Secure cookies require an HTTPS origin;
    // SameSite/Origin/Host checks and HttpOnly are mandatory on this local transport.
    res.cookie("calendar_viewer", token, {
      secure: !!tls,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 3600000,
    });
    res.status(204).end();
  });
  const authenticate: express.RequestHandler = (req, res, next) => {
    const token =
      (req.headers.cookie ?? "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("calendar_viewer="))
        ?.slice(16) ?? "";
    const key = hash(token).toString("hex");
    if ((sessions.get(key) ?? 0) <= Date.now()) {
      sessions.delete(key);
      res.status(401).end();
      return;
    }
    res.locals.sessionKey = key;
    next();
  };
  app.post("/logout", authenticate, (_req, res) => {
    sessions.delete(res.locals.sessionKey);
    res.clearCookie("calendar_viewer", {
      secure: !!tls,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.status(204).end();
  });
  app.get("/api/diagnostics", authenticate, (req, res) => {
    try {
      if (
        Object.keys(req.query).some(
          (k) => !["period", "offset", "limit"].includes(k),
        )
      )
        throw Error();
      const integer = (v: unknown, fallback: number) => {
        if (v === undefined) return fallback;
        if (typeof v !== "string" || !/^\d{1,4}$/.test(v)) throw Error();
        return Number(v);
      };
      const metrics = telemetry.snapshot(
        (req.query.period ?? "today") as any,
        integer(req.query.offset, 0),
        integer(req.query.limit, 25),
      );
      res.json({
        health: {
          service: "up",
          mcp: options.mcpUp ? "up" : "not_configured",
          google:
            config &&
            Object.values(config.calendars).some(
              (m) => "provider" in m && m.provider === "google",
            )
              ? metrics.lastGoogleSuccess
                ? "previous_read_succeeded"
                : "unverified"
              : "not_configured",
          graph:
            !config ||
            !Object.values(config.calendars).some((m) => "mailbox" in m)
              ? "not_configured"
              : metrics.lastGraphSuccess
                ? "previous_read_succeeded"
                : "unverified",
          mode: options.testOnly ? "test-fixture" : "local",
          liveVerified: false,
        },
        access: {
          readOnly: true,
          calendarCount: config ? Object.keys(config.calendars).length : 0,
          callers:
            config?.clients.map((c, i) => ({
              caller: i + 1,
              label: `Agent ${i + 1}`,
              calendarCount: c.calendarKeys.length,
            })) ?? [],
        },
        metrics,
      });
    } catch {
      res.status(400).json({ error: "invalid_filter" });
    }
  });
  app.all("/api/diagnostics", authenticate, (_req, res) => {
    res.status(405).end();
  });
  const sourceAssets = new URL("../public/", import.meta.url);
  const publicRoot = fileURLToPath(
    existsSync(sourceAssets)
      ? sourceAssets
      : new URL("../../public/", import.meta.url),
  );
  // Exact public asset allowlist; never expose arbitrary files added to public/.
  const assets: Record<string, string> = {
    "/": "index.html",
    "/index.html": "index.html",
    "/app.css": "app.css",
    "/app.js": "app.js",
    "/fonts/CormorantGaramond.ttf": "fonts/CormorantGaramond.ttf",
    "/fonts/SpaceGrotesk.ttf": "fonts/SpaceGrotesk.ttf",
    "/fonts/Rubik.ttf": "fonts/Rubik.ttf",
    "/fonts/Rubik-Italic.ttf": "fonts/Rubik-Italic.ttf",
    "/fonts/OFL.txt": "fonts/OFL.txt",
    "/fonts/SpaceGrotesk-OFL.txt": "fonts/SpaceGrotesk-OFL.txt",
    "/fonts/Rubik-OFL.txt": "fonts/Rubik-OFL.txt",
    "/fonts/provenance.json": "fonts/provenance.json",
  };
  app.use((req, res, next) => {
    const asset = Object.hasOwn(assets, req.path) ? assets[req.path] : undefined;
    if (!asset || (req.method !== "GET" && req.method !== "HEAD")) return next();
    res.sendFile(asset, { root: publicRoot, dotfiles: "deny", etag: false, maxAge: 0 });
  });
  app.use(
    (
      _err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: "invalid_request" });
    },
  );
  const listener = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const s = tls ? createHttpsServer(tls, app) : createHttpServer(app);
      s.listen(port, bindAddress, () => resolve(s));
      s.once("error", reject);
    },
  );
  origin = `${tls ? "https" : "http"}://${bindAddress}:${(listener.address() as any).port}`;
  listener.requestTimeout = 10000;
  listener.headersTimeout = 5000;
  return {
    url: origin,
    close: () =>
      new Promise<void>((resolve) => {
        listener.closeAllConnections();
        listener.close(() => resolve());
      }),
  };
}
