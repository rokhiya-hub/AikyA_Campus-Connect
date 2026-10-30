const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  endpoint: { type: String, required: true, select: false },
  endpointHash: { type: String, required: true },
  keys: { p256dh: { type: String, select: false }, auth: { type: String, select: false } },
  owner: { type: String, required: true, select: false },
  enabled: { type: Boolean, default: true },
  consentedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, autoIndex: false });
schema.index({ endpointHash: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("PushSubscription", schema);
