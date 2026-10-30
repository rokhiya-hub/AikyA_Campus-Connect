const { createHash, timingSafeEqual, createECDH } = require("node:crypto");
const { HttpError } = require("../middleware/errors");
const { z, text, id, parse } = require("../validation");
const stamp = z.iso.datetime({ offset: true });
const bodySchema = z.strictObject({
  title: text(160).min(1), body: text(2000).min(1),
  type: z.enum(["announcement", "event", "deadline"]),
  audience: z.enum(["public", "authenticated", "faculty", "admin", "shop_owner", "recipient"]),
  recipient: z.string().regex(/^(?:admin:[A-Za-z0-9_@. -]{1,80}|(?:faculty|shop_owner):[a-f0-9]{24})$/).optional(),
  eventId: id.nullable().optional(),
  status: z.enum(["draft", "scheduled"]),
  scheduledAt: stamp, expiresAt: stamp, occursAt: stamp.nullable().optional(),
  timezone: z.literal("Asia/Kolkata"),
  verification: z.strictObject({ status: z.enum(["unverified", "verified"]), source: text(1000).optional(), verifiedAt: stamp.optional() }),
});
const identity = user => user ? `${user.role}:${user.sub}` : null;
const verified = value => value?.status === "verified" && value.source?.trim() && value.verifiedAt && new Date(value.verifiedAt) <= new Date();
function eventVerified(event) {
  return !!(event && verified(event.verification) && event.startsAt && Number.isFinite(new Date(event.startsAt).getTime()) && (!event.endsAt || new Date(event.endsAt) > new Date(event.startsAt)));
}
function audienceFilter(user) {
  const audiences = ["public"];
  if (user) audiences.push("authenticated", user.role);
  return { $or: [{ audience: { $in: audiences } }, ...(user ? [{ audience: "recipient", recipient: identity(user) }] : [])] };
}
const hash = value => createHash("sha256").update(value).digest("hex");
const same = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function pushConfig(env = process.env) {
  if (env.WEB_PUSH_ENABLED !== "true") return null;
  if (!/^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY || "") || !/^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY || "") || !/^(?:mailto:|https:\/\/)/.test(env.VAPID_SUBJECT || "")) throw new Error("Invalid Web Push configuration");
  try {
    const key = createECDH("prime256v1"); key.setPrivateKey(Buffer.from(env.VAPID_PRIVATE_KEY, "base64url"));
    if (!key.getPublicKey().equals(Buffer.from(env.VAPID_PUBLIC_KEY, "base64url"))) throw new Error();
    const subject = new URL(env.VAPID_SUBJECT);
    if (subject.username || subject.password || subject.protocol === "mailto:" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject.pathname)) throw new Error();
  } catch { throw new Error("Invalid Web Push configuration"); }
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}
// Explicit known push services only: never POST to arbitrary submitted endpoints.
function subscriptionBody(body) {
  const value = parse(z.strictObject({ endpoint: z.string().url().max(2048), keys: z.strictObject({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }), consent: z.literal(true), deviceToken: z.string().regex(/^[a-f0-9]{64}$/) }), body);
  const url = new URL(value.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname) && !/^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)) throw new HttpError(400, "Unsupported push service endpoint");
  return value;
}
function createNotificationService({ models, env = process.env, sendPush, now = () => new Date() }) {
  const { Notification: N, NotificationReceipt: R, Event: E, PushSubscription: S, NotificationDelivery: D } = models;
  const config = () => pushConfig(env);
  async function uniqueReady(Model, keys) {
    const indexes = await Model.listIndexes();
    if (!indexes.some(index => index.unique && !index.partialFilterExpression && Object.keys(index.key).length === keys.length && keys.every(field => index.key[field] === 1))) throw new HttpError(503, "Notification indexes must be provisioned");
  }
  async function retentionReady(Model) {
    const indexes = await Model.listIndexes();
    if (!indexes.some(index => index.key.expiresAt === 1 && Object.keys(index.key).length === 1 && index.expireAfterSeconds === 0 && !index.partialFilterExpression)) throw new HttpError(503, "Notification retention indexes must be provisioned");
  }
  async function eligible(note, user, time = now()) {
    if (note.status !== "scheduled" || new Date(note.scheduledAt) > time || new Date(note.expiresAt) <= time || !verified(note.verification)) return false;
    if (!(note.audience === "public" || user && (note.audience === "authenticated" || note.audience === user.role || note.audience === "recipient" && note.recipient === identity(user)))) return false;
    if (note.eventId) {
      const event = await E.findById(note.eventId).maxTimeMS(1500);
      if (!eventVerified(event) || new Date(note.occursAt).getTime() !== new Date(note.type === "deadline" ? event.deadlineAt : event.startsAt).getTime()) return false;
    }
    return true;
  }
  async function validate(body) {
    const value = parse(bodySchema, body);
    if (!(new Date(value.expiresAt) > new Date(value.scheduledAt)) || value.occursAt && new Date(value.expiresAt) > new Date(value.occursAt)) throw new HttpError(400, "Check schedule, occurrence and expiration times");
    if (value.audience === "recipient" ? !value.recipient : value.recipient) throw new HttpError(400, "Recipient must match audience scope");
    if (value.type !== "announcement" && !value.occursAt) throw new HttpError(400, "Events and deadlines require a verified occurrence time");
    if (value.status === "scheduled" && !verified(value.verification)) throw new HttpError(400, "Official verification is required before scheduling");
    if (value.eventId) {
      const event = await E.findById(value.eventId).maxTimeMS(1500);
      if (!event) throw new HttpError(400, "Event does not exist");
      if (value.status === "scheduled" && (!eventVerified(event) || new Date(value.occursAt).getTime() !== new Date(value.type === "deadline" ? event.deadlineAt : event.startsAt).getTime())) throw new HttpError(400, "Notification must match verified event time");
    }
    return value;
  }
  const projection = note => Object.fromEntries(["_id", "title", "body", "type", "scheduledAt", "expiresAt", "occursAt", "timezone", "eventId"].filter(key => note[key] != null).map(key => [key, note[key]]));
  async function list(user, page, limit) {
    const time = now();
    const rows = await N.find({ status: "scheduled", scheduledAt: { $lte: time }, expiresAt: { $gt: time }, ...audienceFilter(user) }).sort({ scheduledAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).maxTimeMS(2000);
    const items = [];
    for (const note of rows.slice(0, limit)) if (await eligible(note, user, time)) {
      const receipt = user ? await R.findOne({ notificationId: note._id, recipient: identity(user) }).maxTimeMS(1000) : null;
      items.push({ ...projection(note), readAt: receipt?.readAt || null });
    }
    return { items, hasMore: rows.length > limit, page };
  }
  async function read(noteId, user, read) {
    await uniqueReady(R, ["notificationId", "recipient"]);
    await retentionReady(R);
    const note = await N.findById(noteId).maxTimeMS(1000);
    if (!note || !await eligible(note, user)) throw new HttpError(404, "Notification not found");
    try {
      await R.updateOne({ notificationId: note._id, recipient: identity(user) }, { $set: { readAt: read ? now() : null, expiresAt: new Date(new Date(note.expiresAt).getTime() + 7 * 86400000) } }, { upsert: true, runValidators: true });
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  async function subscribe(raw) {
    if (!config()) throw new HttpError(503, "Optional Web Push is disabled");
    await uniqueReady(S, ["endpointHash"]);
    await retentionReady(S);
    const value = subscriptionBody(raw), endpointHash = hash(value.endpoint), owner = hash(value.deviceToken);
    const old = await S.findOne({ endpointHash }).select("+owner").maxTimeMS(1000);
    if (old && !same(old.owner, owner)) throw new HttpError(409, "Subscription belongs to another device registration");
    await S.updateOne({ endpointHash }, { $set: { endpoint: value.endpoint, keys: value.keys, owner, enabled: true, consentedAt: now(), expiresAt: new Date(now().getTime() + 90 * 86400000) } }, { upsert: true, runValidators: true });
  }
  async function unsubscribe(raw) {
    const value = parse(z.strictObject({ endpoint: z.string().max(2048), deviceToken: z.string().regex(/^[a-f0-9]{64}$/) }), raw);
    await S.deleteOne({ endpointHash: hash(value.endpoint), owner: hash(value.deviceToken) });
  }
  let working = false;
  async function* scan(Model, filter, size, select = "") {
    let after;
    while (true) {
      const rows = await Model.find({ ...filter, ...(after ? { _id: { $gt: after } } : {}) }).select(select).sort({ _id: 1 }).limit(size).maxTimeMS(2000);
      for (const row of rows) yield row;
      if (rows.length < size) return;
      after = rows[rows.length - 1]._id;
    }
  }
  async function tick() {
    if (working || !config()) return;
    working = true;
    try {
      const time = now();
      for await (const note of scan(N, { status: "scheduled", audience: "public", scheduledAt: { $lte: time }, expiresAt: { $gt: time } }, 20)) {
        if (!await eligible(note)) continue;
        for await (const sub of scan(S, { enabled: true, expiresAt: { $gt: time } }, 200, "+endpoint +keys.p256dh +keys.auth +owner")) {
          // No historical burst when a device opts in. Unique insert is the durable claim.
          if (new Date(sub.consentedAt) > new Date(note.scheduledAt)) continue;
          let delivery;
          try {
            [delivery] = await D.create([{ notificationId: note._id, subscriptionId: sub._id, status: "claimed", claimedAt: now(), expiresAt: new Date(new Date(note.expiresAt).getTime() + 7 * 86400000) }], { writeConcern: { w: "majority", j: true } });
          }
          catch (error) { if (error.code === 11000) continue; throw error; }
          try {
            const latest = await N.findById(note._id).maxTimeMS(1000), subscription = await S.findById(sub._id).select("+endpoint +keys.p256dh +keys.auth").maxTimeMS(1000);
            if (!latest || !subscription?.enabled || !await eligible(latest)) { await D.updateOne({ _id: delivery._id }, { $set: { status: "cancelled" } }); continue; }
            const pushLibrary = sendPush ? null : require("web-push");
            const sender = sendPush || pushLibrary.sendNotification.bind(pushLibrary);
            await sender({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }, JSON.stringify({ title: "AIKYA campus update", body: "Open the notification center to check current announcements.", url: "/notifications", tag: `aikya-${note._id}` }), { vapidDetails: config(), TTL: Math.max(0, Math.min(3600, Math.floor((new Date(note.expiresAt) - now()) / 1000))), timeout: 5000, urgency: "normal" });
            await D.updateOne({ _id: delivery._id }, { $set: { status: "accepted", acceptedAt: now() } });
          } catch (error) {
            await D.updateOne({ _id: delivery._id }, { $set: { status: "failed" } });
            if ([404, 410].includes(error.statusCode)) await S.updateOne({ _id: sub._id }, { $set: { enabled: false } });
          }
        }
      }
    } finally { working = false; }
  }
  async function ready() {
    for (const [Model, key] of [[R, ["notificationId", "recipient"]], [S, ["endpointHash"]], [D, ["notificationId", "subscriptionId"]]]) {
      await uniqueReady(Model, key);
      await retentionReady(Model);
    }
    config();
  }
  return { validate, eligible, list, read, subscribe, unsubscribe, tick, ready, config };
}
module.exports = { createNotificationService, identity, verified, eventVerified, subscriptionBody };
