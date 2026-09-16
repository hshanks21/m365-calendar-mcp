/* Local, read-only dashboard. Credentials live only in the login field until submitted. */
const $ = (id) => document.getElementById(id);
let period = "today",
  offset = 0,
  sequence = 0;
const text = (id, value) => {
  $(id).textContent = value;
};
const time = (value) =>
  value === null
    ? "No successful read observed"
    : new Date(value).toLocaleString();
function showLogin() {
  sequence++;
  $("dashboard").hidden = true;
  $("login-panel").hidden = false;
}
function cell(value, className) {
  const el = document.createElement("td");
  el.textContent = value;
  if (className) el.className = className;
  return el;
}
function render(d) {
  const m = d.metrics,
    configured =
      d.health.graph !== "not_configured" ||
      (d.health.google && d.health.google !== "not_configured"),
    unobserved =
      (d.health.graph !== "not_configured" && !m.lastGraphSuccess) ||
      (d.health.google &&
        d.health.google !== "not_configured" &&
        !m.lastGoogleSuccess);
  $("login-panel").hidden = true;
  $("dashboard").hidden = false;
  text(
    "mode",
    d.health.mode === "test-fixture"
      ? "TEST FIXTURE / Synthetic upstream, not live provider telemetry"
      : "LOCAL OBSERVATIONS / Read-only · Today uses UTC; week is 7 days, month is 31 days",
  );
  const prose = $("request-prose");
  prose.replaceChildren();
  for (const [label, value] of [
    ["Requests", m.calls ? m.calls.toLocaleString() : "No requests"],
    [
      "Success rate",
      m.successRate === null
        ? "Not measured"
        : (m.successRate * 100).toFixed(1) + "%",
    ],
    [
      "Typical reply",
      m.medianMs === null ? "Not measured" : m.medianMs + " ms",
    ],
    ["Errors", m.errors.toLocaleString()],
    ["Denied", m.denied.toLocaleString()],
  ]) {
    const metric = document.createElement("div");
    metric.className = "metric";
    const caption = document.createElement("span");
    caption.textContent = label;
    const valueElement = document.createElement("strong");
    valueElement.textContent = value;
    metric.append(caption, valueElement);
    prose.append(metric);
  }
  text("caller-period", "REQUESTS / " + period.toUpperCase());
  const callers = $("callers");
  callers.replaceChildren();
  const known = d.access.callers;
  const entries = [
    ...known,
    ...(m.callers.some((c) => c.caller === 0)
      ? [{ caller: 0, label: "Unknown caller", calendarCount: 0 }]
      : []),
  ];
  for (const c of m.callers)
    if (c.caller && !entries.some((e) => e.caller === c.caller))
      entries.push({
        caller: c.caller,
        label: `Previous agent ${c.caller}`,
        calendarCount: null,
      });
  for (const c of entries) {
    const n = m.callers.find((v) => v.caller === c.caller)?.calls ?? 0;
    const row = document.createElement("tr");
    row.className = "caller-row";
    const label = document.createElement("td");
    label.textContent = c.label;
    const description = document.createElement("td");
    description.className = "description";
    description.textContent =
      c.caller === 0
        ? "Authentication denied"
        : c.calendarCount === null
          ? "Previous policy slot"
          : `${c.calendarCount} approved calendar${c.calendarCount === 1 ? "" : "s"}`;
    const count = document.createElement("td");
    count.className = "count";
    count.textContent = n;
    row.append(label, description, count);
    callers.append(row);
  }
  if (!entries.length) {
    const row = document.createElement("tr");
    const p = document.createElement("td");
    p.setAttribute("colspan", "3");
    p.className = "muted";
    p.textContent =
      "No agents configured yet. Your approved callers will appear here.";
    row.append(p);
    callers.append(row);
  }
  const warning =
    !configured ||
    !m.storageHealthy ||
    m.errors > 0 ||
    m.denied > 0 ||
    unobserved;
  document.querySelector(".attention").classList.toggle("warning", warning);
  text(
    "attention-title",
    !m.storageHealthy
      ? "The paper trail needs attention."
      : !configured
        ? "Calendar providers aren’t configured yet."
        : m.errors || m.denied
          ? "A few requests need a look."
          : unobserved
            ? "The connection is still unverified."
            : "No request failures in this window.",
  );
  text(
    "attention-detail",
    !m.storageHealthy
      ? "Persistence failed. Counts may be incomplete after restart; check the local data directory."
      : !configured
        ? "The dashboard is up. Calendar operations remain disabled until dedicated credentials and policy are provisioned."
        : m.errors || m.denied
          ? `${m.errors} errors and ${m.denied} denied requests. The sanitized outcomes are below; no meeting content is retained.`
          : unobserved
            ? "Configuration is present, but no complete calendar read has succeeded in retained history."
            : "A previous calendar read succeeded. This is not a continuous provider health check or proof of authorization scope.",
  );
  text(
    "connection",
    `Microsoft 365 · ${d.health.graph.replaceAll("_", " ")} / Google · ${(d.health.google ?? "not_configured").replaceAll("_", " ")}`,
  );
  text(
    "last-read",
    `Microsoft 365: ${time(m.lastGraphSuccess)} / Google: ${time(m.lastGoogleSuccess ?? null)}`,
  );
  text(
    "access",
    `${known.length} agents · ${d.access.calendarCount} approved calendars`,
  );
  text(
    "access-detail",
    `MCP: ${d.health.mcp}. Dashboard: ${d.health.service}. Read-only calendar tools; no admin controls. Agent numbers are policy-array slots, not identities from request input. Mailboxes, calendar IDs, client IDs and all credentials are withheld. Retained slots may refer to a previous policy after reconfiguration. Operations in this window: ${
      m.operations
        .filter((o) => o.calls)
        .map((o) => `${o.operation} (${o.calls})`)
        .join(", ") || "none"
    }.`,
  );
  const logs = $("logs");
  logs.replaceChildren();
  for (const e of m.logs) {
    const row = document.createElement("tr");
    row.append(
      cell(new Date(e.at).toLocaleString()),
      cell(e.caller ? `Agent ${e.caller}` : "Unknown"),
      cell(e.operation),
      cell(e.outcome, e.outcome),
      cell(e.durationMs + " ms"),
    );
    logs.append(row);
  }
  text(
    "empty-logs",
    m.logs.length
      ? ""
      : "No activity recorded in this window. This is not evidence of a successful provider connection.",
  );
  $("previous").disabled = offset === 0;
  $("next").disabled = !m.hasMore;
  text(
    "page-label",
    m.total
      ? `${offset + 1}–${offset + m.logs.length} of ${m.total}`
      : "No entries",
  );
  text(
    "coverage",
    `Bounded history: at most ${m.retention.maxEvents.toLocaleString()} observations / ${m.retention.maxDays} days. ${m.retention.retained} retained. Counts cover retained tool calls and authentication denials, not all HTTP traffic. Replies include incomplete reads as errors. Retries are not measured.`,
  );
  text("updated", "Updated " + time(m.asOf) + " · Refreshes every 30 seconds");
  text("fetch-error", "");
}
async function refresh() {
  const request = ++sequence;
  try {
    const response = await fetch(
      `/api/diagnostics?period=${period}&offset=${offset}&limit=25`,
      { credentials: "same-origin", cache: "no-store" },
    );
    if (request !== sequence) return;
    if (response.status === 401) {
      showLogin();
      return;
    }
    if (!response.ok) throw Error();
    const data = await response.json();
    if (request !== sequence) return;
    render(data);
  } catch {
    if (request === sequence)
      text(
        "fetch-error",
        "The dashboard could not refresh. Displayed data may be stale; try Refresh.",
      );
  }
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  text("login-error", "");
  const input = $("viewer-token");
  let token = input.value;
  input.value = "";
  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "same-origin",
    });
    token = "";
    if (!response.ok) {
      text(
        "login-error",
        response.status === 429
          ? "Too many attempts. Wait one minute."
          : "That viewer key wasn’t accepted.",
      );
      return;
    }
    offset = 0;
    await refresh();
  } catch {
    token = "";
    text("login-error", "The local dashboard is unavailable.");
  }
});
for (const button of document.querySelectorAll("[data-period]"))
  button.addEventListener("click", () => {
    period = button.dataset.period;
    offset = 0;
    for (const b of document.querySelectorAll("[data-period]"))
      b.setAttribute("aria-pressed", String(b === button));
    void refresh();
  });
$("previous").addEventListener("click", () => {
  offset = Math.max(0, offset - 25);
  void refresh();
});
$("next").addEventListener("click", () => {
  offset += 25;
  void refresh();
});
$("refresh").addEventListener("click", () => void refresh());
$("inspect").addEventListener("click", () => {
  const expanded = $("inspect").getAttribute("aria-expanded") === "true";
  $("inspect").setAttribute("aria-expanded", String(!expanded));
  $("access-detail").hidden = expanded;
});
$("logout").addEventListener("click", async () => {
  try {
    const r = await fetch("/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (r.ok || r.status === 401) showLogin();
    else throw Error();
  } catch {
    text("fetch-error", "Sign-out failed. Try again.");
  }
});
setInterval(() => {
  if (!document.hidden && !$("dashboard").hidden) void refresh();
}, 30000);
void refresh();
