const assert = require("node:assert/strict"),
  path = require("node:path"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  fs = require("node:fs/promises");
const { chromium } = require("playwright");
async function run() {
  process.env.VITE_BUS_TRACKING_SIMULATION = "true";
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  process.env.ADMIN_USERNAME = "";
  process.env.ADMIN_PASSWORD = "";
  const apiServer = http.createServer();
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  process.env.VITE_API_URL = `http://127.0.0.1:${apiServer.address().port}/api`;
  let vite,
    browser,
    trackingNow = new Date();
  try {
    const { createServer } = await import("vite");
    vite = await createServer({
      root: path.resolve(__dirname, ".."),
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "error",
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    process.env.CLIENT_ORIGIN = origin;
    const { createApp } = require("../../server/src/server");
    const { memoryModel } = require("../../server/test-support/memoryModels");
    const models = Object.fromEntries(
      [
        "BusRoute",
        "BusTrip",
        "BusDevice",
        "BusLocation",
        "Department",
        "Faculty",
        "PointOfInterest",
        "Event",
        "QueryLog",
        "AuditLog",
        "ShopOwner",
        "ShopFeedback",
      ].map((name) => [name, memoryModel(name)]),
    );
    const app = createApp({
      models,
      audit: require("../../server/src/services/auditService").createAuditor(
        models.AuditLog,
      ),
      services: {
        tracking: {
          enabled: () => true,
          now: () => trackingNow,
          transaction: (work) => work(null),
        },
      },
    });
    apiServer.on("request", app);
    const bus = await models.BusRoute.create({
      routeNumber: "SYNTHETIC",
      trackingEnabled: true,
      routeDescription: "Synthetic route for browser tests only",
      stops: [{ name: "Synthetic stop", time: "Test schedule" }],
    });
    const service = app.locals.busTracking;
    const device = await service.authorize(
      {
        busId: String(bus._id),
        label: "Synthetic browser unit",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      { role: "admin", sub: "synthetic-admin" },
    );
    const session = await service.login({
      deviceId: String(device._id),
      secret: device.secret,
    });
    const principal = require("../../server/node_modules/jsonwebtoken").verify(
      session.token,
      process.env.JWT_SECRET,
    );
    const trip = await service.start({ consent: true }, principal);
    await service.ingest(
      String(trip._id),
      {
        latitude: 17.0897,
        longitude: 82.0672,
        accuracy: 15,
        recordedAt: trackingNow.toISOString(),
      },
      principal,
    );
    browser = await chromium.launch({
      channel: process.env.AIKYA_TEST_BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
      route.fulfill({ contentType: "text/css", body: "" }),
    );
    await context.route(/basemaps\.cartocdn\.com/, (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Browser page error:", error.message);
    });
    await page.goto(origin + "/buses");
    await page.getByText("Receiving GPS", { exact: true }).waitFor();
    await page.locator(".bus-tracking-marker").waitFor();
    await page
      .getByText("Estimated arrival: unavailable", { exact: true })
      .waitFor();
    await page.getByText("Synthetic stop", { exact: true }).last().waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Mobile bus tracking overflow",
    );
    const artifacts = path.resolve(__dirname, "../../docs/artifacts");
    await fs.mkdir(artifacts, { recursive: true });
    await page.screenshot({
      path: path.join(artifacts, "bus-tracking-mobile.png"),
      fullPage: true,
    });
    const historyBeforeSimulation = models.BusLocation.records.size;
    await page.getByRole("button", { name: "Development simulation", exact: true }).click();
    await page.getByText(/SIMULATED — development fixture/).waitFor();
    await page.locator('[title="Bus route SIMULATED"]').waitFor();
    assert.equal(models.BusLocation.records.size, historyBeforeSimulation);
    await page.getByRole("button", { name: "Exit simulation", exact: true }).click();
    await page.getByText("Receiving GPS", { exact: true }).waitFor();
    trackingNow = new Date(trackingNow.getTime() + 31000);
    await page
      .getByRole("button", { name: "Refresh tracking", exact: true })
      .click();
    await page
      .getByText("Stale — last reported position", { exact: true })
      .waitFor();
    trackingNow = new Date(trackingNow.getTime() + 60000);
    await page
      .getByRole("button", { name: "Refresh tracking", exact: true })
      .click();
    await page
      .getByText("Offline — no current position", { exact: true })
      .waitFor();
    assert.equal(await page.locator(".bus-tracking-marker").count(), 0);
    await service.end(String(trip._id), principal);
    trackingNow = new Date();
    await context.grantPermissions(["geolocation"], { origin });
    await context.setGeolocation({
      latitude: 17.0897,
      longitude: 82.0672,
      accuracy: 15,
    });
    await page.goto(origin + "/driver");
    await page
      .getByLabel("Device ID", { exact: true })
      .fill(String(device._id));
    await page.getByLabel("Device secret", { exact: true }).fill(device.secret);
    await page
      .getByRole("button", { name: "Authorize device", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Assigned bus device", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Start trip and share GPS", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("checkbox").check();
    const sent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/locations") && response.status() === 201,
    );
    // Use wall time for browser sensor callbacks after testing stale/offline with a controlled clock.
    const clockTimer = setInterval(() => {
      trackingNow = new Date();
    }, 20);
    try {
      const started = page.waitForResponse(
        (response) =>
          response.url().endsWith("/bus-tracking/trips") &&
          response.status() === 201,
      );
      await page
        .getByRole("button", { name: "Start trip and share GPS", exact: true })
        .click();
      await started;
      // A fresh sensor sample after consent: Playwright's earlier fix can predate the trip.
      await context.setGeolocation({
        latitude: 17.08971,
        longitude: 82.0672,
        accuracy: 15,
      });
      await sent;
    } finally {
      clearInterval(clockTimer);
    }
    await page.getByText(/GPS report accepted/).waitFor();
    await page
      .getByRole("button", { name: "Stop sharing and end trip", exact: true })
      .click();
    await page.getByText("GPS sharing: OFF", { exact: true }).waitFor();
    await page.goto(origin + "/buses");
    await page
      .getByText("No authorized active bus trips on this page.", {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "Bus browser smoke PASS: mobile real Leaflet bus marker, route browsing, stale/offline marker removal, unavailable ETA, explicit driver consent, authorized foreground GPS and Stop; no page errors/overflow. Synthetic fixtures only.",
    );
  } finally {
    if (browser) await browser.close();
    if (vite) await vite.close();
    await new Promise((resolve) => apiServer.close(resolve));
  }
}
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
