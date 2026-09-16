// Operator-only; never registered with MCP or dashboard. Discovery is NOT approval.
export type DiscoveredCalendar = {
  id: string;
  name: string;
  isDefaultCalendar: boolean;
};
export async function discoverMicrosoftCalendars(
  token: (signal?: AbortSignal) => Promise<string>,
  deps: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<DiscoveredCalendar[]> {
  const deadline = AbortSignal.timeout(deps.timeoutMs ?? 15000);
  const signal = deps.signal
    ? AbortSignal.any([deadline, deps.signal])
    : deadline;
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendars");
  url.searchParams.set("$select", "id,name,isDefaultCalendar");
  url.searchParams.set("$top", "100");
  try {
    signal.throwIfAborted();
    const access = await token(signal);
    signal.throwIfAborted();
    let next: string | undefined = url.href;
    const seen = new Set<string>(),
      ids = new Set<string>();
    const calendars: DiscoveredCalendar[] = [];
    for (let page = 0; next && page < 5; page++) {
      if (next.length > 8192) throw Error();
      const target = new URL(next);
      if (
        target.origin !== url.origin ||
        target.pathname !== url.pathname ||
        target.username ||
        target.password ||
        target.hash
      )
        throw Error();
      for (const key of target.searchParams.keys()) {
        if (
          !["$select", "$top", "$skiptoken", "$skip"].includes(key) ||
          target.searchParams.getAll(key).length !== 1
        )
          throw Error();
      }
      if (
        target.searchParams.has("$skip") &&
        !/^\d{1,6}$/.test(target.searchParams.get("$skip")!)
      )
        throw Error();
      if (
        target.searchParams.has("$skiptoken") &&
        !/^.{1,4096}$/s.test(target.searchParams.get("$skiptoken")!)
      )
        throw Error();
      // Pin minimal projection even if Graph changes it in its nextLink.
      target.searchParams.set("$select", url.searchParams.get("$select")!);
      target.searchParams.set("$top", "100");
      target.searchParams.sort();
      if (seen.has(target.href)) throw Error();
      seen.add(target.href);
      signal.throwIfAborted();
      const response = await (deps.fetcher ?? fetch)(target.href, {
        method: "GET",
        redirect: "error",
        signal,
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw Error();
      }
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          signal.throwIfAborted();
          const r = await reader.read();
          if (r.done) break;
          size += r.value.length;
          if (size > 131072) throw Error();
          chunks.push(r.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      signal.throwIfAborted();
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(data?.value)) throw Error();
      for (const c of data.value) {
        if (
          calendars.length >= 100 ||
          !c ||
          typeof c.id !== "string" ||
          !c.id ||
          c.id.length > 512 ||
          c.id === "." ||
          c.id === ".." ||
          ids.has(c.id) ||
          typeof c.name !== "string" ||
          c.name.length > 512 ||
          typeof c.isDefaultCalendar !== "boolean"
        )
          throw Error();
        ids.add(c.id);
        calendars.push({
          id: c.id,
          name: c.name,
          isDefaultCalendar: c.isDefaultCalendar,
        });
      }
      next = undefined;
      if (Object.hasOwn(data, "@odata.nextLink")) {
        if (
          typeof data["@odata.nextLink"] !== "string" ||
          !data["@odata.nextLink"]
        )
          throw Error();
        next = data["@odata.nextLink"];
      }
    }
    if (next) throw Error();
    return calendars;
  } catch {
    // Never return a partial selection list or reflect Graph/MSAL errors.
    throw Error("Microsoft calendar discovery failed.");
  }
}
