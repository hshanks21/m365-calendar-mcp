import { loadConfig } from "./config.js";
import { createGraph } from "./identity.js";
import { loadDelegatedConfig } from "./m365-delegated.js";
import {
  createConfidentialReader,
  loadConfidentialIdentity,
} from "./m365-confidential.js";

// Explicit selection; never infer public-client vs confidential from a cache.
export function selectMicrosoftProvider(env: NodeJS.ProcessEnv) {
  const present = Object.keys(env).filter(
    (k) => k.startsWith("CALENDAR_M365_") && env[k] !== undefined,
  );
  if (!present.length) return null;
  const mode = env.CALENDAR_M365_MODE;
  const delegatedKeys = [
    "TENANT_ID",
    "CLIENT_ID",
    "ACCOUNT_OBJECT_ID",
    "CLIENT_SECRET",
    "MSAL_CACHE",
    "POLICY_JSON",
  ].map((k) => "CALENDAR_M365_DELEGATED_" + k);
  const appKeys = [
    "TENANT_ID",
    "CLIENT_ID",
    "CLIENT_SECRET",
    "POLICY_JSON",
    "POLICY_FILE",
  ].map((k) => "CALENDAR_M365_" + k);
  const allowed =
    mode === "delegated-confidential"
      ? delegatedKeys
      : mode === "app-only"
        ? appKeys
        : [];
  if (
    !allowed.length ||
    present.some((k) => k !== "CALENDAR_M365_MODE" && !allowed.includes(k))
  )
    throw Error("Invalid or mixed Microsoft provider configuration");
  if (mode === "delegated-confidential") {
    const config = {
      ...loadDelegatedConfig(env),
      clientSecret: loadConfidentialIdentity(env).clientSecret,
    };
    return { config, reader: createConfidentialReader(env) };
  }
  const config = loadConfig(env);
  return { config, reader: createGraph(config) };
}
