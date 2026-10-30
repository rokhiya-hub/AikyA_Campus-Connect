const { z, id, text } = require("./index");
const device = z.strictObject({
  busId: id,
  label: text(200).min(1),
  expiresAt: z.iso.datetime(),
});
const session = z.strictObject({
  deviceId: id,
  secret: z.string().regex(/^[a-f0-9]{64}$/),
});
const start = z.strictObject({
  consent: z.literal(true),
  deviceId: id.optional(),
});
const location = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(200),
  recordedAt: z.iso.datetime(),
});
const page = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().max(100))
  .optional()
  .default(1);
const limit = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().max(50))
  .optional()
  .default(20);
const query = z.strictObject({ busId: id.optional(), page, limit });
module.exports = { device, session, start, location, query };
