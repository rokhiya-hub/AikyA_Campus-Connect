const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const crypto = require("node:crypto");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_ORIGIN = "http://localhost:5173";
const { createApp } = require("../src/server");
const Faculty = require("../src/models/Faculty");
const { availabilityFor, dayAvailability, scheduleErrors, weeklyLabels } = require("../src/services/facultyAvailability");
const { planBuildingLinks, applyBuildingLinkPlan } = require("../src/services/buildingLinks");
const { serialize } = require("../src/services/publicData");
const { memoryModel } = require("../test-support/memoryModels");
const { createAuditor } = require("../src/services/auditService");
const { signToken } = require("../src/middleware/auth");
const models = Object.fromEntries(["Faculty", "Department", "PointOfInterest", "BusRoute", "Event", "QueryLog", "AuditLog"].map((name) => [name, memoryModel(name)]));
let server, base, owner, building;
const admin = signToken({ role: "admin", sub: "synthetic-admin" });
let token;
before(async () => {
  building = await models.PointOfInterest.create({ name: "Synthetic North Block", type: "block", latitude: 17, longitude: 82, allocation: { status: "Verified" } });
  owner = await models.Faculty.create({ name: "Synthetic Ada", departmentName: "Computing", cabin: "R201", block: building.name, buildingId: building._id });
  token = signToken({ role: "faculty", sub: String(owner._id) });
  server = createApp({ models, audit: createAuditor(models.AuditLog), limits: { login: 100, chat: 100 } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
const request = (path, method = "GET", body, bearer) => fetch(base + path, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const schedule = {
  timetable: { Monday: [{ start: "09:00", end: "10:00" }], Tuesday: [{ start: "10:00", end: "11:00" }] },
  teachingWindows: { Monday: [{ start: "09:00", end: "12:00" }], Tuesday: [{ start: "09:00", end: "12:00" }] },
};
test("free periods are calculated independently per weekday, including short gaps", () => {
  assert.deepEqual(dayAvailability(schedule, "Monday").freePeriods, [{ start: "10:00", end: "12:00" }]);
  assert.deepEqual(dayAvailability(schedule, "Tuesday").freePeriods, [{ start: "09:00", end: "10:00" }, { start: "11:00", end: "12:00" }]);
  assert.equal(dayAvailability(schedule, "Wednesday").status, "unknown");
  assert.ok(weeklyLabels(schedule).includes("Monday: 10:00 AM - 12:00 PM"));
  assert.ok(weeklyLabels(schedule).includes("Tuesday: 9:00 AM - 10:00 AM"));
  const short = { timetable: { Monday: [{ start: "09:00", end: "09:30" }, { start: "10:00", end: "17:00" }] } };
  assert.deepEqual(dayAvailability(short, "Monday").freePeriods, [{ start: "09:30", end: "10:00" }]);
});
test("availability timestamps distinguish calculation from source updates and never assert presence", () => {
  const now = new Date("2026-10-26T04:45:00Z");
  const result = availabilityFor(schedule, now);
  assert.equal(result.day, "Monday");
  assert.equal(result.currentStatus, "free_in_timetable");
  assert.equal(result.calculatedAt, now.toISOString());
  assert.equal(result.sourceUpdatedAt, null);
  assert.equal(result.presence, "not_tracked");
  assert.equal(availabilityFor(schedule, new Date("2026-10-25T18:45:00Z")).day, "Monday");
  assert.equal(availabilityFor(schedule, new Date("2026-10-25T18:45:00Z")).currentStatus, "outside_teaching_window");
});
test("strict HH:MM, overlaps, window boundaries and leave rules apply in Mongoose", async () => {
  for (const slots of [
    [{ start: "9:00", end: "10:00" }], [{ start: "24:00", end: "25:00" }], [{ start: "10:60", end: "11:00" }],
    [{ start: "10:00", end: "09:00" }], [{ start: "09:00", end: "10:30" }, { start: "10:00", end: "11:00" }],
    [{ start: "08:30", end: "10:00" }],
  ]) await assert.rejects(new Faculty({ name: "Synthetic invalid", timetable: { Monday: slots } }).validate());
  assert.ok(scheduleErrors({ timetable: { Monday: [] }, teachingWindows: { Monday: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "17:00" }] } }).length);
  const split = { timetable: { Monday: [] }, teachingWindows: { Monday: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] } };
  assert.deepEqual(dayAvailability(split, "Monday").freePeriods, split.teachingWindows.Monday);
  for (const day of ["Monday", "Tuesday", "Wednesday"]) assert.deepEqual(dayAvailability({ ...schedule, onLeave: true }, day).freePeriods, []);
  assert.equal(dayAvailability({ timetable: { Monday: [{ start: "bad", end: "17:00" }] } }, "Monday").status, "invalid");
});
test("faculty search API supports name, department, cabin, block and multiword queries", async () => {
  for (const query of ["Ada", "Computing", "R201", "North", "Ada North"]) {
    const response = await request("/api/faculty?q=" + encodeURIComponent(query));
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0]._id, String(owner._id));
  }
});
test("public day-specific summaries and private timetable updates retain owner permissions", async () => {
  const path = `/api/faculty/${owner._id}/timetable`;
  const changed = await request(path, "PUT", { timetable: schedule.timetable }, token);
  assert.equal(changed.status, 200);
  const result = await changed.json();
  assert.deepEqual(result.freeTime.Monday, ["10:00 AM - 5:00 PM"]);
  assert.deepEqual(result.freeTime.Tuesday, ["9:00 AM - 10:00 AM", "11:00 AM - 5:00 PM"]);
  assert.ok(Number.isFinite(Date.parse(result.availability.sourceUpdatedAt)));
  assert.ok(Date.parse(result.availability.sourceUpdatedAt) <= Date.parse(result.availability.calculatedAt));
  const unchanged = await (await request(path, "PUT", { timetable: schedule.timetable }, token)).json();
  assert.equal(unchanged.availability.sourceUpdatedAt, result.availability.sourceUpdatedAt);
  const pub = await request(`/api/faculty/${owner._id}`);
  const publicData = await pub.json();
  assert.equal(publicData.timetable, undefined);
  assert.ok(publicData.availability.byDay.Monday.freePeriods.length);
  for (const timetable of [{ Monday: [{ start: "09:00", end: "11:00" }, { start: "10:00", end: "12:00" }] }, { Monday: [{ start: "08:00", end: "09:00" }] }]) {
    assert.equal((await request(path, "PUT", { timetable }, token)).status, 400);
  }
  assert.equal((await request(`/api/faculty/${owner._id}`, "PUT", { teachingWindows: {} }, token)).status, 403);
  assert.equal((await request(`/api/faculty/${owner._id}`, "PUT", { onLeave: true }, token)).status, 200);
  const leave = await (await request(`/api/faculty/${owner._id}`)).json();
  assert.equal(leave.availability.currentStatus, "on_leave");
  assert.ok(Object.values(leave.availability.byDay).every((day) => !day.freePeriods.length));
  const windows = { Monday: [{ start: "09:00", end: "12:00" }] };
  assert.equal((await request(`/api/faculty/${owner._id}`, "PUT", { teachingWindows: windows }, admin)).status, 200);
  const withWindows = await (await request(path, "GET", undefined, token)).json();
  assert.deepEqual(withWindows.teachingWindows.Monday, windows.Monday);
});
test("building IDs validate reference targets, survive renamed labels and prevent orphan deletion", async () => {
  const body = { name: "Synthetic department", code: "SYN", floor: "4th Floor", block: building.name, buildingId: String(building._id) };
  const created = await request("/api/departments", "POST", body, admin);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).buildingId, String(building._id));
  assert.equal((await request("/api/departments", "POST", { ...body, code: "BAD", buildingId: "000000000000000000000001" }, admin)).status, 400);
  assert.equal((await request("/api/departments", "POST", { ...body, code: "BAD", block: "Another block" }, admin)).status, 400);
  assert.equal((await request(`/api/poi/${building._id}`, "PUT", { name: "Renamed synthetic building" }, admin)).status, 200);
  assert.equal((await request(`/api/poi/${building._id}`, "DELETE", undefined, admin)).status, 409);
  assert.equal((await request(`/api/poi/${building._id}`, "PUT", { type: "shop" }, admin)).status, 409);
  assert.equal((await request(`/api/faculty/${owner._id}`, "PUT", { buildingId: String(building._id) }, token)).status, 403);
});
test("legacy coordinates and allocations remain unverified without an official source/date", async () => {
  const legacy = serialize("PointOfInterest", { _id: "legacy", type: "block", name: "Synthetic", latitude: 17, longitude: 82, allocation: { status: "Verified" } });
  assert.equal(legacy.coordinateVerification.status, "unverified");
  assert.equal(legacy.allocation.verification.status, "unverified");
  const invalid = await request("/api/poi", "POST", { type: "block", name: "Unverified synthetic", coordinateVerification: { status: "verified" } }, admin);
  assert.equal(invalid.status, 400);
});
test("migration dry-run only proposes exact, unambiguous missing links and preserves existing IDs", () => {
  const pois = [{ _id: "a", type: "block", name: "North Block" }, { _id: "b", type: "block", name: "North Annex" }];
  const record = { _id: "dept", block: "North Block" };
  const plan = planBuildingLinks(pois, { Department: [record, { _id: "partial", block: "North" }, { _id: "existing", block: "Old label", buildingId: "b" }] });
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].buildingId, "a");
  assert.equal(record.buildingId, undefined);
  assert.equal(plan.unresolved[0].reason, "no_exact_match");
  assert.equal(planBuildingLinks([...pois, { _id: "duplicate", type: "block", name: "North Block" }], { Department: [record] }).unresolved[0].reason, "ambiguous");
});
test("reviewed migration apply is idempotent, audited and skips stale source labels", async () => {
  const target = await models.PointOfInterest.create({ type: "block", name: "Migration fixture block" });
  const record = await models.Department.create({ name: "Migration fixture department", code: "MIG", block: target.name, floor: "Ground" });
  const stale = await models.Department.create({ name: "Stale fixture department", code: "STALE", block: "Edited by owner", floor: "Ground" });
  const plan = { changes: [{ model: "Department", id: String(record._id), expectedBlock: target.name, buildingId: String(target._id) }, { model: "Department", id: String(stale._id), expectedBlock: "Original label", buildingId: String(target._id) }] };
  let audits = 0;
  const audit = async (_link, operation) => { audits++; return operation(); };
  assert.deepEqual(await applyBuildingLinkPlan(plan, models, audit), { changed: 1, skipped: 1 });
  assert.equal(String((await models.Department.findById(record._id)).buildingId), String(target._id));
  assert.equal((await models.Department.findById(stale._id)).buildingId, undefined);
  assert.equal(audits, 1);
  assert.deepEqual(await applyBuildingLinkPlan(plan, models, audit), { changed: 0, skipped: 2 });
});
