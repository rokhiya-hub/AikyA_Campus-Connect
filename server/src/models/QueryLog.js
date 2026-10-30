const mongoose = require("mongoose");

const queryLogSchema = new mongoose.Schema(
  {
    // Legacy content remains private and is never written by the chat route.
    question: { type: String, select: false },
    answer: { type: String, select: false },
    status: { type: String, enum: ["answered", "clarification", "unavailable"] },
    providerStatus: { type: String, maxlength: 40 },
    sourceCount: { type: Number, min: 0, max: 8 },
    latencyMs: { type: Number, min: 0, max: 60000 },
    expiresAt: { type: Date },
    wasEscalated: { type: Boolean, default: false },
  },
  { timestamps: true, autoIndex: false }
);
queryLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "chat_telemetry_retention" });

module.exports = mongoose.model("QueryLog", queryLogSchema);
