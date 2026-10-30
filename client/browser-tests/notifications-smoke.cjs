const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs/promises");
const { chromium } = require("playwright");
async function run() {
  process.env.VITE_API_URL = "http://127.0.0.1:54999/api"; // Intercepted fixtures only; override any local .env.
  const { createServer } = await import("vite");
  const vite = await createServer({ root: path.resolve(__dirname, ".."), server: { host: "127.0.0.1", port: 0 }, logLevel: "error", clearScreen: false });
  let browser;
  try {
    await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = await chromium.launch({ channel: process.env.AIKYA_TEST_BROWSER_CHANNEL || "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });
    const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ contentType: "text/css", body: "" }));
    let fail = false, posted;
    const note = { _id: "000000000000000000000001", title: "Synthetic campus notice", body: "Synthetic test content", type: "announcement", status: "draft", audience: "public", scheduledAt: "2020-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", readAt: null };
    await context.route(/^http:\/\/127\.0\.0\.1:54999\/api\//, async route => {
      const request = route.request(), url = new URL(request.url()); let result = [];
      if (url.pathname === "/api/auth/me") result = { role: "admin", sub: "synthetic-admin", username: "Synthetic admin" };
      else if (url.pathname === "/api/notifications/push/config") result = { enabled: false, publicKey: null };
      else if (url.pathname === "/api/notifications/admin" && request.method() === "POST") { posted = request.postDataJSON(); result = { ...note, ...posted }; }
      else if (url.pathname === "/api/notifications/admin") result = { items: [note], hasMore: false };
      else if (url.pathname === "/api/notifications") {
        if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Unavailable"}', headers: { "Access-Control-Allow-Origin": origin } });
        result = { items: [note], hasMore: false };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result), headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" } });
    });
    await page.goto(origin + "/notifications");
    try { await page.getByRole("heading", { name: note.title }).waitFor({ timeout: 10000 }); }
    catch (error) { console.error("Synthetic browser startup diagnostics:", JSON.stringify(errors), (await page.locator("body").innerText()).slice(0, 1800)); throw error; }
    assert.equal(await page.evaluate(() => Notification.permission), "default", "No unsolicited permission prompt");
    await page.getByRole("button", { name: `Mark ${note.title} read` }).click();
    await page.getByRole("button", { name: `Mark ${note.title} unread` }).waitFor();
    await page.reload(); await page.getByRole("button", { name: `Mark ${note.title} unread` }).waitFor();
    fail = true; await page.getByRole("button", { name: "Refresh notifications" }).click(); await page.getByRole("alert").waitFor();
    fail = false; await page.getByRole("button", { name: "Retry notifications" }).click(); await page.getByRole("heading", { name: note.title }).waitFor();
    await page.getByRole("button", { name: "Open menu" }).click(); await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "Open menu" }).evaluate(element => element === document.activeElement), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Notification page must not overflow on mobile");
    const dock = await page.locator(".bottom-nav").boundingBox();
    for (const selector of [".ai-fab", ".emergency-fab"]) {
      const button = await page.locator(selector).boundingBox(); assert.ok(button.y + button.height <= dock.y, "Floating controls must not cover mobile navigation");
    }
    await fs.mkdir(path.resolve(__dirname, "../../docs/artifacts"), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, "../../docs/artifacts/notifications-mobile.png"), fullPage: true });
    await page.evaluate(() => localStorage.setItem("aikya_token", "synthetic-test-token"));
    await page.goto(origin + "/admin"); await page.getByRole("button", { name: "Announcements", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Synthetic new announcement");
    await page.getByLabel("Message", { exact: true }).fill("Synthetic content only");
    await page.getByLabel("Publish at (Asia/Kolkata)").fill("2030-01-02T00:00");
    await page.getByLabel("Expire at (Asia/Kolkata)").fill("2030-01-03T00:00");
    await page.getByRole("button", { name: "Create announcement", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Announcement saved" }).waitFor();
    assert.equal(posted.scheduledAt, "2030-01-01T18:30:00.000Z");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Admin form must not overflow on mobile");
    await page.goto(origin + "/home"); await page.getByRole("link", { name: "Campus announcements and deadlines" }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Landing must not overflow on mobile");
    assert.deepEqual(errors, []);
    console.log("PASS: mobile in-app read persistence, refresh/outage/retry, keyboard menu close/focus return, timezone-independent admin scheduling, landing updates link, no permission prompt, no horizontal overflow or page errors. HTTP fixtures only; no real notifications sent.");
  } finally { if (browser) await browser.close(); await vite.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
