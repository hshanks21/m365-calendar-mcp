import { startApplication } from "./runtime.js";
try {
  const service = await startApplication();
  console.log(
    `Calendar dashboard listening at ${service.dashboard.url}; ${service.mcp ? "MCP listening at " + service.mcp.url + "; providers configured but unverified" : "Calendar providers not configured; MCP disabled"}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void service.close().then(() => process.exit(0));
    });
} catch {
  console.error(
    "Invalid calendar configuration, dashboard credential or unavailable loopback listener; startup refused",
  );
  process.exitCode = 1;
}
