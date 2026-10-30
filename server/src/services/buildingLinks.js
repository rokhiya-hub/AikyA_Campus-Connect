const { HttpError } = require("../middleware/errors");
const normalize = (value = "") => value.trim().replace(/\s+/g, " ").toLowerCase();
async function validateBuildingLink(document, models, changes = {}) {
  if (!document.buildingId) return;
  if (document.type === "block") throw new HttpError(400, "A building POI uses its own ID; buildingId is only for contained locations");
  const building = await models.PointOfInterest.findById(document.buildingId).maxTimeMS(3000);
  if (!building || building.type !== "block") throw new HttpError(400, "buildingId must reference an existing building POI");
  if (changes.buildingId && changes.block && ![building.name, building.block].some((value) => normalize(value) === normalize(changes.block))) {
    throw new HttpError(400, "Block label does not match the selected building ID");
  }
}
async function ensureBuildingUnused(id, models) {
  for (const Model of [models.Department, models.Faculty, models.PointOfInterest]) {
    if (await Model.findOne({ buildingId: id }).maxTimeMS(3000)) throw new HttpError(409, "Building is referenced by campus records; relink them before deletion");
  }
}
function planBuildingLinks(pois, collections) {
  const buildings = pois.filter((poi) => poi.type === "block");
  const changes = [], unresolved = [];
  for (const [model, records] of Object.entries(collections)) for (const record of records) {
    if (record.buildingId || (model === "PointOfInterest" && record.type === "block")) continue;
    const label = normalize(record.block);
    const matches = label ? buildings.filter((building) => [building.name, building.block].some((value) => normalize(value) === label)) : [];
    if (matches.length === 1) changes.push({ model, id: String(record._id), expectedBlock: record.block, buildingId: String(matches[0]._id) });
    else unresolved.push({ model, id: String(record._id), reason: matches.length ? "ambiguous" : "no_exact_match" });
  }
  return { changes, unresolved };
}
async function applyBuildingLinkPlan(plan, models, audit) {
  if (typeof audit !== "function") throw new Error("Migration requires audit logging");
  let changed = 0, skipped = 0;
  for (const link of plan.changes) {
    const record = await models[link.model].findById(link.id).maxTimeMS(3000);
    const building = await models.PointOfInterest.findById(link.buildingId).maxTimeMS(3000);
    if (!record || record.buildingId || record.block !== link.expectedBlock || !building || building.type !== "block" || (link.model === "PointOfInterest" && record.type === "block")) { skipped++; continue; }
    const result = await audit(link, () => models[link.model].updateOne({ _id: record._id, buildingId: null, block: link.expectedBlock }, { $set: { buildingId: building._id } }, { runValidators: true }));
    if (result.modifiedCount) changed++; else skipped++;
  }
  return { changed, skipped };
}
module.exports = { validateBuildingLink, ensureBuildingUnused, planBuildingLinks, applyBuildingLinkPlan };
