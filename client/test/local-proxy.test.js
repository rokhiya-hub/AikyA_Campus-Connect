import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
test("real Vite proxy loads all five Express collections and reports backend outages", async () => {
  process.env.NODE_ENV = "test";
  const apiServer = http.createServer(); let vite;
  await new Promise(resolve => apiServer.listen(0, "127.0.0.1", resolve));
  try {
    vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: `http://127.0.0.1:${apiServer.address().port}` } } }, logLevel: "silent" });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    process.env.CLIENT_ORIGIN = origin;
    const { createApp } = require("../../server/src/server");
    const { memoryModel } = require("../../server/test-support/memoryModels");
    const models = Object.fromEntries(["Faculty", "Department", "PointOfInterest", "BusRoute", "Event"].map(name => [name, memoryModel(name)]));
    await models.Faculty.create({ name: "Synthetic proxy faculty" });
    await models.Department.create({ name: "Synthetic proxy department", code: "SYN", block: "Synthetic", floor: "1" });
    await models.PointOfInterest.create({ name: "Synthetic proxy library", type: "library" });
    await models.BusRoute.create({ routeNumber: "SYN" });
    await models.Event.create({ title: "Synthetic proxy event", date: "2030-01-01" });
    apiServer.on("request", createApp({ models }));
    for (const collection of ["faculty", "departments", "poi", "buses", "events"]) {
      const response = await fetch(`${origin}/api/${collection}`, { headers: { Origin: origin }, signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, collection);
      assert.equal((await response.json()).length, 1, collection);
    }
    await new Promise(resolve => apiServer.close(resolve));
    const unavailable = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(unavailable.status, 503);
    assert.match((await unavailable.json()).error, /Campus API is unavailable.*MONGODB_URI/);
  } finally {
    if (vite) await vite.close();
    if (apiServer.listening) await new Promise(resolve => apiServer.close(resolve));
  }
});
