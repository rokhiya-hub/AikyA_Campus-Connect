require("dotenv").config();
const mongoose = require("mongoose");
const { assertSeedSafety } = require("../src/seed/safety");
const { itemTokens } = require("../src/services/shopData");
function plan(shop) {
  const changes = {};
  if (!shop.category) changes.category = "unclassified";
  for (const [index, item] of (shop.items || []).entries()) {
    const tokens = itemTokens({
      ...item,
      category: item.category || "unclassified",
    });
    if (JSON.stringify(tokens) !== JSON.stringify(item.searchTokens || []))
      changes[`items.${index}.searchTokens`] = tokens;
    if (!item._id)
      changes[`items.${index}._id`] = new mongoose.Types.ObjectId();
    if (!item.category) changes[`items.${index}.category`] = "unclassified";
  }
  if (shop.catalogVersion !== 1) changes.catalogVersion = 1;
  return changes;
}
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) => !["--confirm-local", "--apply", "--indexes"].includes(arg),
    )
  )
    throw new Error("Unknown option");
  assertSeedSafety(
    process.env,
    args.filter((arg) => arg === "--confirm-local"),
  );
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const POI = require("../src/models/PointOfInterest");
  const { createAuditor } = require("../src/services/auditService");
  const audit = createAuditor();
  let proposed = 0,
    applied = 0,
    conflicted = 0;
  try {
    for await (const shop of POI.collection.find({ type: "shop" })) {
      const changes = plan(shop);
      if (!Object.keys(changes).length) continue;
      proposed++;
      if (args.includes("--apply")) {
        const req = {
          admin: { role: "admin", sub: "local-shop-migration" },
          params: { id: String(shop._id) },
          requestId: require("node:crypto").randomUUID(),
        };
        const result = await audit(
          req,
          "PointOfInterest",
          "update",
          Object.keys(changes),
          () =>
            POI.collection.updateOne(
              {
                _id: shop._id,
                __v: shop.__v ?? { $exists: false },
                updatedAt: shop.updatedAt ?? { $exists: false },
              },
              { $set: changes, $inc: { __v: 1 } },
            ),
        );
        if (result.modifiedCount) applied++;
        else conflicted++;
      }
    }
    if (args.includes("--indexes")) {
      if (!args.includes("--apply"))
        throw new Error("Index creation requires --apply");
      for (const Model of [
        POI,
        require("../src/models/ShopOwner"),
        require("../src/models/ShopFeedback"),
      ])
        await Model.createIndexes();
    }
    console.log(
      JSON.stringify({
        dryRun: !args.includes("--apply"),
        proposed,
        applied,
        conflicted,
      }),
    );
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Shop migration failed; check local/test configuration. No reset is performed.",
    );
    process.exitCode = 1;
  });
module.exports = { plan };
