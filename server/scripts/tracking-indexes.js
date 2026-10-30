require("dotenv").config();
const mongoose = require("mongoose");
async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirm-indexes")
    throw new Error("Review tracking indexes, then supply --confirm-indexes");
  if (!process.env.MONGODB_URI)
    throw new Error("Configure your own MongoDB URI");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  try {
    for (const name of ["BusDevice", "BusLocation", "BusTrip"])
      await require(`../src/models/${name}`).createIndexes();
    console.log(
      "Tracking indexes provisioned additively. No route, trip or location records were changed.",
    );
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Tracking index setup failed; verify the confirmation flag, connection and index conflicts. No indexes are dropped.",
    );
    process.exitCode = 1;
  });
