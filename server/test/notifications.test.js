const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = require("node:crypto").randomBytes(32).toString("hex");
process.env.CLIENT_ORIGIN = "http://localhost:5173";
const { createApp } = require("../src/server");
const { memoryModel } = require("../test-support/memoryModels");
const { createAuditor } = require("../src/services/auditService");
const { createNotificationService, subscriptionBody } = require("../src/services/notifications");
const { signToken } = require("../src/middleware/auth");
const pushKeys = require("web-push").generateVAPIDKeys();
const models = Object.fromEntries(["Notification", "NotificationReceipt", "PushSubscription", "NotificationDelivery", "Event", "AuditLog", "Faculty", "ShopOwner"].map(name => [name, memoryModel(name)]));
const time = new Date("2030-01-02T06:00:00Z"), now = () => new Date(time), verification = { status: "verified", source: "Synthetic official test fixture", verifiedAt: "2020-01-01T00:00:00Z" };
const body = extra => ({ title: "Synthetic campus notice", body: "Synthetic verified content", type: "announcement", audience: "public", status: "scheduled", scheduledAt: "2030-01-02T05:00:00Z", expiresAt: "2030-01-03T05:00:00Z", timezone: "Asia/Kolkata", verification, ...extra });
const admin = signToken({ role: "admin", sub: "synthetic-admin" }), faculty = signToken({ role: "faculty", sub: "000000000000000000000001" }), otherFaculty = signToken({ role: "faculty", sub: "000000000000000000000002" });
let server, base;
before(async () => {
  await models.Faculty.create({ _id: "000000000000000000000001", name: "Synthetic faculty one" });
  await models.Faculty.create({ _id: "000000000000000000000002", name: "Synthetic faculty two" });
  server = createApp({ models, audit: createAuditor(models.AuditLog), services: { notifications: { now } }, limits: { push: 100 } }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${server.address().port}/api/notifications`;
});
after(() => new Promise(resolve => server.close(resolve)));
const request = (path = "", method = "GET", value, token) => fetch(base + path, { method, signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
async function create(extra) { const response = await request("/admin", "POST", body(extra), admin); assert.equal(response.status, 201, await response.clone().text()); return response.json(); }

test("admin-only management rejects guests and faculty without changing records", async () => {
  const writes = models.Notification.writes;
  assert.equal((await request("/admin")).status, 401);
  assert.equal((await request("/admin", "POST", body())).status, 401);
  assert.equal((await request("/admin", "POST", body(), faculty)).status, 403);
  assert.equal(models.Notification.writes, writes);
  assert.equal((await request("", "GET", undefined, signToken({ role: "faculty", sub: "000000000000000000000099" }))).status, 403);
  assert.equal((await request("", "GET", undefined, signToken({ role: "driver", sub: "000000000000000000000099" }))).status, 403);
});
test("scheduled visibility is derived from durable timestamps, verification, expiry and audience", async () => {
  const publicNote = await create({ title: "Synthetic public" });
  const privateNote = await create({ title: "Synthetic faculty only", audience: "faculty" });
  const personal = await create({ title: "Synthetic personal", audience: "recipient", recipient: "faculty:000000000000000000000001" });
  await create({ title: "Synthetic future", scheduledAt: "2030-01-03T01:00:00Z" });
  await create({ title: "Synthetic expired", scheduledAt: "2029-01-01T00:00:00Z", expiresAt: "2029-01-02T00:00:00Z" });
  await create({ title: "Synthetic draft", status: "draft", verification: { status: "unverified" } });
  const guest = await (await request()).json();
  assert.ok(guest.items.some(item => item._id === publicNote._id));
  assert.ok(!JSON.stringify(guest).includes("Synthetic faculty only"));
  assert.ok(!JSON.stringify(guest).includes("Synthetic personal"));
  assert.ok(!JSON.stringify(guest).includes("Synthetic future"));
  assert.ok(!JSON.stringify(guest).includes("Synthetic expired"));
  const afterRestart = createNotificationService({ models, now: () => new Date("2030-01-03T02:00:00Z") });
  assert.ok((await afterRestart.list(undefined, 1, 20)).items.some(item => item.title === "Synthetic future"));
  const mine = await (await request("", "GET", undefined, faculty)).json();
  assert.ok(mine.items.some(item => item._id === privateNote._id));
  assert.ok(mine.items.some(item => item._id === personal._id));
  const theirs = await (await request("", "GET", undefined, otherFaculty)).json();
  assert.ok(!theirs.items.some(item => item._id === personal._id));
  assert.equal((await request(`/${personal._id}/read`, "PUT", { read: true }, otherFaculty)).status, 404);
});
test("read/unread updates are scoped, idempotent and require authentication", async () => {
  const note = await create({ title: "Synthetic read test" });
  assert.equal((await request(`/${note._id}/read`, "PUT", { read: true })).status, 401);
  for (let index = 0; index < 2; index++) assert.equal((await request(`/${note._id}/read`, "PUT", { read: true }, faculty)).status, 200);
  const mine = await (await request("", "GET", undefined, faculty)).json(), theirs = await (await request("", "GET", undefined, otherFaculty)).json();
  assert.ok(mine.items.find(item => item._id === note._id).readAt);
  assert.equal(theirs.items.find(item => item._id === note._id).readAt, null);
  assert.equal(await models.NotificationReceipt.countDocuments({ notificationId: note._id }), 1);
  assert.equal((await request(`/${note._id}/read`, "PUT", { read: false }, faculty)).status, 200);
});
test("draft edit/schedule/cancel preserves history and audit without mass assignment", async () => {
  const note = await create({ title: "Synthetic editable", status: "draft" });
  assert.equal((await request(`/admin/${note._id}`, "PUT", body({ title: "Synthetic scheduled" }), admin)).status, 200);
  assert.equal((await request(`/admin/${note._id}`, "PUT", body({ title: "Unexpected mutation" }), admin)).status, 409);
  assert.equal((await request(`/admin/${note._id}/cancel`, "POST", {}, admin)).status, 200);
  assert.equal((await models.Notification.findById(note._id)).status, "cancelled");
  assert.ok(!(await (await request()).json()).items.some(item => item._id === note._id));
  assert.ok((await models.AuditLog.find({ resource: "Notification" })).length >= 3);
});
test("invalid dates, unverified publication, unsafe keys, IDs and queries are rejected", async () => {
  for (const extra of [{ verification: { status: "unverified" } }, { scheduledAt: "2030-01-01T12:00" }, { expiresAt: "2020-01-01T00:00:00Z" }, { createdBy: "spoofed" }, { type: "deadline" }, { audience: "recipient" }, { eventId: "bad" }, { verification: { ...verification, verifiedAt: "2099-01-01T00:00:00Z" } }]) assert.equal((await request("/admin", "POST", body(extra), admin)).status, 400);
  for (const query of ["?page=0", "?limit=1000", "?page[$gt]=1", "?unknown=1"]) assert.equal((await request(query)).status, 400);
  assert.equal((await request("/bad/read", "PUT", { read: true }, faculty)).status, 400);
});
test("linked events require official timestamps and are withdrawn if verification or schedule changes", async () => {
  const event = await models.Event.create({ title: "Synthetic event", date: "2030-01-03", startsAt: "2030-01-03T05:00:00Z", verification });
  const note = await create({ type: "event", eventId: String(event._id), occursAt: "2030-01-03T05:00:00Z" });
  assert.ok((await (await request()).json()).items.some(item => item._id === note._id));
  event.verification.status = "unverified"; await event.save();
  assert.ok(!(await (await request()).json()).items.some(item => item._id === note._id));
  assert.equal((await request("/admin", "POST", body({ type: "event", eventId: String(event._id), occursAt: "2030-01-03T05:00:00Z" }), admin)).status, 400);
});
test("event CRUD preserves legacy records while verified timestamps require offsets and matching campus dates", async () => {
  const endpoint = base.replace(/\/notifications$/, "/events");
  const post = value => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` }, body: JSON.stringify(value) });
  const valid = { title: "Synthetic verified midnight", date: "2030-01-02", startsAt: "2030-01-01T18:30:00Z", verification };
  assert.equal((await post(valid)).status, 201);
  assert.equal((await post({ ...valid, date: "2030-01-01" })).status, 400);
  assert.equal((await post({ ...valid, startsAt: "2030-01-02T00:00:00" })).status, 400);
  assert.equal((await post({ ...valid, endsAt: "2030-01-01T17:00:00Z" })).status, 400);
  const legacy = await post({ title: "Synthetic legacy preserved", date: "2030-01-02", startTime: "Legacy display time" });
  assert.equal(legacy.status, 201); assert.equal((await legacy.json()).verification.status, "unverified");
});
test("push is opt-in, disabled by default, and refuses arbitrary endpoint destinations", async () => {
  assert.deepEqual(await (await request("/push/config")).json(), { enabled: false, publicKey: null, audience: "public" });
  assert.equal((await request("/push/subscribe", "POST", {})).status, 503);
  for (const endpoint of ["https://127.0.0.1/", "http://fcm.googleapis.com/send/one", "https://fcm.googleapis.com.evil.test/", "https://user:pass@fcm.googleapis.com/send/one"]) assert.throws(() => subscriptionBody({ endpoint, keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) }, consent: true, deviceToken: "a".repeat(64) }));
});
test("missing retention indexes fail closed before storing account read metadata", async () => {
  const note = await create({ title: "Synthetic retention test" }), original = models.NotificationReceipt.listIndexes;
  models.NotificationReceipt.listIndexes = async () => [{ key: { notificationId: 1, recipient: 1 }, unique: true }];
  try { assert.equal((await request(`/${note._id}/read`, "PUT", { read: true }, faculty)).status, 503); }
  finally { models.NotificationReceipt.listIndexes = original; }
});
test("push subscription consent and opt-out are device scoped; keys stay out of responses", async () => {
  const env = { WEB_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: pushKeys.publicKey, VAPID_PRIVATE_KEY: pushKeys.privateKey, VAPID_SUBJECT: "mailto:synthetic@example.test" };
  const service = createNotificationService({ models, env, now });
  const payload = { endpoint: "https://fcm.googleapis.com/send/synthetic", keys: { p256dh: "C".repeat(87), auth: "D".repeat(22) }, consent: true, deviceToken: "a".repeat(64) };
  await service.subscribe(payload);
  await assert.rejects(service.subscribe({ ...payload, deviceToken: "b".repeat(64) }), error => error.status === 409);
  await service.unsubscribe({ endpoint: payload.endpoint, deviceToken: "b".repeat(64) });
  assert.equal((await models.PushSubscription.findOne({})).enabled, true);
  await service.unsubscribe({ endpoint: payload.endpoint, deviceToken: payload.deviceToken });
  assert.equal(await models.PushSubscription.findOne({}), null);
});
test("durable push claims survive service restarts; failed/ambiguous sends are not retried", async () => {
  const { Notification: N, NotificationDelivery: D, PushSubscription: S } = models;
  N.records.clear(); D.records.clear(); S.records.clear();
  // Simulate Mongo's unique insert atomically in this persistence double.
  const create = D.create.bind(D);
  D.create = async value => {
    const input = Array.isArray(value) ? value[0] : value;
    if ([...D.records.values()].some(row => String(row.notificationId) === String(input.notificationId) && String(row.subscriptionId) === String(input.subscriptionId))) { const error = new Error("duplicate"); error.code = 11000; throw error; }
    return create(value);
  };
  const note = await N.create({ ...body(), createdBy: "synthetic" });
  await S.create({ endpoint: "https://fcm.googleapis.com/send/synthetic-job", endpointHash: "synthetic-job", keys: { p256dh: "C".repeat(87), auth: "D".repeat(22) }, owner: "synthetic", consentedAt: "2030-01-01T00:00:00Z", expiresAt: "2030-02-01T00:00:00Z" });
  const env = { WEB_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: pushKeys.publicKey, VAPID_PRIVATE_KEY: pushKeys.privateKey, VAPID_SUBJECT: "mailto:synthetic@example.test" };
  let sends = 0;
  const sendPush = async (_subscription, raw) => { sends++; const payload = JSON.parse(raw); assert.ok(!raw.includes(note.title)); assert.equal(payload.url, "/notifications"); };
  await createNotificationService({ models, env, now, sendPush }).tick();
  await createNotificationService({ models, env, now, sendPush }).tick();
  assert.equal(sends, 1); assert.equal((await D.findOne({})).status, "accepted");
  await N.create({ ...body({ title: "Synthetic outage" }), createdBy: "synthetic" });
  const failing = createNotificationService({ models, env, now, sendPush: async () => { sends++; throw new Error("Synthetic failure"); } });
  await failing.tick(); await failing.tick();
  assert.equal(sends, 2); assert.ok((await D.find({ status: "failed" })).length);
  D.create = create;
});
