require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const { originsFor, validateProductionConfig } = require("./config/security");
const { HttpError, requestId, errorHandler } = require("./middleware/errors");
const { createAuditor } = require("./services/auditService");
const makeCrudRouter = require("./routes/makeCrudRouter");
const createFacultyRouter = require("./routes/faculty");
const createAuthRouter = require("./routes/auth");
const createChatRouter = require("./routes/chat");
const { createCampusDataService } = require("./services/campusDataService");
const { createShopRouters } = require("./routes/shops");
const createTrackingRouter = require("./routes/busTracking");
const { createTrackingService } = require("./services/busTracking");
const { createNotificationService } = require("./services/notifications");
const defaultModels = {
  Department: require("./models/Department"), Faculty: require("./models/Faculty"),
  PointOfInterest: require("./models/PointOfInterest"), BusRoute: require("./models/BusRoute"),
  Event: require("./models/Event"), QueryLog: require("./models/QueryLog"),
  ShopOwner: require("./models/ShopOwner"), ShopFeedback: require("./models/ShopFeedback"),
  BusDevice: require("./models/BusDevice"), BusTrip: require("./models/BusTrip"), BusLocation: require("./models/BusLocation"),
  Notification: require("./models/Notification"), NotificationReceipt: require("./models/NotificationReceipt"),
  PushSubscription: require("./models/PushSubscription"), NotificationDelivery: require("./models/NotificationDelivery"),
};

function createApp({ models = {}, audit, services = {}, limits = {} } = {}) {
  validateProductionConfig();
  const database = { ...defaultModels, ...models };
  const auditor = audit || createAuditor();
  const allowedOrigins = originsFor();
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  // Leave trust proxy disabled. Do not trust arbitrary X-Forwarded-For headers.
  app.use(requestId);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new HttpError(403, "Origin is not permitted"));
    },
    exposedHeaders: ["X-Has-More", "X-Next-Page", "X-Page", "X-Request-Id", "RateLimit", "Retry-After"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));
  const limiter = (limit) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (req, res, next) => next(new HttpError(429, "Too many requests; please try again later")) });
  const loginLimiter = limiter(limits.login || 20);
  const chatLimiter = limiter(limits.chat || 30);
  const shopLimiter = limiter(limits.shop || 10);
  const trackingLoginLimiter = limiter(limits.trackingLogin || 60);
  const trackingUpdateLimiter = limiter(limits.trackingUpdates || 1200);
  // Count even malformed/oversized attempts before parsing their body.
  app.use("/api/auth/login", (req, res, next) => req.method === "POST" ? loginLimiter(req, res, next) : next());
  app.use("/api/auth/shop-owner/login", loginLimiter);
  app.use("/api/bus-tracking/devices/session", (req, res, next) => req.method === "POST" ? trackingLoginLimiter(req, res, next) : next());
  app.use("/api/bus-tracking", (req, res, next) => req.method === "POST" && /^\/trips\/[^/]+\/locations$/.test(req.path) ? trackingUpdateLimiter(req, res, next) : next());
  app.use("/api/shop-owners/register", shopLimiter);
  app.use("/api/chat", (req, res, next) => req.method === "POST" && (req.path === "/" || req.path === "") ? chatLimiter(req, res, next) : next());
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use((req, res, next) => {
    if (["POST", "PUT"].includes(req.method) && !req.is("application/json")) return next(new HttpError(415, "Content-Type must be application/json"));
    res.set("Cache-Control", "no-store");
    next();
  });
  const pass = (req, res, next) => next();
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  app.use("/api/departments", makeCrudRouter(database.Department, auditor, database));
  app.use("/api/faculty", createFacultyRouter(database.Faculty, auditor, database));
  app.use("/api/poi", makeCrudRouter(database.PointOfInterest, auditor, database));
  app.use("/api/buses", makeCrudRouter(database.BusRoute, auditor, database));
  app.use("/api/events", makeCrudRouter(database.Event, auditor, database));
  app.use("/api/chat", createChatRouter({ QueryLog: database.QueryLog, retrieveCampusContext: createCampusDataService({ models: database }).retrieveCampusContext, ...services, limiter: pass }));
  const shopRoutes = createShopRouters(database, auditor, shopLimiter);
  app.use("/api/shops", shopRoutes.shops);
  app.use("/api/shop-owners", shopRoutes.owners);
  app.use("/api/shop-feedback", shopRoutes.feedback);
  app.use("/api/auth", shopRoutes.auth);
  const tracking = createTrackingService({ models: database, transaction: work => mongoose.connection.transaction(work), ...services.tracking });
  app.use("/api/auth", createAuthRouter(database.Faculty, pass, database.ShopOwner, principal => { tracking.requireEnabled(); return tracking.activeDevice(principal); }));
  app.locals.busTracking = tracking;
  app.use("/api/bus-tracking", createTrackingRouter({ service: tracking, models: database, audit: auditor,
    loginLimiter: pass, updateLimiter: pass }));
  const notifications = createNotificationService({ models: database, ...services.notifications });
  app.locals.notifications = notifications;
  app.use("/api/notifications", require("./routes/notifications")({ service: notifications, models: database, audit: auditor, limiter: limiter(limits.push || 20) }));
  app.use((req, res, next) => next(new HttpError(404, "Route not found")));
  app.use(errorHandler);
  return app;
}
const app = createApp();
async function start() {
  validateProductionConfig();
  mongoose.set("bufferCommands", false);
  await connectDB();
  if (app.locals.busTracking.enabled()) {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== "isdbgrid") throw new Error("Bus tracking requires a replica set or sharded MongoDB with transactions");
    await app.locals.busTracking.ready();
  }
  const server = app.listen(process.env.PORT || 5000, () => console.log("AIKYA API is listening"));
  server.on("error", () => { console.error("API listener failed"); process.exitCode = 1; mongoose.disconnect(); });
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => { await mongoose.disconnect(); clearTimeout(deadline); });
  });
  return server;
}
if (require.main === module) start().catch(async () => { console.error(!process.env.MONGODB_URI?.trim() ? "API startup failed: configure MONGODB_URI in server/.env, then restart the backend." : "API startup failed; check server configuration and database access"); await mongoose.disconnect(); process.exitCode = 1; });
module.exports = app;
module.exports.createApp = createApp;
module.exports.start = start;
