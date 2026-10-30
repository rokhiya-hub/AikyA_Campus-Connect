require("dotenv").config();
const mongoose = require("mongoose");
async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirm-indexes" || !process.env.MONGODB_URI) throw new Error("Explicit index confirmation and database configuration are required");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  try { await require("../src/models/QueryLog").createIndexes(); console.log("Chat metadata retention index created additively. Existing log content was not rewritten."); }
  finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(() => { console.error("Chat log index setup failed. No indexes are dropped or log records rewritten."); process.exitCode = 1; });
