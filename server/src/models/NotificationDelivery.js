const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  notificationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ["claimed", "accepted", "failed", "cancelled"], required: true },
  claimedAt: { type: Date, required: true }, acceptedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true, autoIndex: false });
schema.index({ notificationId: 1, subscriptionId: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("NotificationDelivery", schema);
