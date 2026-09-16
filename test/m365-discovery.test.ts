import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("operator CLI help needs no secrets and missing explicit --list refuses before network", async () => {
  const run = promisify(execFile);
  const entry = new URL("../src/m365-discovery-cli.js", import.meta.url)
    .pathname;
  const args = [
    "--import",
    "tsx",
    import.meta.url.endsWith(".ts") ? entry.replace(/\.js$/, ".ts") : entry,
  ];
  const options = { env: { PATH: process.env.PATH }, timeout: 5000 };
  const help = await run(process.execPath, [...args, "--help"], options);
  assert.match(help.stdout, /--list/);
  assert.equal(help.stderr, "");
  for (const a of [[], ["--list"], ["--list", "--url", "https://evil.invalid"]])
    await assert.rejects(
      run(process.execPath, [...args, ...a], options),
      (e: any) =>
        e.code === 1 &&
        /^Microsoft calendar discovery refused\./.test(e.stderr),
    );
});
test("discovery deadline and cancellation close native HTTP bodies; redirects never forward the bearer", async () => {
  const m = await api();
  for (const cancel of [false, true]) {
    let closed!: () => void;
    const closing = new Promise<void>((r) => (closed = r));
    const f = await fixture((_req: any, res: any) => {
      res.writeHead(200);
      res.write("{");
      res.on("close", closed);
    });
    try {
      const stop = new AbortController();
      const timer = cancel ? setTimeout(() => stop.abort(), 100) : undefined;
      try {
        await assert.rejects(
          m.discoverMicrosoftCalendars(async () => "SYNTHETIC", {
            signal: stop.signal,
            timeoutMs: cancel ? 2000 : 100,
            fetcher: (_u: string, init: RequestInit) => fetch(f.url, init),
          }),
          /discovery failed/,
        );
        await Promise.race([
          closing,
          new Promise((_, no) =>
            setTimeout(() => no(Error("body still running")), 1000).unref(),
          ),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await f.close();
    }
  }
  let foreign = 0;
  const target = await fixture((_req: any, res: any) => {
    foreign++;
    res.end("{}");
  });
  const redirect = await fixture((_req: any, res: any) => {
    res.writeHead(302, { Location: target.url });
    res.end();
  });
  try {
    await assert.rejects(
      m.discoverMicrosoftCalendars(async () => "SYNTHETIC", {
        fetcher: (_u: string, init: RequestInit) => fetch(redirect.url, init),
      }),
      /discovery failed/,
    );
    assert.equal(foreign, 0);
  } finally {
    await redirect.close();
    await target.close();
  }
});
const api = () => import("../src/m365-discovery.js" as string) as Promise<any>;
test("discovery refuses unsafe/malformed pagination, loops, overflow and invalid responses without partial results", async () => {
  const m = await api();
  const base = "https://graph.microsoft.com/v1.0/me/calendars";
  const row = { id: "SYNTHETIC-id", name: "Calendar", isDefaultCalendar: true };
  for (const next of [
    "https://evil.invalid/",
    base.replace("/me/", "/users/other/"),
    base.replace("/calendars", "/events"),
    base + "#secret",
    base.replace("https:", "http:"),
    base.replace("graph.", "user:pass@graph."),
    base + "?$expand=events",
    base + "?$skip=1&$skip=2",
    "",
    null,
    42,
    "/v1.0/me/calendars",
  ]) {
    let calls = 0;
    await assert.rejects(
      m.discoverMicrosoftCalendars(async () => "SYNTHETIC", {
        fetcher: async () => {
          calls++;
          return Response.json({ value: [row], "@odata.nextLink": next });
        },
      }),
      /^Error: Microsoft calendar discovery failed\.$/,
    );
    assert.equal(calls, 1);
  }
  for (const body of [
    { value: [row, row] },
    { value: [{ ...row, id: "" }] },
    { value: [{ ...row, isDefaultCalendar: "true" }] },
    { value: [{ ...row, name: null }] },
    {
      value: Array.from({ length: 101 }, (_, i) => ({ ...row, id: String(i) })),
    },
    {},
  ])
    await assert.rejects(
      m.discoverMicrosoftCalendars(async () => "SYNTHETIC", {
        fetcher: async () => Response.json(body),
      }),
      /discovery failed/,
    );
  for (const response of [
    new Response("SYNTHETIC-provider-error", { status: 403 }),
    new Response("x".repeat(131073)),
    new Response("{}", {
      status: 302,
      headers: { Location: "https://evil.invalid" },
    }),
  ]) {
    await assert.rejects(
      m.discoverMicrosoftCalendars(async () => "SYNTHETIC", {
        fetcher: async () => response,
      }),
      /^Error: Microsoft calendar discovery failed\.$/,
    );
  }
  let pages = 0;
  await assert.rejects(
    m.discoverMicrosoftCalendars(async () => "SYNTHETIC", {
      fetcher: async () =>
        Response.json({
          value: [],
          "@odata.nextLink": base + "?$skip=" + ++pages,
        }),
    }),
    /discovery failed/,
  );
  assert.equal(pages, 5);
});
test("discovery traverses bounded pages, pins projection and rejects repeat continuations", async () => {
  const m = await api();
  let pages = 0;
  const fetcher = async (u: string) => {
    pages++;
    assert.equal(
      new URL(u).searchParams.get("$select"),
      "id,name,isDefaultCalendar",
    );
    return Response.json({
      value: [
        {
          id: String(pages),
          name: "SYNTHETIC",
          isDefaultCalendar: pages === 1,
        },
      ],
      ...(pages === 1
        ? {
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=opaque&$select=owner",
          }
        : {}),
    });
  };
  assert.equal(
    (await m.discoverMicrosoftCalendars(async () => "SYNTHETIC", { fetcher }))
      .length,
    2,
  );
  pages = 0;
  await assert.rejects(
    m.discoverMicrosoftCalendars(async () => "SYNTHETIC", {
      fetcher: async () => {
        pages++;
        return Response.json({
          value: [],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/me/calendars?$skip=2",
        });
      },
    }),
    /discovery failed/,
  );
  assert.equal(pages, 2);
});
test("operator discovery projects only id/name/default from fixed GET /me/calendars with ReadBasic token", async () => {
  const m = await api().catch(() => ({}));
  assert.equal(typeof m.discoverMicrosoftCalendars, "function");
  let calls = 0;
  const calendars = await m.discoverMicrosoftCalendars(
    async (signal: AbortSignal) => {
      assert.ok(signal);
      return "SYNTHETIC-token";
    },
    {
      fetcher: async (url: string, init: RequestInit) => {
        calls++;
        const u = new URL(url);
        assert.equal(u.origin, "https://graph.microsoft.com");
        assert.equal(u.pathname, "/v1.0/me/calendars");
        assert.equal(
          u.searchParams.get("$select"),
          "id,name,isDefaultCalendar",
        );
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        assert.equal(
          (init.headers as any).Authorization,
          "Bearer SYNTHETIC-token",
        );
        return Response.json({
          value: [
            {
              id: "SYNTHETIC-id",
              name: "Calendar",
              isDefaultCalendar: true,
              owner: "must not return",
              events: "must not return",
            },
          ],
        });
      },
    },
  );
  assert.deepEqual(calendars, [
    { id: "SYNTHETIC-id", name: "Calendar", isDefaultCalendar: true },
  ]);
  assert.equal(calls, 1);
});
