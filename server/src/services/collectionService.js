const { serialize } = require("./publicData");
const { HttpError } = require("../middleware/errors");
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
async function listCollection(Model, req, res, searchFields, filters = {}) {
  const { page, limit, q, ...selectors } = req.validQuery;
  const filter = {};
  for (const [parameter, field] of Object.entries(filters)) if (selectors[parameter]) filter[field] = selectors[parameter];
  if (q) filter.$and = q.split(/\s+/).filter(Boolean).map((word) => ({ $or: searchFields.map((field) => ({ [field]: { $regex: escapeRegex(word), $options: "i" } })) }));
  const items = await Model.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).maxTimeMS(3000);
  res.set("X-Has-More", String(items.length > limit));
  res.set("X-Page", String(page));
  if (items.length > limit) res.set("X-Next-Page", String(page + 1));
  return res.json(items.slice(0, limit).map((item) => serialize(Model.modelName, item, req.validQuery.view === "private" ? req.admin : undefined)));
}
async function findRecord(Model, id) {
  const record = await Model.findById(id).maxTimeMS(3000);
  if (!record) throw new HttpError(404, "Not found");
  return record;
}
function privateView(faculty = false) {
  return (req, res, next) => {
    if (req.validQuery.view !== "private") return next();
    if (!req.admin) return next(new HttpError(401, "Authentication required"));
    if (faculty && !["admin", "faculty"].includes(req.admin.role)) return next(new HttpError(403, "Faculty or admin access required"));
    if (!faculty && req.admin.role !== "admin") return next(new HttpError(403, "Admin access required"));
    next();
  };
}
module.exports = { listCollection, findRecord, privateView };
