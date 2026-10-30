// Always creates its own loopback mongod and temporary directory. Ignores .env/DB URIs.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), net = require("node:net"), { spawn } = require("node:child_process");
const mongoose = require("mongoose");
async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "aikya-notifications-"));
  let child;
  try {
    const port = await new Promise(resolve => { const listener = net.createServer(); listener.listen(0, "127.0.0.1", () => { const value = listener.address().port; listener.close(() => resolve(value)); }); });
    child = spawn(process.env.AIKYA_TEST_MONGOD || "mongod", ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", temp, "--logpath", path.join(temp, "mongod.log")], { windowsHide: true, stdio: "ignore" });
    let spawnError; child.on("error", error => { spawnError = error; });
    for (let attempt = 0; attempt < 40; attempt++) {
      if (spawnError || child.exitCode !== null) throw new Error("Owned temporary mongod failed to start");
      try { await mongoose.connect(`mongodb://127.0.0.1:${port}/aikya_notifications_test`, { autoIndex: false, serverSelectionTimeoutMS: 500 }); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.equal(mongoose.connection.readyState, 1);
    const status = await mongoose.connection.db.admin().serverStatus(); assert.equal(status.pid, child.pid, "Must use exactly the mongod process this test created");
    const models = Object.fromEntries(["Notification", "NotificationReceipt", "NotificationDelivery", "PushSubscription", "Event"].map(name => [name, require(`../src/models/${name}`)]));
    const { createNotificationService } = require("../src/services/notifications");
    const keys = require("web-push").generateVAPIDKeys(); // Ephemeral synthetic keys, never printed/stored.
    const env = { WEB_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:synthetic@example.test" };
    const current = new Date(), now = () => new Date(current), scheduledAt = new Date(current.getTime() - 1000), expiresAt = new Date(current.getTime() + 3600000);
    for (const Model of Object.values(models)) await Model.createIndexes();
    let sends = 0;
    const sendPush = async (_sub, payload) => { sends++; assert.equal(JSON.parse(payload).title, "AIKYA campus update"); await new Promise(resolve => setTimeout(resolve, 15)); };
    const first = createNotificationService({ models, env, now, sendPush }), second = createNotificationService({ models, env, now, sendPush });
    await first.ready();
    const note = await models.Notification.create({ title: "Synthetic durable notice", body: "Synthetic content", type: "announcement", audience: "public", status: "scheduled", scheduledAt, expiresAt, createdBy: "synthetic", verification: { status: "verified", source: "Synthetic official fixture", verifiedAt: new Date(current.getTime() - 2000) } });
    const sub = await models.PushSubscription.create({ endpoint: "https://fcm.googleapis.com/send/synthetic-local-only", endpointHash: "synthetic", owner: "synthetic", keys: { p256dh: keys.publicKey, auth: "A".repeat(22) }, enabled: true, consentedAt: new Date(current.getTime() - 5000), expiresAt });
    await Promise.all([first.tick(), second.tick()]);
    await createNotificationService({ models, env, now, sendPush }).tick();
    assert.equal(sends, 1); assert.equal(await models.NotificationDelivery.countDocuments({}), 1);
    assert.equal((await models.NotificationDelivery.findOne({})).status, "accepted");
    const user = { role: "faculty", sub: "000000000000000000000001" };
    await Promise.all([first.read(note._id, user, true), second.read(note._id, user, true)]);
    assert.equal(await models.NotificationReceipt.countDocuments({}), 1);
    await first.read(note._id, user, false);
    assert.equal((await models.NotificationReceipt.findOne({})).readAt, null);
    // A process lost after claiming a delivery must never send that claim again.
    const lost = await models.Notification.create({ ...note.toObject(), _id: new mongoose.Types.ObjectId(), title: "Synthetic interrupted claim" });
    await models.NotificationDelivery.create({ notificationId: lost._id, subscriptionId: sub._id, status: "claimed", claimedAt: current, expiresAt });
    await second.tick(); assert.equal(sends, 1);
    const cancelled = await models.Notification.create({ ...note.toObject(), _id: new mongoose.Types.ObjectId(), status: "cancelled" });
    await second.tick(); assert.equal(await models.NotificationDelivery.countDocuments({ notificationId: cancelled._id }), 0);
    for (const name of ["NotificationReceipt", "NotificationDelivery", "PushSubscription"]) {
      const indexes = await models[name].listIndexes(); assert.ok(indexes.some(index => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
    }
    console.log("PASS: real MongoDB unique concurrent claims, restart deduplication, scoped idempotent read/unread, interrupted claims, cancellation and TTL index definitions. Push transport mocked; no network push sent.");
  } finally {
    await mongoose.disconnect();
    if (child?.pid && child.exitCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited; }
    const resolved = path.resolve(temp), root = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), root); assert.ok(/^aikya-notifications-[A-Za-z0-9]+$/.test(path.basename(resolved)));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
run().catch(() => { console.error("Notification disposable-Mongo test failed. No existing database or push service was used."); process.exitCode = 1; });
