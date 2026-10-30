const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PointOfInterest",
      required: true,
    },
    itemId: mongoose.Schema.Types.ObjectId,
    reason: {
      type: String,
      enum: ["price", "stock", "hours", "location", "other"],
      required: true,
    },
    message: { type: String, required: true, maxlength: 1000 },
    reporterIdentity: {
      type: String,
      default: "unverified_guest",
      enum: ["unverified_guest"],
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "dismissed"],
      default: "pending",
    },
    moderationNote: { type: String, maxlength: 1000 },
    moderatedAt: Date,
    moderatedBy: String,
  },
  { timestamps: true, optimisticConcurrency: true },
);
schema.index(
  { status: 1, createdAt: -1, _id: -1 },
  { name: "shop_feedback_queue" },
);
schema.index({ shopId: 1, status: 1 }, { name: "shop_feedback_listing" });
module.exports = mongoose.model("ShopFeedback", schema);
