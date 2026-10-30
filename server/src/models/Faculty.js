const mongoose = require("mongoose");
const { DAYS, scheduleErrors, dayAvailability, availabilityFor, weeklyLabels } = require("../services/facultyAvailability");
const slotSchema = new mongoose.Schema({ start: { type: String, required: true }, end: { type: String, required: true }, subject: String, room: String }, { _id: false });
const windowSchema = new mongoose.Schema({ start: { type: String, required: true }, end: { type: String, required: true } }, { _id: false });
const facultySchema = new mongoose.Schema({
  name: { type: String, required: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
  buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "PointOfInterest", default: undefined },
  locationVerification: { type: require("./verification"), default: () => ({ status: "unverified" }) },
  departmentName: String, designation: String, cabin: String, block: String, floor: String, email: String,
  subjects: [String], onLeave: { type: Boolean, default: false },
  passwordHash: { type: String, select: false },
  timetable: { type: Map, of: [slotSchema], default: {} },
  teachingWindows: { type: Map, of: [windowSchema], default: undefined },
  timetableUpdatedAt: { type: Date },
  // Legacy field is retained, but no longer treated as live availability.
  availableSlots: [String],
}, {
  timestamps: true,
  toJSON: { transform: (_doc, result) => { delete result.passwordHash; return result; } },
  toObject: { transform: (_doc, result) => { delete result.passwordHash; return result; } },
});
facultySchema.pre("validate", function () {
  for (const message of scheduleErrors(this)) this.invalidate("timetable", message);
});
facultySchema.methods.refreshAvailability = function () { this.availableSlots = weeklyLabels(this); return this; };
facultySchema.methods.freeTimeFor = function (day) { return DAYS.includes(day) ? dayAvailability(this, day).freeTime : []; };
facultySchema.methods.weeklyFreeTime = function () { return weeklyLabels(this); };
facultySchema.methods.availabilityAt = function (now) { return availabilityFor(this, now); };
module.exports = mongoose.model("Faculty", facultySchema);
module.exports.DAYS = DAYS;
