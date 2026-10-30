const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 160 },
  body: { type: String, required: true, maxlength: 2000 },
  type: { type: String, enum: ["announcement", "event", "deadline"], required: true },
  audience: { type: String, enum: ["public", "authenticated", "faculty", "admin", "shop_owner", "recipient"], required: true },
  recipient: { type: String, maxlength: 100 },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  status: { type: String, enum: ["draft", "scheduled", "cancelled"], default: "draft" },
  scheduledAt: { type: Date, required: true }, expiresAt: { type: Date, required: true },
  occursAt: Date,
  timezone: { type: String, enum: ["Asia/Kolkata"], default: "Asia/Kolkata" },
  verification: { type: require("./verification"), default: () => ({}) },
  createdBy: { type: String, required: true },
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false });
schema.index({ status: 1, audience: 1, scheduledAt: -1, _id: -1 });
schema.index({ expiresAt: 1 });
schema.pre("validate", function () {
  if (!(this.expiresAt > this.scheduledAt)) this.invalidate("expiresAt", "Expiry must follow scheduled time");
  if (this.audience === "recipient" && !this.recipient) this.invalidate("recipient", "Recipient required");
});
module.exports = mongoose.model("Notification", schema);
