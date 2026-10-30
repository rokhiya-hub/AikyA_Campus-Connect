const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    busId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusRoute",
      required: true,
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusDevice",
      required: true,
    },
    deviceVersion: { type: Number, required: true },
    status: { type: String, enum: ["active", "ended"], default: "active" },
    consentAt: { type: Date, required: true },
    startedAt: { type: Date, required: true },
    endedAt: Date,
    expiresAt: { type: Date, required: true },
    leaseExpiresAt: { type: Date, required: true },
    latest: { type: require("./BusLocation").pointSchema, default: undefined },
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true, optimisticConcurrency: true, autoIndex: false },
);
schema.index(
  { busId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
    name: "one_active_trip_per_bus",
  },
);
schema.index(
  { deviceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
    name: "one_active_trip_per_device",
  },
);
schema.index({ status: 1, expiresAt: 1, _id: 1 });
schema.index(
  { purgeAt: 1 },
  { expireAfterSeconds: 0, name: "bus_trip_retention" },
);
module.exports = mongoose.model("BusTrip", schema);
