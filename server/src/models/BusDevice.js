const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    busId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusRoute",
      required: true,
    },
    label: { type: String, required: true, maxlength: 200 },
    secretHash: { type: String, required: true, select: false },
    enabled: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    authorizedBy: { type: String, required: true },
    lastUsedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true, autoIndex: false },
);
schema.index({ busId: 1, enabled: 1 });
module.exports = mongoose.model("BusDevice", schema);
