const mongoose = require("mongoose");

const busRouteSchema = new mongoose.Schema(
  {
    routeNumber: { type: String, required: true },
    routeDescription: { type: String }, // e.g. "College -> Guntur -> XYZ"
    stops: [
      {
        name: String,
        time: String,
      },
    ],
    departureTime: { type: String },
    returnTime: { type: String },
    driverName: { type: String },
    driverContact: { type: String },
    busType: { type: String }, // e.g. "Student Bus" | "Faculty Bus"
    ground: { type: String }, // e.g. "Kakinada Bus Ground"
    status: { type: String, default: "On Route" },
    // Opt-in only; legacy status strings are not evidence of a live trip.
    trackingEnabled: { type: Boolean, default: false },
    vehicleLabel: { type: String, maxlength: 100 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BusRoute", busRouteSchema);
