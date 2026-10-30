require("dotenv").config();
const fs = require("node:fs/promises");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const connectDB = require("../src/config/db");
const { assertSeedSafety } = require("../src/seed/safety");
const { planBuildingLinks, applyBuildingLinkPlan } = require("../src/services/buildingLinks");
const { createAuditor } = require("../src/services/auditService");
const { z, id, parse } = require("../src/validation");
const models = { Department: require("../src/models/Department"), Faculty: require("../src/models/Faculty"), PointOfInterest: require("../src/models/PointOfInterest") };
const AuditLog = require("../src/models/AuditLog");
const planSchema = z.strictObject({ changes: z.array(z.strictObject({ model: z.enum(Object.keys(models)), id, expectedBlock: z.string(), buildingId: id })), unresolved: z.array(z.strictObject({ model: z.enum(Object.keys(models)), id, reason: z.enum(["ambiguous", "no_exact_match"]) })) });
async function migrate(args = process.argv.slice(2)) {
  if (args.some((arg) => !["--confirm-local", "--apply", "--confirm-building-links"].includes(arg) && !arg.startsWith("--plan="))) throw new Error("Unknown migration option");
  assertSeedSafety(process.env, args.includes("--confirm-local") ? ["--confirm-local"] : []);
  const apply = args.includes("--apply"), file = args.find((arg) => arg.startsWith("--plan="))?.slice(7);
  if (apply && (!file || !args.includes("--confirm-building-links"))) throw new Error("Apply requires an explicitly reviewed plan and confirmation");
  await connectDB({ directConnection: true, quiet: true });
  try {
    if (!apply) {
      const collections = Object.fromEntries(await Promise.all(Object.entries(models).map(async ([name, Model]) => [name, await Model.find().select("_id type name block buildingId").maxTimeMS(10000).lean()])));
      const plan = planBuildingLinks(collections.PointOfInterest, collections);
      console.log(JSON.stringify(plan, null, 2));
      return plan;
    }
    const plan = parse(planSchema, JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "")));
    const auditor = createAuditor(AuditLog);
    const result = await applyBuildingLinkPlan(plan, models, (link, operation) => auditor({ admin: { sub: "local-building-migration", role: "admin" }, params: { id: link.id }, requestId: randomUUID() }, link.model, "update", ["buildingId"], operation));
    console.log(JSON.stringify(result));
    return result;
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) migrate().catch(async () => { console.error("Building-link migration refused or failed; review its local safety requirements and plan"); await mongoose.disconnect(); process.exitCode = 1; });
module.exports = { migrate };
