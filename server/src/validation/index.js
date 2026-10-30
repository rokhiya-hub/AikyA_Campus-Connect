const { z } = require("zod");
const { HttpError } = require("../middleware/errors");
const { DAYS: days, scheduleErrors } = require("../services/facultyAvailability");
const text = (max = 300) => z.string().trim().max(max).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/, "Invalid control characters");
const required = text().min(1);
const email = z.union([z.email().max(254), z.literal("")]);
const id = z.string().regex(/^[a-fA-F0-9]{24}$/).transform((value) => value.toLowerCase());
const list = z.array(text()).max(100);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const slot = z.strictObject({ start: time, end: time, subject: text().optional(), room: text().optional() })
  .refine((value) => value.start < value.end, "Slot end must be after start");
const timetable = z.strictObject(Object.fromEntries(days.map((day) => [day, z.array(slot).max(20).optional()])));
const teachingWindows = z.strictObject(Object.fromEntries(days.map((day) => [day, z.array(z.strictObject({ start: time, end: time })).max(5).optional()])));
const verification = z.strictObject({ status: z.enum(["unverified", "verified"]), source: text(1000).optional(), verifiedAt: z.iso.datetime().optional() });
const password = z.string().min(12).refine((value) => Buffer.byteLength(value) <= 72, "Password exceeds bcrypt limit");
const shapes = {
  Department: { name: required, code: required, block: required, buildingId: id.nullable().optional(), locationVerification: verification.optional(), floor: required, hod: text().optional(), labs: list.optional(), contactEmail: email.optional(), officeHours: text().optional() },
  Faculty: { name: required, departmentId: id.nullable().optional(), buildingId: id.nullable().optional(), locationVerification: verification.optional(), departmentName: text().optional(), designation: text().optional(), cabin: text().optional(), block: text().optional(), floor: text().optional(), email: email.optional(), subjects: list.optional(), onLeave: z.boolean().optional(), availableSlots: list.optional(), timetable: timetable.optional(), teachingWindows: teachingWindows.optional(), password: password.optional() },
  PointOfInterest: {
    type: z.enum(["shop", "hostel", "block", "library", "office", "ground", "service"]), name: required,
    block: text().optional(), floor: text().optional(), area: text().optional(), areaGroup: text().optional(),
    buildingId: id.nullable().optional(), coordinateVerification: verification.optional(),
    latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
    openHours: text().optional(), isOpenNow: z.boolean().optional(), description: text(4000).optional(),
    items: z.array(z.strictObject({ name: required, price: text(100).optional(), available: z.boolean().optional() })).max(200).optional(),
    hostelType: z.enum(["boys", "girls"]).nullable().optional(), warden: text().optional(), contact: text().optional(),
    totalRooms: z.number().int().min(0).max(100000).optional(), vacantRooms: z.number().int().min(0).max(100000).optional(),
    accessPolicy: z.strictObject({ allowedRoles: list.optional(), restrictedRoles: list.optional(), startTime: time.optional(), endTime: time.optional(), note: text(2000).optional() }).optional(),
    allocation: z.strictObject({ institution: text().optional(), branches: list.optional(), years: text().optional(), status: text().optional(), verification: verification.optional() }).optional(),
  },
  BusRoute: { trackingEnabled: z.boolean().optional(), vehicleLabel: text(100).optional(), routeNumber: required, routeDescription: text(2000).optional(), stops: z.array(z.strictObject({ name: required, time: text(50).optional() })).max(100).optional(), departureTime: text(50).optional(), returnTime: text(50).optional(), driverName: text().optional(), driverContact: text().optional(), busType: text().optional(), ground: text().optional(), status: text().optional() },
  Event: { title: required, description: text(4000).optional(), date: z.iso.date(), startTime: text(50).optional(), endTime: text(50).optional(), venue: text().optional(), organizer: text().optional(), department: text().optional(), category: text().optional(), startsAt: z.iso.datetime({ offset: true }).nullable().optional(), endsAt: z.iso.datetime({ offset: true }).nullable().optional(), deadlineAt: z.iso.datetime({ offset: true }).nullable().optional(), timezone: z.literal("Asia/Kolkata").optional(), verification: verification.optional() },
};
const selfFields = ["designation", "email", "subjects", "onLeave"];
function rejectUnsafeKeys(value, depth = 0) {
  if (depth > 20) throw new HttpError(400, "Request data is nested too deeply");
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".") || ["__proto__", "prototype", "constructor"].includes(key)) throw new HttpError(400, "Invalid field name");
    rejectUnsafeKeys(value[key], depth + 1);
  }
}
function parse(schema, value) { rejectUnsafeKeys(value); return schema.parse(value); }
function recordBody(modelName, value, { partial = false, self = false } = {}) {
  const shape = self ? Object.fromEntries(selfFields.map((field) => [field, shapes.Faculty[field]])) : shapes[modelName];
  let schema = z.strictObject(shape);
  if (partial) schema = schema.partial().refine((body) => Object.keys(body).length > 0, "No changes supplied");
  return parse(schema, value);
}
function checkRecord(modelName, document) {
  if (modelName === "Event" && document.verification?.status === "verified") {
    if (!document.startsAt || !Number.isFinite(new Date(document.startsAt).getTime()) || document.endsAt && new Date(document.endsAt) <= new Date(document.startsAt)) throw new HttpError(400, "Verified events require valid start and end timestamps");
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(document.startsAt));
    if (localDate !== document.date) throw new HttpError(400, "Event date must match the Asia/Kolkata start date");
  }
  if (modelName === "Faculty" && scheduleErrors(document).length) throw new HttpError(400, "Invalid timetable: check weekday times, overlaps and teaching windows");
  if (modelName === "PointOfInterest" && document.totalRooms != null && document.vacantRooms != null && document.vacantRooms > document.totalRooms) {
    throw new HttpError(400, "Vacant rooms cannot exceed total rooms");
  }
}
function validateId(req, res, next) {
  try { req.params.id = id.parse(req.params.id); next(); } catch { next(new HttpError(400, "Invalid record ID")); }
}
const integerParam = (max) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
function querySchema(filters = {}) {
  return z.strictObject({ page: integerParam(100).optional().default(1), limit: integerParam(200).optional().default(100), q: text(100).optional(), view: z.enum(["public", "private"]).optional().default("public"), ...filters });
}
function validateQuery(schema = z.strictObject({})) {
  return (req, res, next) => { try { req.validQuery = parse(schema, req.query); next(); } catch (err) { next(err); } };
}
const login = z.strictObject({ username: required.max(254), password: z.string().min(1).max(1024) });
const chat = z.strictObject({ message: text(1000).min(1), allowExternalAI: z.boolean().optional().default(false) });
const timetableBody = z.union([z.strictObject({ timetable, onLeave: z.boolean().optional() }), timetable]);
module.exports = { z, id, text, shapes, selfFields, parse, recordBody, checkRecord, validateId, querySchema, validateQuery, login, chat, timetableBody };
