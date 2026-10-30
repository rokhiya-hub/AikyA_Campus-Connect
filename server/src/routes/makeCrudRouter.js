const express = require("express");
const { adminOnly, optionalAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/errors");
const { z, recordBody, checkRecord, validateId, validateQuery, querySchema } = require("../validation");
const { listCollection, findRecord, privateView } = require("../services/collectionService");
const { serialize } = require("../services/publicData");
const { createAuditor } = require("../services/auditService");
const { validateBuildingLink, ensureBuildingUnused } = require("../services/buildingLinks");

const config = {
  Department: { search: ["name", "code", "block"] },
  PointOfInterest: { search: ["name", "block", "area"], filters: { type: "type" }, query: { type: z.enum(["shop", "hostel", "block", "library", "office", "ground", "service"]).optional() } },
  BusRoute: { search: ["routeNumber", "routeDescription", "ground"] },
  Event: { search: ["title", "venue", "organizer"], filters: { category: "category" }, query: { category: z.string().trim().max(100).optional() } },
};
// Preserve existing item IDs/provenance when the legacy admin editor sends a menu.
// Omitted entries are archived rather than erased. Unchanged legacy flags stay unconfirmed.
function mergeLegacyMenu(document, changes, principal) {
  if (document.type !== "shop" || !changes.items) return;
  const submitted = changes.items;
  if (new Set(submitted.map(item => item.name)).size !== submitted.length) throw new (require("../middleware/errors").HttpError)(400, "Item names must be distinct");
  const old = [...(document.items || [])];
  for (const values of submitted) {
    let item = old.find(entry => entry.name === values.name);
    if (!item) { document.items.push({ name: values.name }); item = document.items[document.items.length - 1]; }
    const updates = { name: values.name, active: true };
    if (Object.hasOwn(values, "price") && values.price !== item.price) updates.price = values.price;
    if (Object.hasOwn(values, "available") && values.available !== item.available) updates.stockStatus = values.available ? "in_stock" : "out_of_stock";
    require("./shops").stampItem(item, updates, principal);
  }
  for (const item of old) if (!submitted.some(entry => entry.name === item.name)) item.active = false;
  delete changes.items;
}
function makeCrudRouter(Model, audit = createAuditor(), models = {}) {
  const router = express.Router();
  const settings = config[Model.modelName];
  router.get("/", optionalAuth, validateQuery(querySchema(settings.query)), privateView(), asyncRoute((req, res) =>
    listCollection(Model, req, res, settings.search, settings.filters)));
  router.get("/:id", optionalAuth, validateId, validateQuery(z.strictObject({ view: z.enum(["public", "private"]).optional().default("public") })), privateView(), asyncRoute(async (req, res) =>
    res.json(serialize(Model.modelName, await findRecord(Model, req.params.id), req.validQuery.view === "private" ? req.admin : undefined))));
  router.post("/", adminOnly, validateQuery(), asyncRoute(async (req, res) => {
    const body = recordBody(Model.modelName, req.body);
    checkRecord(Model.modelName, body);
    await validateBuildingLink(body, models, body);
    const item = await audit(req, Model.modelName, "create", Object.keys(body), () => Model.create(body));
    res.status(201).json(serialize(Model.modelName, item, req.admin));
  }));
  router.put("/:id", adminOnly, validateId, validateQuery(), asyncRoute(async (req, res) => {
    const changes = recordBody(Model.modelName, req.body, { partial: true });
    const changedFields = Object.keys(changes);
    const item = await findRecord(Model, req.params.id);
    if (Model.modelName === "PointOfInterest" && item.type === "block" && changes.type && changes.type !== "block") await ensureBuildingUnused(item._id, models);
    if (Model.modelName === "PointOfInterest") mergeLegacyMenu(item, changes, req.admin);
    item.set(changes);
    checkRecord(Model.modelName, item);
    await validateBuildingLink(item, models, changes);
    await audit(req, Model.modelName, "update", changedFields, () => item.save());
    res.json(serialize(Model.modelName, item, req.admin));
  }));
  router.delete("/:id", adminOnly, validateId, validateQuery(), asyncRoute(async (req, res) => {
    const item = await findRecord(Model, req.params.id);
    if (Model.modelName === "PointOfInterest" && item.type === "block") await ensureBuildingUnused(item._id, models);
    await audit(req, Model.modelName, "delete", [], () => Model.findByIdAndDelete(req.params.id));
    res.json({ success: true });
  }));
  return router;
}
module.exports = makeCrudRouter;
