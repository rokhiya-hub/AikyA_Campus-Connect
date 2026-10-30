require("dotenv").config();
const mongoose = require("mongoose");
const { createNotificationService } = require("../src/services/notifications");
async function main() {
  if (!process.env.MONGODB_URI || process.env.WEB_PUSH_ENABLED !== "true") throw new Error("Explicit database and Web Push configuration required");
  mongoose.set("bufferCommands", false);
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const models = Object.fromEntries(["Notification", "NotificationReceipt", "PushSubscription", "NotificationDelivery", "Event"].map(name => [name, require(`../src/models/${name}`)]));
  const service = createNotificationService({ models }); await service.ready();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopping = true; });
  while (!stopping) {
    try { await service.tick(); } catch { console.error("Notification worker cycle failed; inspect database availability"); }
    for (let seconds = 0; seconds < 15 && !stopping; seconds++) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await mongoose.disconnect();
}
if (require.main === module) main().catch(async () => { console.error("Notification worker startup failed; check configuration and indexes"); await mongoose.disconnect(); process.exitCode = 1; });
