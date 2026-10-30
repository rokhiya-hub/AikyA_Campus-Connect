const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const crypto = require("node:crypto");

// The app does not connect when imported. All tests use synthetic data and
// a random, process-local signing secret, never the configured database.
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
const app = require("../src/server");
const { signToken, jwtSecret } = require("../src/middleware/auth");
const Faculty = require("../src/models/Faculty");
const connectDB = require("../src/config/db");
let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test("health responds without a database connection", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("chat rejects malformed or oversized messages before retrieving data", async () => {
  for (const message of [undefined, null, 42, {}, [], " ", "x".repeat(4001)]) {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    assert.equal(response.status, 400);
  }
});

test("login rejects object selectors and nonstring passwords", async () => {
  for (const body of [{ username: { $ne: null }, password: "x" }, { username: "x", password: [] }]) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
});

test("analytics rejects anonymous, invalid, and faculty tokens", async () => {
  for (const [token, status] of [[null, 401], ["invalid", 401], [signToken({ role: "faculty", sub: "000000000000000000000001" }), 403]]) {
    const response = await fetch(`${base}/api/chat/analytics`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    assert.equal(response.status, status);
  }
});

test("all collection writes require admin authorization before database access", async () => {
  const token = signToken({ role: "faculty", sub: "000000000000000000000001" });
  for (const resource of ["departments", "poi", "buses", "events", "faculty"]) {
    for (const [authorization, status] of [[undefined, 401], [`Bearer ${token}`, 403]]) {
      const response = await fetch(`${base}/api/${resource}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
        body: "{}",
      });
      assert.equal(response.status, status);
    }
  }
});

test("missing signing configuration fails closed", async () => {
  const secret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.throws(jwtSecret, /JWT_SECRET/);
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 503);
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic" }),
    });
    assert.equal(response.status, 503);
  } finally { process.env.JWT_SECRET = secret; }
});

test("new faculty documents never serialize password hashes", () => {
  const faculty = new Faculty({ name: "Synthetic test record", passwordHash: "synthetic-hash" });
  assert.equal(faculty.toJSON().passwordHash, undefined);
  assert.equal(faculty.toObject().passwordHash, undefined);
  assert.doesNotMatch(JSON.stringify(faculty), /synthetic-hash/);
});

test("missing MongoDB URI fails before connecting", async () => {
  const uri = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  try { await assert.rejects(connectDB, /MONGODB_URI/); }
  finally { if (uri !== undefined) process.env.MONGODB_URI = uri; }
});
