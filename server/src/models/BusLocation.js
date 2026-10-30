const mongoose = require("mongoose");
const point = new mongoose.Schema(
  {
    latitude: { type: Number, min: -90, max: 90, required: true },
    longitude: { type: Number, min: -180, max: 180, required: true },
    accuracy: { type: Number, min: 0, max: 200, required: true },
    recordedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    trackingStatus: { type: String, enum: ["receiving"], default: "receiving" },
  },
  { _id: false },
);
const schema = new mongoose.Schema(
  {
    busId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusRoute",
      required: true,
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusTrip",
      required: true,
    },
    ...point.obj,
    purgeAt: { type: Date, required: true },
  },
  { autoIndex: false },
);
schema.index(
  { purgeAt: 1 },
  { expireAfterSeconds: 0, name: "bus_location_retention" },
);
schema.index({ tripId: 1, recordedAt: -1 });
module.exports = mongoose.model("BusLocation", schema);
module.exports.pointSchema = point;
