const mongoose = require("mongoose");
const shopFields = require("./shopFields");
const { itemTokens } = require("../services/shopData");

const poiSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["shop", "hostel", "block", "library", "office", "ground", "service"],
      required: true,
    },
    name: { type: String, required: true },
    block: { type: String },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "PointOfInterest", default: undefined },
    coordinateVerification: { type: require("./verification"), default: () => ({ status: "unverified" }) },
    floor: { type: String },
    area: { type: String }, // e.g. "Main Campus" | "Girls Hostel" | "Boys Hostel" | "Faculty Block"
    areaGroup: { type: String }, // optional sub-group e.g. "Street Food Stalls"
    latitude: { type: Number },
    longitude: { type: Number },
    openHours: { type: String },
    isOpenNow: { type: Boolean, default: true }, // demo flag, toggled by admin
    description: { type: String },

    // Legacy display-price strings and availability booleans are preserved.
    items: [shopFields.item],
    category: { type: String, enum: shopFields.SHOP_CATEGORIES, default: "unclassified" },
    shopOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ShopOwner" },
    shopVerification: { type: require("./verification"), default: () => ({ status: "unverified" }) },
    openingSchedule: { type: shopFields.schedule, default: undefined },
    catalogVersion: { type: Number, default: undefined },

    // hostel-specific
    hostelType: { type: String, enum: ["boys", "girls", null], default: null },
    warden: { type: String },
    contact: { type: String },
    totalRooms: { type: Number },
    vacantRooms: { type: Number },

    // access policy (kept flexible per the digital-twin design principle)
    accessPolicy: {
      allowedRoles: [{ type: String }], // e.g. ["student", "faculty"]
      restrictedRoles: [{ type: String }],
      startTime: { type: String }, // e.g. "08:00"
      endTime: { type: String }, // e.g. "18:00"
      note: { type: String },
    },

    // Building / branch allocation (editable by admin, changes each year)
    allocation: {
      institution: { type: String },
      branches: { type: [String] },
      years: { type: String },
      status: { type: String }, // e.g. "Proposed" | "Verified"
      verification: { type: require("./verification"), default: () => ({ status: "unverified" }) },
    },
  },
  { timestamps: true, optimisticConcurrency: true, autoIndex: false }
);

poiSchema.pre("validate", function () {
  if (this.type === "shop") { for (const item of this.items || []) item.searchTokens = itemTokens(item); this.catalogVersion = 1; }
});
poiSchema.index({ type: 1, category: 1, _id: 1 }, { name: "shop_category_page" });
poiSchema.index({ type: 1, "items.searchTokens": 1 }, { name: "shop_product_prefix" });
poiSchema.index({ type: 1, shopOwnerId: 1, _id: 1 }, { name: "shop_owner_assignments" });

module.exports = mongoose.model("PointOfInterest", poiSchema);
