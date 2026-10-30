const RESET_CONFIRMATION = "--confirm-reset=DELETE_LOCAL_SEED_DATA";
function assertSeedSafety(env = process.env, args = process.argv.slice(2)) {
  if (!["development", "test"].includes(env.NODE_ENV) || !args.includes("--confirm-local")) {
    throw new Error("Seeding requires explicit development/test environment and --confirm-local");
  }
  if (args.some((arg) => !["--confirm-local", "--reset", RESET_CONFIRMATION].includes(arg))) throw new Error("Unknown seed option");
  let uri;
  try { uri = new URL(env.MONGODB_URI); } catch { throw new Error("A local test MongoDB URI is required"); }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname);
  const database = decodeURIComponent(uri.pathname.slice(1));
  if (uri.protocol !== "mongodb:" || !localHost || !/^[a-zA-Z0-9_-]+_(local|test)$/.test(database)) {
    throw new Error("Seeds require loopback MongoDB and a database ending in _local or _test");
  }
  // Disallow options that can point the driver at additional replica members.
  for (const key of uri.searchParams.keys()) if (!["authSource", "directConnection"].includes(key)) throw new Error("Unsafe seed URI option");
  if (uri.searchParams.has("directConnection") && uri.searchParams.get("directConnection") !== "true") throw new Error("Seed connection must remain local");
  const reset = args.includes("--reset");
  if (reset && !args.includes(RESET_CONFIRMATION)) throw new Error("Destructive reset requires the exact confirmation flag");
  if (!reset && args.includes(RESET_CONFIRMATION)) throw new Error("Reset confirmation requires --reset");
  return { reset };
}

const keys = { Department: ["code"], Faculty: ["name"], PointOfInterest: ["type", "name"], BusRoute: ["routeNumber"], Event: ["title", "date"] };
async function insertSeed(Model, records) {
  const documents = [];
  for (const row of records) {
    const filter = Object.fromEntries(keys[Model.modelName].map((key) => [key, row[key]]));
    if (Object.values(filter).some((value) => !value)) throw new Error("Seed record has no stable identity");
    // Insert-only upsert: reruns preserve every existing admin edit and password.
    const result = await Model.updateOne(filter, { $setOnInsert: row }, { upsert: true, runValidators: true });
    const document = await Model.findOne(filter);
    document.$locals.seedInserted = result.upsertedCount === 1;
    documents.push(document);
  }
  return documents;
}
module.exports = { assertSeedSafety, insertSeed };
