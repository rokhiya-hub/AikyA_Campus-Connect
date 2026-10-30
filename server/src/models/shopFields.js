const mongoose = require("mongoose");
const {
  ITEM_CATEGORIES,
  SHOP_CATEGORIES,
  scheduleError,
} = require("../services/shopData");
const actor = new mongoose.Schema(
  { id: String, role: { type: String, enum: ["admin", "shop_owner"] } },
  { _id: false },
);
const report = new mongoose.Schema(
  { lastUpdatedAt: Date, updatedBy: actor },
  { _id: false },
);
const stock = new mongoose.Schema(
  {
    status: { type: String, enum: ["in_stock", "out_of_stock", "unknown"] },
    lastUpdatedAt: Date,
    updatedBy: actor,
  },
  { _id: false },
);
const item = new mongoose.Schema({
  name: String,
  price: String,
  available: { type: Boolean, default: true },
  category: { type: String, enum: ITEM_CATEGORIES, default: "unclassified" },
  keywords: [String],
  active: { type: Boolean, default: true },
  stock,
  pricing: report,
  lastUpdatedAt: Date,
  updatedBy: actor,
  searchTokens: [String],
});
const period = new mongoose.Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  { _id: false },
);
const dated = new mongoose.Schema(
  {
    date: { type: String, required: true },
    label: String,
    periods: { type: [period], default: [] },
  },
  { _id: false },
);
const schedule = new mongoose.Schema(
  {
    timeZone: { type: String, enum: ["Asia/Kolkata"], default: "Asia/Kolkata" },
    weekly: { type: Map, of: [period], default: {} },
    holidays: [dated],
    exceptions: [dated],
  },
  { _id: false },
);
schedule.pre("validate", function () {
  const error = scheduleError(this);
  if (error) this.invalidate("weekly", error);
});
module.exports = { item, schedule, SHOP_CATEGORIES };
