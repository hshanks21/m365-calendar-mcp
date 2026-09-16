import { selectMicrosoftProvider } from "./m365-runtime.js";
import { loadGoogleConfig } from "./google-config.js";
import { GoogleCalendar } from "./google.js";
import { combinePolicies, routeProviders } from "./providers.js";

import { startServer } from "./server.js";
import { validateDashboardTransport } from "./dashboard-transport.js";
import { startDashboard } from "./dashboard.js";
import { Telemetry } from "./telemetry.js";
import { resolve } from "node:path";
export async function startApplication(
  env: NodeJS.ProcessEnv = process.env,
  ports = { dashboard: 3218, mcp: 3217 },
) {
  const transport = {
    bindAddress: env.CALENDAR_DASHBOARD_BIND_ADDRESS,
    certFile: env.CALENDAR_DASHBOARD_TLS_CERT_FILE,
    keyFile: env.CALENDAR_DASHBOARD_TLS_KEY_FILE,
  };
  // Fail closed before even MCP listens; no HTTP downgrade on TLS failure.
  validateDashboardTransport(transport);
  const secret = env.CALENDAR_DASHBOARD_SECRET;
  if (!secret || secret.length < 32 || secret.length > 256)
    throw Error("Independent dashboard credential required");
  const microsoft = selectMicrosoftProvider(env);
  const m365 = microsoft?.config ?? null;
  const googleKeys = [
    "CALENDAR_GOOGLE_CLIENT_ID",
    "CALENDAR_GOOGLE_CLIENT_SECRET",
    "CALENDAR_GOOGLE_REFRESH_TOKEN",
    "CALENDAR_GOOGLE_POLICY_JSON",
    "CALENDAR_GOOGLE_CREATE_ENABLED",
  ];
  const google = googleKeys.some((k) => env[k] !== undefined)
    ? loadGoogleConfig(env)
    : null;
  const config = combinePolicies(m365, google);
  if (
    google &&
    (google.clientSecret === secret || google.refreshToken === secret)
  )
    throw Error("Independent dashboard credential required");
  if (
    config &&
    (config.clientSecret === secret ||
      config.clients.some((c) => c.secret === secret))
  )
    throw Error("Independent dashboard credential required");
  const telemetry = new Telemetry(
    resolve(env.CALENDAR_TELEMETRY_FILE ?? "var/telemetry.json"),
  );
  const mcp = config
    ? await startServer(
        config,
        routeProviders(
          microsoft?.reader ?? null,
          google ? new GoogleCalendar(google) : null,
        ),
        ports.mcp,
        telemetry,
      )
    : null;
  try {
    const dashboard = await startDashboard(
      { secret, telemetry, config, mcpUp: !!mcp, transport },
      ports.dashboard,
    );
    return {
      mcp,
      dashboard,
      close: async () => {
        await dashboard.close();
        await mcp?.close();
      },
    };
  } catch (e) {
    await mcp?.close();
    throw e;
  }
}
