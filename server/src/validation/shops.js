const { z } = require("zod");
const { parse, id, text } = require("./index");
const {
  DAYS,
  ITEM_CATEGORIES,
  SHOP_CATEGORIES,
  scheduleError,
} = require("../services/shopData");
const period = z.strictObject({ start: z.string(), end: z.string() });
const dated = z.strictObject({
  date: z.iso.date(),
  label: text().optional(),
  periods: z.array(period).max(5),
});
const schedule = z
  .strictObject({
    timeZone: z.literal("Asia/Kolkata"),
    weekly: z.strictObject(
      Object.fromEntries(
        DAYS.map((day) => [day, z.array(period).max(5).optional()]),
      ),
    ),
    holidays: z.array(dated).max(100).default([]),
    exceptions: z.array(dated).max(100).default([]),
  })
  .refine(
    (value) => !scheduleError(value),
    "Invalid or overlapping opening times",
  );
const item = z.strictObject({
  name: text(200).min(1),
  price: text(100).optional(),
  category: z.enum(ITEM_CATEGORIES).optional(),
  keywords: z.array(text(50)).max(20).optional(),
  stockStatus: z.enum(["in_stock", "out_of_stock", "unknown"]).optional(),
  active: z.boolean().optional(),
});
const password = z
  .string()
  .min(12)
  .refine((value) => Buffer.byteLength(value) <= 72);
const owner = z.strictObject({
  name: text(200).min(1),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password,
});
const ownerUpdate = z
  .strictObject({
    name: text(200).min(1).optional(),
    status: z.enum(["pending", "approved", "suspended"]).optional(),
    password: password.optional(),
  })
  .refine((v) => Object.keys(v).length);
const profile = z
  .strictObject({
    contact: text().optional(),
    openHours: text().optional(),
    openingSchedule: schedule.optional(),
  })
  .refine((v) => Object.keys(v).length);
const adminProfile = z
  .strictObject({
    ...profile.shape,
    category: z.enum(SHOP_CATEGORIES).optional(),
    shopVerification: z
      .strictObject({
        status: z.enum(["unverified", "verified"]),
        source: text(1000).optional(),
        verifiedAt: z.iso.datetime().optional(),
      })
      .refine(
        (v) =>
          v.status !== "verified" ||
          (v.source && v.verifiedAt && new Date(v.verifiedAt) <= new Date()),
      )
      .optional(),
  })
  .refine((v) => Object.keys(v).length);
const number = (max, fallback) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().max(max))
    .optional()
    .default(fallback);
const query = z.strictObject({
  page: number(100, 1),
  limit: number(100, 30),
  q: text(100)
    .refine((v) => v.split(/\s+/).length <= 8)
    .optional(),
  category: z.enum(SHOP_CATEGORIES).optional(),
  itemCategory: z.enum(ITEM_CATEGORIES).optional(),
  area: text(100).optional(),
  mine: z.enum(["true"]).optional(),
  manage: z.enum(["true"]).optional(),
});
const feedback = z.strictObject({
  itemId: id.optional(),
  reason: z.enum(["price", "stock", "hours", "location", "other"]),
  message: text(1000).min(5),
});
const moderation = z.strictObject({
  status: z.enum(["resolved", "dismissed"]),
  moderationNote: text(1000).min(1),
});
module.exports = {
  parse,
  id,
  item,
  owner,
  ownerUpdate,
  profile,
  adminProfile,
  query,
  feedback,
  moderation,
};
