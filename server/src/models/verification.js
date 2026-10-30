const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  status: { type: String, enum: ["unverified", "verified"], default: "unverified" },
  source: String,
  verifiedAt: Date,
}, { _id: false });
schema.pre("validate", function () {
  if (this.status === "verified" && (!this.source?.trim() || !this.verifiedAt || this.verifiedAt.getTime() > Date.now())) {
    this.invalidate("status", "Official verification requires a source and a nonfuture verification date");
  }
});
module.exports = schema;
