import { GoogleCalendar, type GoogleOptions } from "./google.js";
import { googleCredentials } from "./google-config.js";
export async function runDiscovery(
  args: string[],
  env: NodeJS.ProcessEnv,
  options: GoogleOptions = {},
): Promise<{ ok: boolean; message: string }> {
  const help =
    "Usage: npm run google:discover -- --discover. Operator-only calendar names/IDs/access roles; no events. Requires three scoped Google credentials. --help makes no network calls.";
  if (args.length === 1 && args[0] === "--help")
    return { ok: true, message: help };
  if (args.length !== 1 || args[0] !== "--discover")
    return { ok: false, message: help };
  try {
    const result = await new GoogleCalendar(
      googleCredentials(env),
      options,
    ).discover();
    return { ok: true, message: JSON.stringify(result) };
  } catch {
    return {
      ok: false,
      message:
        "Google calendar discovery failed or incomplete. No results exported. Check credentials/consent with the operator; no raw diagnostics logged.",
    };
  }
}
