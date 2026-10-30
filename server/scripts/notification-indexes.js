require("dotenv").config();
const mongoose = require("mongoose");
const names = ["Notification", "NotificationReceipt", "PushSubscription", "NotificationDelivery"];
async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirm-indexes" || !process.env.MONGODB_URI) throw new Error("Explicit index confirmation and database configuration required");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  try { for (const name of names) await require(`../src/models/${name}`).createIndexes(); console.log("Notification indexes created additively; no existing records rewritten."); }
  finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(() => { console.error("Notification index setup failed; no indexes dropped"); process.exitCode = 1; });
