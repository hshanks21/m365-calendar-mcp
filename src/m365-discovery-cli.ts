import { createConfidentialToken } from "./m365-confidential.js";
import { discoverMicrosoftCalendars } from "./m365-discovery.js";
const help =
  "Usage: npm run m365:discover -- --list | --help. Operator-only confidential Microsoft discovery; prints id, name, isDefaultCalendar. Does not approve calendars or write policy/cache. See M365_RUNTIME.md.";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(help);
} else {
  const stop = new AbortController();
  const cancel = () => stop.abort();
  try {
    if (args.length !== 1 || args[0] !== "--list") throw Error();
    const keys = [
      "TENANT_ID",
      "CLIENT_ID",
      "ACCOUNT_OBJECT_ID",
      "EXPECTED_USERNAME",
      "CLIENT_SECRET",
      "MSAL_CACHE",
    ].map((k) => "CALENDAR_M365_DELEGATED_" + k);
    if (
      process.env.CALENDAR_M365_MODE !== "delegated-confidential" ||
      Object.keys(process.env).some(
        (k) =>
          k.startsWith("CALENDAR_M365_") &&
          k !== "CALENDAR_M365_MODE" &&
          !keys.includes(k),
      )
    )
      throw Error();
    const token = createConfidentialToken(process.env);
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    const calendars = await discoverMicrosoftCalendars(token, {
      signal: stop.signal,
    });
    console.log(JSON.stringify({ calendars }, null, 2));
  } catch {
    console.error(
      "Microsoft calendar discovery refused. Check dedicated configuration, cached authorization or bounded Graph access privately; no policy/cache was written.",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
