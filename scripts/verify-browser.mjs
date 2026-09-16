// Explicit synthetic verification only. No production credential lookup or fallback.
// Usage: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/verify-browser.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startApplication } from "../dist/src/runtime.js";
import { startDashboard } from "../dist/src/dashboard.js";
import { startServer } from "../dist/src/server.js";
import { Telemetry } from "../dist/src/telemetry.js";
import { Graph } from "../dist/src/graph.js";
import { fixture, config, range, event } from "../dist/test/fixtures.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
if (!process.env.PLAYWRIGHT_MODULE)
  throw Error(
    "Set PLAYWRIGHT_MODULE to an explicitly installed verification dependency",
  );
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const dir = mkdtempSync(join(tmpdir(), "calendar-TEST-browser-"));
const secret = "TEST-FIXTURE-" + randomBytes(32).toString("hex");
const cleanup = [];
const errors = [];
const network = [];
mkdirSync("evidence", { recursive: true });
try {
  const app = await startApplication(
    {
      CALENDAR_DASHBOARD_SECRET: secret,
      CALENDAR_TELEMETRY_FILE: join(dir, "empty.json"),
    },
    { mcp: 0, dashboard: 0 },
  );
  cleanup.push(() => app.close());
  const browser = await chromium.launch({ headless: true });
  cleanup.push(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1560 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => network.push(r.url()));
  const login = async (url) => {
    await page.goto(url);
    await page.locator("#viewer-token").fill(secret);
    await page.locator("#login-form button").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
  };
  await page.goto(app.dashboard.url);
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#viewer-token").focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator("#login-form button")
      .evaluate((el) => el.matches(":focus-visible")),
    true,
  );
  await page.screenshot({
    path: "evidence/minimal-dashboard-login.png",
    fullPage: true,
  });
  await login(app.dashboard.url);
  assert.match(
    await page.locator("#attention-title").innerText(),
    /aren’t configured/,
  );
  assert.match(await page.locator("#request-prose").innerText(), /No requests/);
  const verifyTypography = async () => {
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const family = (selector) =>
        [...document.querySelectorAll(selector)].map((el) =>
          getComputedStyle(el).fontFamily.split(",")[0].replaceAll('"', ""),
        );
      return {
        headings: family("h1,h2"),
        body: family(
          "body,button,input,.subhead,.metric,.small,.count,th,footer,.eyebrow:not(.mono)",
        ),
        technical: family(".mono,.notice,#logs td"),
        sizes: [
          ...new Set(
            [...document.querySelectorAll("body *")]
              .filter((el) => el.getClientRects().length)
              .map((el) => getComputedStyle(el).fontSize),
          ),
        ],
        faces: [...document.fonts].map((f) => ({
          family: f.family,
          style: f.style,
          status: f.status,
        })),
        fontRequests: performance
          .getEntriesByType("resource")
          .filter((r) => r.name.includes("/fonts/"))
          .map((r) => new URL(r.name).pathname),
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(result.headings.every((f) => f === "Cormorant Garamond"));
    assert.ok(
      result.body.every((f) => f === "Rubik"),
      JSON.stringify(result.body),
    );
    assert.ok(
      result.technical.every((f) => f === "Space Grotesk"),
      JSON.stringify(result.technical),
    );
    assert.ok(
      result.sizes.every((size) =>
        ["11px", "12px", "14px", "16px", "22px", "36px"].includes(size),
      ),
      JSON.stringify(result.sizes),
    );
    for (const [family, style] of [
      ["Cormorant Garamond", "normal"],
      ["Space Grotesk", "normal"],
      ["Rubik", "normal"],
    ]) {
      assert.ok(
        result.faces.some(
          (f) =>
            f.family === family && f.style === style && f.status === "loaded",
        ),
        JSON.stringify(result.faces),
      );
    }
    assert.equal(result.fontRequests.length, 3);
    assert.ok(result.scrollWidth <= result.viewport, JSON.stringify(result));
    return result;
  };
  const fonts = await verifyTypography();
  assert.deepEqual(await page.locator(".metric strong").allTextContents(), [
    "No requests",
    "Not measured",
    "Not measured",
    "0",
    "0",
  ]);
  const icon = page.locator(".brand svg");
  assert.equal(
    await icon.count(),
    1,
    "brand uses an inline calendar SVG, not a font glyph",
  );
  assert.equal(await icon.getAttribute("aria-hidden"), "true");
  assert.equal(await icon.getAttribute("viewBox"), "0 0 24 24");
  assert.ok((await icon.locator("rect").count()) > 0);
  assert.ok((await icon.locator("path").count()) > 0);
  await page.screenshot({
    path: "evidence/minimal-dashboard-empty.png",
    fullPage: true,
  });
  await page.locator("[data-period=week]").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#caller-period").textContent ===
      "REQUESTS / WEEK",
  );
  await page.locator("#inspect").click();
  assert.equal(await page.locator("#access-detail").isVisible(), true);
  await page.locator("#logout").click();
  await page.locator("#login-panel").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/diagnostics")).status),
    401,
  );
  // Real MCP transport calls against a separately labeled synthetic HTTP upstream.
  const telemetry = new Telemetry(join(dir, "fixture.json"));
  const upstream = await fixture((_req, res) =>
    res.end(JSON.stringify({ value: [event] })),
  );
  cleanup.push(() => upstream.close());
  const mcp = await startServer(
    config,
    new Graph({
      token: async () => "TEST-FIXTURE-TOKEN",
      base: upstream.url,
      testOnly: true,
    }),
    0,
    telemetry,
  );
  cleanup.push(() => mcp.close());
  const dash = await startDashboard(
    { secret, telemetry, config, mcpUp: true, testOnly: true },
    0,
  );
  cleanup.push(() => dash.close());
  const client = new Client({
    name: "TEST-browser-verification",
    version: "1",
  });
  cleanup.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: { Authorization: "Bearer " + config.clients[0].secret },
      },
    }),
  );
  for (let i = 0; i < 28; i++)
    await client.callTool({ name: "list_calendars", arguments: {} });
  await client.callTool({
    name: "list_events",
    arguments: { calendarKey: "work", ...range },
  });
  await client.callTool({
    name: "list_events",
    arguments: { calendarKey: "other", ...range },
  });
  await login(dash.url);
  assert.match(await page.locator("#mode").innerText(), /TEST FIXTURE/);
  assert.equal(await page.locator(".metric strong").first().innerText(), "30");
  await page.locator("#next").click();
  await page.waitForFunction(
    () => document.querySelector("#page-label").textContent === "26–30 of 30",
  );
  assert.equal(await page.locator("#logs tr").count(), 5);
  await page.locator("#previous").click();
  await page.waitForFunction(
    () => document.querySelector("#page-label").textContent === "1–25 of 30",
  );
  await page.locator("[data-period=month]").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#caller-period").textContent ===
      "REQUESTS / MONTH",
  );
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/diagnostics") &&
        response.status() === 200,
    ),
    page.locator("#refresh").click(),
  ]);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const desktopTypography = await verifyTypography();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const renderedFonts = {};
  const verifyRenderedFonts = async (target) => {
    const { root } = await cdp.send("DOM.getDocument");
    for (const [selector, expected] of [
      ["#dashboard h1", "Cormorant Garamond"],
      [".subhead", "Rubik"],
      [".metric strong", "Rubik"],
      ["#mode", "Space Grotesk"],
      ["#logs td", "Space Grotesk"],
    ]) {
      // Use a visible subhead (the login panel remains in the DOM, hidden).
      const visibleSelector =
        selector === ".subhead" ? "#dashboard .subhead" : selector;
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: visibleSelector,
      });
      const { fonts: rendered } = await cdp.send(
        "CSS.getPlatformFontsForNode",
        { nodeId },
      );
      target[selector] = rendered;
      if (expected)
        assert.ok(
          rendered.some(
            (font) => font.isCustomFont && font.familyName.startsWith(expected),
          ),
          selector + ": " + JSON.stringify(rendered),
        );
    }
  };
  await verifyRenderedFonts(renderedFonts);
  await page.screenshot({
    path: "evidence/minimal-dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTypography = await verifyTypography();
  const mobileRenderedFonts = {};
  await verifyRenderedFonts(mobileRenderedFonts);
  await cdp.detach();
  const targets = await page
    .locator("button:visible, a:visible")
    .evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent.trim(),
        height: el.getBoundingClientRect().height,
        width: el.getBoundingClientRect().width,
      })),
    );
  assert.ok(
    targets.every((target) => target.height >= 44 && target.width >= 44),
    JSON.stringify(targets),
  );
  await page.locator("#refresh").focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".paper .table-wrap")
      .evaluate(
        (el) =>
          el.matches(":focus-visible") &&
          getComputedStyle(el).outlineStyle === "solid",
      ),
    true,
  );
  await page.screenshot({
    path: "evidence/minimal-dashboard-mobile-focus.png",
    fullPage: true,
  });
  await page.locator(".paper .table-wrap").evaluate((el) => el.blur());
  await page.screenshot({
    path: "evidence/minimal-dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 320, height: 740 });
  await verifyTypography();
  await page.locator("#logout").click();
  await page.locator("#login-panel").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "evidence/minimal-dashboard-login-mobile.png",
    fullPage: true,
  });
  assert.ok(network.every((u) => new URL(u).hostname === "127.0.0.1"));
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        fixtureOnly: true,
        typography: {
          empty: fonts,
          desktop: desktopTypography,
          mobile: mobileTypography,
        },
        renderedFonts,
        mobileRenderedFonts,
        targets,
        headingFont: "Cormorant Garamond",
        externalBrowserRequests: 0,
        pageErrors: errors.length,
        verified: [
          "login",
          "no M365 state",
          "empty metrics",
          "period selector",
          "access expansion",
          "logout invalidation",
          "real MCP fixture metrics",
          "bounded paging",
          "refresh",
          "mobile overflow",
          "self-hosted font",
          "calendar SVG icon",
        ],
        screenshots: [
          "evidence/minimal-dashboard-login.png",
          "evidence/minimal-dashboard-empty.png",
          "evidence/minimal-dashboard-desktop.png",
          "evidence/minimal-dashboard-mobile.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const close of cleanup.reverse()) await close();
  rmSync(dir, { recursive: true, force: true });
}
