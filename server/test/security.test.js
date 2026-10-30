const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { spawnSync } = require("node:child_process");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_USERNAME = "test-administrator";
process.env.ADMIN_PASSWORD = crypto.randomBytes(24).toString("hex");
process.env.CLIENT_ORIGIN = "http://localhost:5173";
const { createApp } = require("../src/server");
const { signToken } = require("../src/middleware/auth");
const { validateProductionConfig } = require("../src/config/security");
const { createAuditor } = require("../src/services/auditService");
const { assertSeedSafety, insertSeed } = require("../src/seed/safety");
const { memoryModel } = require("../test-support/memoryModels");
const models = Object.fromEntries(["Department", "Faculty", "PointOfInterest", "BusRoute", "Event", "QueryLog", "AuditLog"].map((name) => [name, memoryModel(name)]));
let server, base, owner, other, ownerToken;
const adminToken = signToken({ role: "admin", sub: "test-administrator" });
const ownerPassword = crypto.randomBytes(16).toString("hex");
const syntheticSource = { id: "Department:000000000000000000000001", recordId: "000000000000000000000001", type: "Department", label: "Synthetic", path: "/departments" };
const services = { retrieveCampusContext: async () => ({ context: { facts: [{ id: `${syntheticSource.id}:synthetic`, sourceId: syntheticSource.id, label: "Synthetic", text: "Synthetic answer", externalAllowed: true }], sources: [syntheticSource], clarification: false, notices: [] } }), answerCampusQuestion: async () => ({ factIds: [`${syntheticSource.id}:synthetic`] }) };
before(async () => {
  owner = await models.Faculty.create({ name: "Synthetic Faculty One", email: "owner@example.test", passwordHash: await bcrypt.hash(ownerPassword, 4) });
  other = await models.Faculty.create({ name: "Synthetic Faculty Two", email: "other@example.test" });
  ownerToken = signToken({ role: "faculty", sub: String(owner._id), username: owner.email });
  server = createApp({ models, audit: createAuditor(models.AuditLog), services, limits: { login: 100, chat: 100 } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
async function request(path, { method = "GET", token, body, headers = {} } = {}) {
  return fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
test("production configuration refuses missing secret/admin/origin before startup", () => {
  assert.deepEqual(require("../src/config/security").originsFor({ NODE_ENV: "development" }), ["http://localhost:5173", "http://127.0.0.1:5173"]);
  assert.deepEqual(require("../src/config/security").originsFor({ NODE_ENV: "production" }), []);
  const valid = { NODE_ENV: "production", JWT_SECRET: crypto.randomBytes(32).toString("hex"), ADMIN_USERNAME: "synthetic", ADMIN_PASSWORD: crypto.randomBytes(16).toString("hex"), CLIENT_ORIGIN: "https://example.test", MONGODB_URI: "mongodb://127.0.0.1/synthetic_test" };
  assert.doesNotThrow(() => validateProductionConfig(valid));
  for (const field of ["JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "CLIENT_ORIGIN", "MONGODB_URI"]) assert.throws(() => validateProductionConfig({ ...valid, [field]: "" }));
  assert.throws(() => validateProductionConfig({ ...valid, CLIENT_ORIGIN: "*" }));
  assert.throws(() => validateProductionConfig({ ...valid, JWT_SECRET: "short" }));
});
test("production executable exits before database access when required configuration is absent", () => {
  const child = spawnSync(process.execPath, [require.resolve("../src/server")], {
    env: { ...process.env, NODE_ENV: "production", JWT_SECRET: "", ADMIN_USERNAME: "", ADMIN_PASSWORD: "", CLIENT_ORIGIN: "", MONGODB_URI: "" }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Production requires JWT_SECRET/);
});
test("Helmet, exact CORS and JSON body limits apply to the API", async () => {
  const allowed = await request("/api/health", { headers: { Origin: "http://localhost:5173" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
  assert.equal(allowed.headers.get("x-powered-by"), null);
  assert.equal((await request("/api/health", { headers: { Origin: "https://untrusted.example.test" } })).status, 403);
  const malformed = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).requestId, "string");
  assert.equal((await request("/api/chat", { method: "POST", body: { message: "x".repeat(70000) } })).status, 413);
  assert.equal((await fetch(base + "/api/chat", { method: "POST", body: "text" })).status, 415);
});
test("admin and faculty login still issue usable sessions without exposing hashes", async () => {
  for (const [username, password, role] of [[process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD, "admin"], [owner.email, ownerPassword, "faculty"]]) {
    const response = await request("/api/auth/login", { method: "POST", body: { username, password } });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.role, role);
    assert.equal(data.passwordHash, undefined);
    const me = await request("/api/auth/me", { token: data.token });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).role, role);
  }
  assert.equal((await request("/api/auth/login", { method: "POST", body: { username: owner.email, password: "wrong" } })).status, 401);
});
test("every resource rejects anonymous mutations and faculty admin-only mutations", async () => {
  const fakeId = String(other._id);
  for (const resource of ["departments", "poi", "buses", "events", "faculty"]) {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const path = `/api/${resource}${method === "POST" ? "" : "/" + fakeId}`;
      assert.equal((await request(path, { method, body: {} })).status, 401);
      assert.equal((await request(path, { method, token: ownerToken, body: {} })).status, 403);
    }
  }
  for (const token of [undefined, "invalid", signToken({ role: "student", sub: "synthetic" })]) {
    const denied = await request("/api/chat/analytics", { token });
    assert.equal(denied.status, 401);
    assert.ok((await denied.json()).requestId);
  }
  assert.equal((await request("/api/chat/analytics", { token: ownerToken })).status, 403);
});
test("faculty may update their own profile and timetable but cannot escalate privileges", async () => {
  const path = `/api/faculty/${owner._id}`;
  const allowed = await request(path, { method: "PUT", token: ownerToken, body: { designation: "Lecturer", subjects: ["Synthetic subject"] } });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).designation, "Lecturer");
  assert.equal((await request(path, { method: "PUT", token: ownerToken, body: { email: other.email } })).status, 409);
  for (const body of [{ role: "admin" }, { name: "Other name" }, { passwordHash: "blocked" }, { password: "blocked" }, { cabin: "privileged" }, { availableSlots: [] }, { departmentId: String(other._id) }, { timetable: {} }]) {
    assert.equal((await request(path, { method: "PUT", token: ownerToken, body })).status, 403);
  }
  const timetable = { Monday: [{ start: "09:00", end: "10:00", subject: "Synthetic subject" }] };
  assert.equal((await request(path + "/timetable", { method: "PUT", token: ownerToken, body: { timetable } })).status, 200);
  assert.equal((await request(`/api/faculty/${other._id}/timetable`, { method: "PUT", token: ownerToken, body: { timetable } })).status, 403);
  assert.equal((await request(`/api/faculty/${other._id}/timetable`, { token: ownerToken })).status, 403);
  assert.equal((await request(path + "/timetable")).status, 401);
  assert.equal((await request(path + "/timetable", { method: "PUT", token: ownerToken, body: { timetable: { Monday: [{ start: "25:00", end: "09:00" }] } } })).status, 400);
  const cleared = await request(path + "/timetable", { method: "PUT", token: ownerToken, body: { timetable: {} } });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).freeTime.Monday, ["9:00 AM - 5:00 PM"]);
});
test("admin CRUD works across all resource schemas and records safe audit entries", async () => {
  const fixtures = {
    departments: { name: "Synthetic department", code: "SYN", block: "Synthetic block", floor: "Ground" },
    poi: { type: "shop", name: "Synthetic shop", items: [{ name: "Synthetic item", price: "10", available: true }] },
    buses: { routeNumber: "SYN-1", stops: [{ name: "Synthetic stop", time: "9 AM" }] },
    events: { title: "Synthetic event", date: "2026-10-29" },
    faculty: { name: "Synthetic new faculty", email: "new@example.test", password: crypto.randomBytes(16).toString("hex") },
  };
  for (const [resource, body] of Object.entries(fixtures)) {
    const created = await request(`/api/${resource}`, { method: "POST", token: adminToken, body });
    assert.equal(created.status, 201);
    const record = await created.json();
    assert.equal(record.passwordHash, undefined);
    assert.equal(record.password, undefined);
    const change = resource === "events" ? { title: "Updated synthetic event" } : resource === "buses" ? { routeDescription: "Updated synthetic route" } : { name: "Updated synthetic name" };
    assert.equal((await request(`/api/${resource}/${record._id}`, { method: "PUT", token: adminToken, body: change })).status, 200);
    assert.equal((await request(`/api/${resource}/${record._id}`, { token: adminToken })).status, 200);
    assert.equal((await request(`/api/${resource}/${record._id}`, { method: "DELETE", token: adminToken })).status, 200);
    assert.equal((await request(`/api/${resource}/${record._id}`)).status, 404);
  }
  const logs = [...models.AuditLog.records.values()];
  assert.ok(logs.some((entry) => entry.status === "succeeded" && entry.actorRole === "faculty"));
  assert.ok(logs.some((entry) => entry.status === "succeeded" && entry.action === "delete"));
  for (const entry of logs) {
    assert.ok(entry.requestId);
    assert.ok(entry.fields.every((field) => !/password|token|secret/i.test(field)));
    assert.equal(entry.password, undefined);
    assert.equal(entry.token, undefined);
  }
});
test("unknown fields, MongoDB operators, invalid IDs/query values and invalid records are rejected", async () => {
  let nested = {};
  for (let depth = 0; depth < 30; depth++) nested = { nested };
  assert.equal((await request("/api/chat", { method: "POST", body: nested })).status, 400);
  for (const query of ["limit=201", "page=0", "page=101", "q=" + "x".repeat(101), "q[$ne]=x", "limit=1&limit=2", "$where=x", "sort=passwordHash", "unknown=x"]) {
    assert.equal((await request("/api/faculty?" + query)).status, 400);
  }
  for (const body of [{ name: "Synthetic", role: "admin" }, { $set: { onLeave: true } }, { "timetable.Monday": [] }, { passwordHash: "forbidden" }, JSON.parse('{"__proto__":{"role":"admin"}}')]) {
    assert.equal((await request(`/api/faculty/${owner._id}`, { method: "PUT", token: adminToken, body })).status, 400);
  }
  for (const resource of ["departments", "faculty", "poi", "buses", "events"]) assert.equal((await request(`/api/${resource}/not-an-id`)).status, 400);
  assert.equal((await request("/api/poi", { method: "POST", token: adminToken, body: { name: "Synthetic hostel", type: "hostel", totalRooms: 1, vacantRooms: 2 } })).status, 400);
  assert.equal((await request("/api/poi", { method: "POST", token: adminToken, body: { name: "Synthetic place", type: "block", latitude: 100 } })).status, 400);
  assert.equal((await request("/api/events", { method: "POST", token: adminToken, body: { title: "Synthetic", date: "2026-02-30" } })).status, 400);
});
test("public lists/details omit hostel private data and faculty login details even with an admin token", async () => {
  const hostel = await models.PointOfInterest.create({ type: "hostel", name: "Synthetic private hostel", warden: "Private warden", contact: "Private contact", totalRooms: 10, vacantRooms: 2 });
  for (const path of ["/api/poi", `/api/poi/${hostel._id}`]) {
    for (const token of [undefined, adminToken]) {
      const response = await request(path, { token });
      assert.equal(response.status, 200);
      const data = await response.json();
      const item = Array.isArray(data) ? data.find((row) => row._id === String(hostel._id)) : data;
      for (const key of ["warden", "contact", "totalRooms", "vacantRooms"]) assert.equal(item[key], undefined);
    }
  }
  assert.equal((await request("/api/poi?view=private")).status, 401);
  assert.equal((await request("/api/poi?view=private", { token: ownerToken })).status, 403);
  const privateHostel = await request(`/api/poi/${hostel._id}?view=private`, { token: adminToken });
  assert.equal((await privateHostel.json()).totalRooms, 10);
  const publicFaculty = await request(`/api/faculty/${owner._id}`);
  const faculty = await publicFaculty.json();
  for (const field of ["email", "password", "passwordHash", "timetable"]) assert.equal(faculty[field], undefined);
  const own = await request(`/api/faculty/${owner._id}?view=private`, { token: ownerToken });
  assert.equal((await own.json()).email, owner.email);
  const someoneElse = await request(`/api/faculty/${other._id}?view=private`, { token: ownerToken });
  assert.equal((await someoneElse.json()).email, undefined);
});
test("pagination preserves array responses and bounded literal search", async () => {
  for (const name of ["Synthetic [literal] One", "Synthetic [literal] Two", "Synthetic unrelated"]) await models.Department.create({ name, code: name, block: "Test", floor: "Ground" });
  const response = await request("/api/departments?limit=1&page=1&q=" + encodeURIComponent("[literal]"));
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.length, 1);
  assert.equal(response.headers.get("x-has-more"), "true");
  const next = await request("/api/departments?limit=1&page=2&q=" + encodeURIComponent("[literal]"));
  assert.equal(next.headers.get("x-has-more"), "false");
  assert.notEqual((await next.json())[0]._id, first[0]._id);
});
test("chat logs stay admin-only and logging failure preserves a successful answer", async () => {
  const response = await request("/api/chat", { method: "POST", body: { message: "Synthetic query" } });
  const result = await response.json(); assert.equal(result.answer, "Synthetic: Synthetic answer"); assert.equal(result.escalated, false); assert.equal(result.providerStatus, "local");
  const analytics = await request("/api/chat/analytics", { token: adminToken });
  assert.equal(analytics.status, 200);
  assert.equal((await analytics.json()).total, 1);
  const original = models.QueryLog.create;
  models.QueryLog.create = async () => { throw new Error("Synthetic persistence error"); };
  try {
    const retry = await request("/api/chat", { method: "POST", body: { message: "Synthetic query" } });
    assert.equal((await retry.json()).answer, "Synthetic: Synthetic answer");
  } finally { models.QueryLog.create = original; }
});
test("audit unavailability blocks writes before data changes", async () => {
  const original = models.AuditLog.create;
  const before = models.Department.writes;
  models.AuditLog.create = async () => { throw new Error("Synthetic audit outage"); };
  try {
    const response = await request("/api/departments", { method: "POST", token: adminToken, body: { name: "Blocked synthetic", code: "BLOCK", block: "Block", floor: "Ground" } });
    assert.equal(response.status, 503);
    assert.equal(models.Department.writes, before);
  } finally { models.AuditLog.create = original; }
});
test("local seed guards reject production, remote targets and unconfirmed resets", () => {
  const local = { NODE_ENV: "test", MONGODB_URI: "mongodb://127.0.0.1/synthetic_test" };
  assert.deepEqual(assertSeedSafety(local, ["--confirm-local"]), { reset: false });
  assert.deepEqual(assertSeedSafety(local, ["--confirm-local", "--reset", "--confirm-reset=DELETE_LOCAL_SEED_DATA"]), { reset: true });
  for (const env of [{ ...local, NODE_ENV: "production" }, { ...local, NODE_ENV: "" }, { ...local, MONGODB_URI: "mongodb://remote.example.test/synthetic_test" }, { ...local, MONGODB_URI: "mongodb://127.0.0.1/production" }, { ...local, MONGODB_URI: "mongodb+srv://remote.example.test/synthetic_test" }, { ...local, MONGODB_URI: local.MONGODB_URI + "?replicaSet=remote" }]) assert.throws(() => assertSeedSafety(env, ["--confirm-local"]));
  assert.throws(() => assertSeedSafety(local, []));
  assert.throws(() => assertSeedSafety(local, ["--confirm-local", "--reset"]));
});
test("insert-only seed upserts are idempotent and preserve owner edits", async () => {
  const body = { name: "Original synthetic seed", code: "SEED-SYN", block: "Block", floor: "Ground" };
  const [first] = await insertSeed(models.Department, [body]);
  first.name = "Owner edited synthetic";
  await first.save();
  const size = models.Department.records.size;
  const [second] = await insertSeed(models.Department, [body]);
  assert.equal(String(second._id), String(first._id));
  assert.equal(second.name, "Owner edited synthetic");
  assert.equal(models.Department.records.size, size);
  assert.equal(second.$locals.seedInserted, false);
});
test("login/chat rate limits return 429 and proxy trust remains disabled", async () => {
  const limitedApp = createApp({ models, audit: createAuditor(models.AuditLog), services, limits: { login: 2, chat: 2 } });
  assert.equal(limitedApp.get("trust proxy"), false);
  const limited = limitedApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => limited.once("listening", resolve));
  try {
    for (const path of ["/api/auth/login", "/api/chat"]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(`http://127.0.0.1:${limited.address().port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        assert.equal(response.status, attempt < 2 ? 400 : 429);
        if (attempt === 2) assert.ok(response.headers.get("retry-after"));
      }
    }
  } finally { await new Promise((resolve) => limited.close(resolve)); }
});
test("central errors do not disclose driver/provider messages or query data", async () => {
  const original = models.Department.find;
  models.Department.find = () => { throw new Error("Synthetic sensitive driver details"); };
  try {
    const response = await request("/api/departments");
    assert.equal(response.status, 500);
    const data = await response.json();
    assert.equal(data.error, "The service could not complete this request");
    assert.ok(data.requestId);
  } finally { models.Department.find = original; }
});
test("AI retrieval uses public projections even if persistence returns private fields", async () => {
  const { publicCollection } = require("../src/services/campusDataService");
  const faculty = await publicCollection(models.Faculty);
  assert.ok(faculty.length);
  for (const item of faculty) for (const field of ["email", "passwordHash", "timetable"]) assert.equal(item[field], undefined);
  const pois = await publicCollection(models.PointOfInterest);
  for (const item of pois) for (const field of ["contact", "warden", "totalRooms", "vacantRooms"]) assert.equal(item[field], undefined);
});
