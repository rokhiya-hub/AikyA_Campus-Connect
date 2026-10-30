const express = require("express");
const bcrypt = require("bcryptjs");
const DefaultFaculty = require("../models/Faculty");
const { DAYS } = DefaultFaculty;
const { requireAuth, optionalAuth, adminOnly } = require("../middleware/auth");
const { HttpError, asyncRoute } = require("../middleware/errors");
const { z, recordBody, checkRecord, selfFields, parse, validateId, validateQuery, querySchema, timetableBody } = require("../validation");
const { validateBuildingLink } = require("../services/buildingLinks");
const { listCollection, findRecord, privateView } = require("../services/collectionService");
const { serialize } = require("../services/publicData");
const { createAuditor } = require("../services/auditService");

function ownerOrAdmin(req, res, next) {
  if (req.admin.role === "admin" || (req.admin.role === "faculty" && req.admin.sub === req.params.id)) return next();
  next(new HttpError(403, "You can only modify your own faculty account"));
}
function timetableResponse(item) {
  const timetable = {};
  const freeTime = {};
  for (const day of DAYS) {
    const slots = item.timetable?.get?.(day) || item.timetable?.[day] || [];
    timetable[day] = slots.map(({ start, end, subject, room }) => ({ start, end, subject, room }));
    freeTime[day] = item.freeTimeFor(day);
  }
  return { name: item.name, departmentName: item.departmentName, onLeave: item.onLeave, timetable, freeTime, availability: item.availabilityAt(), teachingWindows: item.toObject({ flattenMaps: true }).teachingWindows, availableSlots: item.weeklyFreeTime() };
}
function scheduleSnapshot(item) {
  const source = item.toObject({ flattenMaps: true });
  return JSON.stringify({ timetable: source.timetable, teachingWindows: source.teachingWindows, onLeave: source.onLeave });
}
async function checkEmail(Faculty, email, currentId) {
  if (!email) return;
  const existing = await Faculty.findOne({ email }).select("_id").maxTimeMS(3000);
  if (existing && String(existing._id) !== String(currentId)) throw new HttpError(409, "Email is already assigned to another faculty account");
}
function createFacultyRouter(Faculty = DefaultFaculty, audit = createAuditor(), models = { PointOfInterest: require("../models/PointOfInterest") }) {
  const router = express.Router();
  router.get("/", optionalAuth, validateQuery(querySchema()), privateView(true), asyncRoute((req, res) =>
    listCollection(Faculty, req, res, ["name", "departmentName", "designation", "cabin", "block"])));
  router.get("/:id", optionalAuth, validateId, validateQuery(z.strictObject({ view: z.enum(["public", "private"]).optional().default("public") })), privateView(true), asyncRoute(async (req, res) =>
    res.json(serialize("Faculty", await findRecord(Faculty, req.params.id), req.validQuery.view === "private" ? req.admin : undefined))));
  // Detailed schedules are private to the owner/admin; public directory keeps availability.
  router.get("/:id/timetable", requireAuth, validateId, ownerOrAdmin, validateQuery(), asyncRoute(async (req, res) =>
    res.json(timetableResponse(await findRecord(Faculty, req.params.id)))));
  router.post("/", adminOnly, validateQuery(), asyncRoute(async (req, res) => {
    const body = recordBody("Faculty", req.body);
    checkRecord("Faculty", body);
    await validateBuildingLink(body, models, body);
    await checkEmail(Faculty, body.email);
    const password = body.password;
    delete body.password;
    if (password) body.passwordHash = await bcrypt.hash(password, 12);
    const item = await audit(req, "Faculty", "create", Object.keys(body), async () => {
      const document = new Faculty(body);
      if (body.timetable || body.teachingWindows || body.onLeave) document.timetableUpdatedAt = new Date();
      document.refreshAvailability();
      return document.save();
    });
    res.status(201).json(serialize("Faculty", item, req.admin));
  }));
  router.put("/:id", requireAuth, validateId, ownerOrAdmin, validateQuery(), asyncRoute(async (req, res) => {
    const self = req.admin.role !== "admin";
    if (self && Object.keys(req.body || {}).some((field) => !selfFields.includes(field))) throw new HttpError(403, "Privileged profile fields require admin access");
    const changes = recordBody("Faculty", req.body, { partial: true, self });
    await checkEmail(Faculty, changes.email, req.params.id);
    const item = await findRecord(Faculty, req.params.id);
    const previousSchedule = scheduleSnapshot(item);
    if (changes.password) item.passwordHash = await bcrypt.hash(changes.password, 12);
    delete changes.password;
    item.set(changes);
    checkRecord("Faculty", item);
    await validateBuildingLink(item, models, changes);
    if (scheduleSnapshot(item) !== previousSchedule) {
      item.timetableUpdatedAt = new Date();
      item.refreshAvailability();
    }
    await audit(req, "Faculty", "update", Object.keys(changes), () => item.save());
    res.json(serialize("Faculty", item, req.admin));
  }));
  router.put("/:id/timetable", requireAuth, validateId, ownerOrAdmin, validateQuery(), asyncRoute(async (req, res) => {
    const body = parse(timetableBody, req.body);
    const incoming = body.timetable || body;
    const item = await findRecord(Faculty, req.params.id);
    const previousSchedule = scheduleSnapshot(item);
    item.timetable = Object.fromEntries(DAYS.map((day) => [day, incoming[day] || []]));
    if (body.onLeave !== undefined) item.onLeave = body.onLeave;
    checkRecord("Faculty", item);
    if (scheduleSnapshot(item) !== previousSchedule) item.timetableUpdatedAt = new Date();
    item.refreshAvailability({ force: true });
    await audit(req, "Faculty", "timetable", ["timetable", ...(body.onLeave !== undefined ? ["onLeave"] : [])], () => item.save());
    res.json(timetableResponse(item));
  }));
  router.delete("/:id", adminOnly, validateId, validateQuery(), asyncRoute(async (req, res) => {
    await findRecord(Faculty, req.params.id);
    await audit(req, "Faculty", "delete", [], () => Faculty.findByIdAndDelete(req.params.id));
    res.json({ success: true });
  }));
  return router;
}
module.exports = createFacultyRouter;
