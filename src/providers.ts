import type { Config } from "./config.js";
import type { GoogleConfig } from "./google-config.js";
import type { Graph, Mapping, Range, View } from "./graph.js";
import type { GoogleCalendar } from "./google.js";
export type CalendarMapping =
  Mapping | { provider: "google"; calendarId: string };
export type ServiceConfig = {
  calendars: Record<string, CalendarMapping>;
  clients: Config["clients"];
  clientSecret?: string;
};
export type CalendarReader = {
  options: { testOnly?: boolean };
  mode?: string;
  view(
    mapping: CalendarMapping,
    range: Range,
    lifecycle?: { signal?: AbortSignal; onSettled?: () => void },
  ): Promise<View>;
};
export function combinePolicies(
  m365: ServiceConfig | null,
  google: GoogleConfig | null,
): ServiceConfig | null {
  if (!m365 && !google) return null;
  const clients = [...(m365?.clients ?? []), ...(google?.clients ?? [])];
  if (
    clients.length > 64 ||
    new Set(clients.map((c) => c.id)).size !== clients.length ||
    new Set(clients.map((c) => c.secret)).size !== clients.length ||
    Object.keys(m365?.calendars ?? {}).some((k) =>
      Object.hasOwn(google?.calendars ?? {}, k),
    )
  )
    throw Error("Provider policies collide");
  return {
    clients,
    calendars: { ...m365?.calendars, ...google?.calendars },
    clientSecret: m365?.clientSecret,
  };
}
export function routeProviders(
  graph: Graph | null,
  google: GoogleCalendar | null,
): CalendarReader {
  return {
    options: {
      testOnly: !!(graph?.options.testOnly || google?.options.testOnly),
    },
    mode:
      graph && google
        ? "m365-and-google"
        : google
          ? "google-delegated"
          : graph?.options.delegated
            ? "m365-delegated"
            : "m365-app-only",
    view(mapping, range, lifecycle) {
      if ("provider" in mapping && mapping.provider === "google" && google)
        return google.view(mapping, range, lifecycle);
      if ("mailbox" in mapping && graph)
        return graph.view(mapping, range, lifecycle);
      lifecycle?.onSettled?.();
      return Promise.resolve({
        complete: false,
        events: [],
        error: "provider_not_configured",
      });
    },
  };
}
