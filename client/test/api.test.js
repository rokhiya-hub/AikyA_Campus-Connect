import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import { escapeHtml } from "../src/lib/escapeHtml.js";

// Substitute only Vite's environment expression, retaining the actual API
// implementation. No browser, network, or credentials are needed here.
const source = (await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8"))
  .replace("import.meta.env.VITE_API_URL", "undefined");
const { api } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
globalThis.localStorage = { getItem: () => null };

test("driver API requests use the device session instead of a saved admin token and never persist credentials", async () => {
  let options;
  let stored = false;
  globalThis.localStorage = { getItem: () => "synthetic-admin-session", setItem: () => { stored = true; } };
  globalThis.fetch = async (_path, config) => { options = config; return Response.json({ token: "synthetic-device-session" }); };
  try {
    await api.driverSession({ deviceId: "synthetic-device", secret: "synthetic-test-credential" });
    assert.equal(stored, false);
    const controller = new AbortController();
    await api.sendBusLocation("synthetic-trip", { latitude: 17, longitude: 82, accuracy: 15, recordedAt: "2026-10-29T04:00:00.000Z" }, "synthetic-device-session", controller.signal);
    assert.equal(options.headers.Authorization, "Bearer synthetic-device-session"); assert.equal(options.signal, controller.signal);
    await api.endBusTrip("synthetic-trip", "synthetic-device-session", true); assert.equal(options.keepalive, true);
  } finally { globalThis.localStorage = { getItem: () => null }; }
});

test("shop search encodes filters, preserves page headers and rejects malformed collections", async () => {
  let requested;
  globalThis.fetch = async path => { requested = path; return Response.json([{ _id: "synthetic" }], { headers: { "X-Has-More": "true" } }); };
  assert.deepEqual(await api.shopPage({ q: "B/W Xerox & print", page: 2, itemCategory: "printing" }), { data: [{ _id: "synthetic" }], hasMore: true });
  assert.equal(new URL(requested, "http://localhost:5173").searchParams.get("q"), "B/W Xerox & print");
  globalThis.fetch = async () => Response.json({ unexpected: true });
  await assert.rejects(api.shopPage(), /Invalid collection response/);
});

test("owner login uses its dedicated endpoint and feedback does not invalidate collection views", async () => {
  const paths = [], events = [];
  globalThis.fetch = async path => { paths.push(path); return Response.json({ message: "Synthetic receipt" }); };
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  try {
    await api.login("synthetic@example.test", "synthetic-password", "shop_owner");
    assert.ok(paths[0].endsWith("/auth/shop-owner/login"));
    await api.create("shops/synthetic/feedback", { reason: "stock", message: "Synthetic report" }); assert.deepEqual(events, []);
    await api.update("shops", "synthetic", { contact: "Synthetic contact" }); assert.deepEqual(events, ["aikya:collections-changed"]);
  } finally { delete globalThis.window; delete globalThis.CustomEvent; }
});

test("HTTP errors retain the API message and status", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  await assert.rejects(api.getFaculty, (error) => error.message === "Authentication required" && error.status === 401);
});
test("default requests use same-origin API paths and network failures explain backend setup", async () => {
  let requested;
  globalThis.fetch = async path => { requested = path; throw new TypeError("Failed to fetch"); };
  await assert.rejects(api.getDepartments, /Cannot reach the campus API.*backend.*database/);
  assert.match(requested, /^\/api\/departments\?/);
});
test("cancelled requests preserve AbortError rather than reporting a server outage", async () => {
  globalThis.fetch = async () => { throw new DOMException("Cancelled", "AbortError"); };
  await assert.rejects(api.shopPage, error => error.name === "AbortError");
});

test("non-JSON HTTP errors have a useful fallback", async () => {
  globalThis.fetch = async () => new Response("Gateway unavailable", { status: 502 });
  await assert.rejects(api.getFaculty, (error) => error.message === "Request failed (502)" && error.status === 502);
});

test("JSON null error bodies retain the HTTP failure", async () => {
  globalThis.fetch = async () => new Response("null", { status: 503 });
  await assert.rejects(api.getFaculty, (error) => error.message === "Request failed (503)" && error.status === 503);
});

test("successful API responses retain their shape", async () => {
  globalThis.fetch = async () => Response.json([{ _id: "synthetic" }]);
  assert.deepEqual(await api.getFaculty(), [{ _id: "synthetic" }]);
});

test("collection clients follow pagination while retaining arrays and public defaults", async () => {
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    return Response.json([{ _id: paths.length === 1 ? "first" : "second" }], { headers: { "X-Has-More": paths.length === 1 ? "true" : "false" } });
  };
  assert.deepEqual(await api.getFaculty(), [{ _id: "first" }, { _id: "second" }]);
  assert.match(paths[1], /page=2&limit=200/);
  assert.ok(paths.every((path) => !path.includes("view=private")));
});

test("admin lists and faculty profile explicitly request private views", async () => {
  const paths = [];
  globalThis.fetch = async (path) => { paths.push(path); return Response.json([]); };
  await api.getPOIs(true);
  await api.getFacultyProfile("synthetic");
  assert.ok(paths.every((path) => path.includes("view=private")));
});

test("Leaflet text escapes markup and attribute delimiters", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)"> & \'test\''),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;");
  assert.equal(escapeHtml(undefined), "");
});
