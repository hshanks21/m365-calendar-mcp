import express from "express";
import { Telemetry, operations as telemetryOperations } from "./telemetry.js";
import { availability } from "./availability.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { ServiceConfig as Config, CalendarReader } from "./providers.js";
const date = z.string().datetime({ offset: true });
export const windowSchema = z
  .object({
    calendarKey: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    start: date,
    end: date,
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.end) > Date.parse(v.start) &&
      Date.parse(v.end) - Date.parse(v.start) <= 31 * 86400000,
    "Range must be positive and at most 31 days",
  );
const searchSchema = windowSchema.safeExtend({
  query: z.string().trim().min(1).max(100),
});
const empty = z.object({}).strict();
const names = [
  "list_calendars",
  "list_events",
  "search_events",
  "get_work_availability",
  "connection_status",
] as const;
export async function startServer(
  config: Config,
  graph: CalendarReader,
  port = 3217,
  telemetry?: Telemetry,
) {
  const app = express();
  app.disable("x-powered-by");
  let active = 0;
  // Unlike HTTP slots, these remain held while detached upstream work settles.
  let operations = 0;
  app.use((req, res, next) => {
    const authStarted = performance.now();
    res.setHeader("Cache-Control", "no-store");
    const host = req.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$/.test(host) && !/^localhost:\d+$/.test(host)) {
      res.status(403).end();
      return;
    }
    // This service is for native MCP clients only; every browser Origin is denied.
    if (req.headers.origin !== undefined) {
      res.status(403).end();
      return;
    }
    const hash = (s: string) => createHash("sha256").update(s).digest();
    const supplied = hash(req.headers.authorization ?? "");
    const client = config.clients.find((c) =>
      timingSafeEqual(supplied, hash("Bearer " + c.secret)),
    );
    if (!client) {
      telemetry?.record({
        caller: 0,
        operation: "authentication",
        outcome: "denied",
        durationMs: performance.now() - authStarted,
      });
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).end();
      return;
    }
    res.locals.client = client;
    if (active >= 16) {
      res.status(503).end();
      return;
    }
    active++;
    res.once("close", () => active--);
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.post("/mcp", async (req, res) => {
    const started = performance.now();
    let outcome: "success" | "denied" | "error" = "error";
    let graphSuccess = false;
    let googleSuccess = false;
    let recorded = false;
    const record = () => {
      if (recorded || req.body?.method !== "tools/call") return;
      recorded = true;
      const requested = req.body?.params?.name;
      telemetry?.record({
        caller: config.clients.indexOf(res.locals.client) + 1,
        operation: telemetryOperations.includes(requested)
          ? requested
          : "protocol",
        outcome,
        durationMs: performance.now() - started,
        graphSuccess,
        googleSuccess,
      });
    };
    res.once("finish", record);
    res.once("close", record);
    const disconnected = new AbortController();
    res.once("close", () => disconnected.abort());
    const client = res.locals.client as Config["clients"][number];
    const server = new McpServer({
      name: "scoped-calendar",
      version: "0.1.2",
    });
    for (const name of names) {
      const inputSchema =
        name === "list_calendars" || name === "connection_status"
          ? empty
          : name === "search_events"
            ? searchSchema
            : windowSchema;
      server.registerTool(
        name,
        {
          description:
            name === "get_work_availability"
              ? "Free intervals within the explicitly supplied work window; not mailbox working-hours settings"
              : name,
          inputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        async (args, extra) => {
          try {
            let result: unknown;
            if (name === "list_calendars")
              result = {
                calendars: client.calendarKeys.map((calendarKey) => ({
                  calendarKey,
                })),
              };
            else if (name === "connection_status")
              result = {
                configured: true,
                liveVerified: false,
                mode: graph.options.testOnly
                  ? "test-fixture"
                  : (graph.mode ?? "m365-app-only"),
                createEnabled: false,
                allowedCalendarCount: client.calendarKeys.length,
              };
            else {
              const a =
                name === "search_events"
                  ? searchSchema.parse(args)
                  : windowSchema.parse(args);
              if (
                !client.calendarKeys.includes(a.calendarKey) ||
                !Object.hasOwn(config.calendars, a.calendarKey)
              )
                throw Error("calendar_denied");
              if (operations >= 16) throw Error("server_busy");
              const signal = AbortSignal.any([
                disconnected.signal,
                extra.signal,
              ]);
              signal.throwIfAborted();
              operations++;
              const view = await graph.view(
                config.calendars[a.calendarKey],
                a,
                {
                  signal,
                  onSettled: () => operations--,
                },
              );
              const mapping = config.calendars[a.calendarKey];
              const isGoogle =
                "provider" in mapping && mapping.provider === "google";
              graphSuccess = view.complete && !isGoogle;
              googleSuccess = view.complete && isGoogle;
              if (name === "search_events")
                result = view.complete
                  ? {
                      complete: true,
                      events: view.events.filter(
                        (e) =>
                          !e.private &&
                          e.subject
                            .toLowerCase()
                            .includes(
                              searchSchema.parse(args).query.toLowerCase(),
                            ),
                      ),
                    }
                  : { complete: false, events: [], error: view.error };
              else if (name === "list_events") result = view;
              else result = availability(view, a);
            }
            outcome =
              (result as { complete?: boolean }).complete === false
                ? "error"
                : "success";
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          } catch (e) {
            outcome =
              e instanceof Error && e.message === "calendar_denied"
                ? "denied"
                : "error";
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error:
                      e instanceof Error &&
                      ["calendar_denied", "server_busy"].includes(e.message)
                        ? e.message
                        : "invalid_request",
                  }),
                },
              ],
            };
          }
        },
      );
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.once("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "request_failed" });
    }
  });
  app.all("/mcp", (_req, res) => {
    res.status(405).end();
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
      const s = app.listen(port, "127.0.0.1", () => resolve(s));
      s.once("error", reject);
    },
  );
  listener.requestTimeout = 20000;
  listener.headersTimeout = 10000;
  return {
    url: `http://127.0.0.1:${(listener.address() as any).port}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        listener.closeAllConnections();
        listener.close(() => resolve());
      }),
  };
}
