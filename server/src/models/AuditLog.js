const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  actorId: { type: String, required: true },
  actorRole: { type: String, enum: ["admin", "faculty", "shop_owner", "driver"], required: true },
  action: { type: String, enum: ["create", "update", "delete", "timetable"], required: true },
  resource: { type: String, required: true },
  targetId: String,
  fields: [String],
  requestId: String,
  status: { type: String, enum: ["attempted", "succeeded", "failed"], required: true },
}, { timestamps: true, strict: "throw" });
module.exports = mongoose.model("AuditLog", schema);
