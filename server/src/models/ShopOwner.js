const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 200 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ["pending", "approved", "suspended"],
      default: "pending",
    },
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      transform: (_doc, result) => {
        delete result.passwordHash;
        delete result.tokenVersion;
        return result;
      },
    },
    toObject: {
      transform: (_doc, result) => {
        delete result.passwordHash;
        delete result.tokenVersion;
        return result;
      },
    },
  },
);
schema.index({ email: 1 }, { unique: true, name: "shop_owner_email_unique" });
schema.index({ status: 1, _id: 1 }, { name: "shop_owner_moderation" });
module.exports = mongoose.model("ShopOwner", schema);
