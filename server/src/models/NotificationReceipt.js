const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  notificationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipient: { type: String, required: true },
  readAt: { type: Date, default: null }, expiresAt: { type: Date, required: true },
}, { timestamps: true, autoIndex: false });
schema.index({ notificationId: 1, recipient: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("NotificationReceipt", schema);
