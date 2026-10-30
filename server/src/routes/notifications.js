const express = require("express");
const { optionalAuth, requireAuth, adminOnly } = require("../middleware/auth");
const { asyncRoute, HttpError } = require("../middleware/errors");
const { z, parse, validateId, validateQuery } = require("../validation");
const pageSchema = z.strictObject({ page: z.coerce.number().int().min(1).max(100).optional().default(1), limit: z.coerce.number().int().min(1).max(30).optional().default(20) });
module.exports = function createRouter({ service, models, audit, limiter }) {
  const router = express.Router(), N = models.Notification;
  async function checkAccount(user) {
    if (!user || user.role === "admin") return;
    if (user.role === "driver") throw new HttpError(403, "Device sessions cannot access account notifications");
    const account = await models[user.role === "faculty" ? "Faculty" : "ShopOwner"].findById(user.sub).maxTimeMS(1000);
    if (!account || user.role === "shop_owner" && account.status !== "approved") throw new HttpError(403, "Account access is unavailable");
  }
  router.get("/", optionalAuth, validateQuery(pageSchema), asyncRoute(async (req, res) => { await checkAccount(req.admin); res.json(await service.list(req.admin, req.validQuery.page, req.validQuery.limit)); }));
  router.get("/push/config", validateQuery(), (req, res) => res.json({ enabled: !!service.config(), publicKey: service.config()?.publicKey || null, audience: "public" }));
  router.post("/push/subscribe", limiter, validateQuery(), asyncRoute(async (req, res) => { await service.subscribe(req.body); res.status(201).json({ subscribed: true }); }));
  router.post("/push/unsubscribe", limiter, validateQuery(), asyncRoute(async (req, res) => { await service.unsubscribe(req.body); res.json({ subscribed: false }); }));
  router.get("/admin", adminOnly, validateQuery(pageSchema), asyncRoute(async (req, res) => {
    const { page, limit } = req.validQuery;
    const items = await N.find({}).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).maxTimeMS(2000);
    res.json({ items: items.slice(0, limit), hasMore: items.length > limit, page });
  }));
  router.post("/admin", adminOnly, validateQuery(), asyncRoute(async (req, res) => {
    const body = await service.validate(req.body);
    const note = await audit(req, "Notification", "create", Object.keys(body), () => N.create({ ...body, createdBy: req.admin.sub }));
    res.status(201).json(note);
  }));
  router.put("/admin/:id", adminOnly, validateId, validateQuery(), asyncRoute(async (req, res) => {
    const body = await service.validate(req.body), note = await N.findById(req.params.id).maxTimeMS(1000);
    if (!note) throw new HttpError(404, "Notification not found");
    if (note.status !== "draft") throw new HttpError(409, "Only drafts can be edited; cancel and create a replacement after scheduling");
    note.set(body);
    await audit(req, "Notification", "update", Object.keys(body), () => note.save());
    res.json(note);
  }));
  router.post("/admin/:id/cancel", adminOnly, validateId, validateQuery(), asyncRoute(async (req, res) => {
    parse(z.strictObject({}), req.body);
    const note = await N.findById(req.params.id).maxTimeMS(1000);
    if (!note) throw new HttpError(404, "Notification not found");
    note.status = "cancelled";
    await audit(req, "Notification", "update", ["status"], () => note.save());
    res.json({ status: "cancelled" });
  }));
  router.get("/admin/:id/deliveries", adminOnly, validateId, validateQuery(), asyncRoute(async (req, res) => {
    const counts = {};
    for (const status of ["claimed", "accepted", "failed", "cancelled"]) counts[status] = await models.NotificationDelivery.countDocuments({ notificationId: req.params.id, status }, { maxTimeMS: 1000 });
    res.json({ counts, acceptedMeans: "Push service accepted; browser display is not confirmed" });
  }));
  router.put("/:id/read", requireAuth, validateId, validateQuery(), asyncRoute(async (req, res) => {
    await checkAccount(req.admin);
    const { read } = parse(z.strictObject({ read: z.boolean() }), req.body);
    await service.read(req.params.id, req.admin, read); res.json({ read });
  }));
  return router;
};
