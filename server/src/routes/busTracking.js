const express = require("express");
const { adminOnly, requireAuth } = require("../middleware/auth");
const { HttpError, asyncRoute } = require("../middleware/errors");
const { z, parse, validateId, validateQuery } = require("../validation");
const schemas = require("../validation/busTracking");
function createTrackingRouter({
  service,
  models,
  audit,
  loginLimiter,
  updateLimiter,
}) {
  const router = express.Router();
  router.get("/status", validateQuery(), (req, res) =>
    res.json({ enabled: service.enabled(), pollIntervalMs: 12000 }),
  );
  router.use((req, res, next) => {
    try {
      service.requireEnabled();
      next();
    } catch (error) {
      next(error);
    }
  });
  router.post(
    "/devices/session",
    loginLimiter,
    validateQuery(),
    asyncRoute(async (req, res) =>
      res.json(await service.login(parse(schemas.session, req.body))),
    ),
  );
  router.post(
    "/devices/session/refresh",
    loginLimiter,
    requireAuth,
    validateQuery(),
    asyncRoute(async (req, res) => {
      parse(z.strictObject({}), req.body);
      res.json(await service.refresh(req.admin));
    }),
  );
  router.get(
    "/devices",
    adminOnly,
    validateQuery(schemas.query),
    asyncRoute(async (req, res) => {
      const { page, limit, busId } = req.validQuery;
      const devices = await models.BusDevice.find(busId ? { busId } : {})
        .sort({ _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit + 1)
        .maxTimeMS(3000);
      res.json({
        data: devices.slice(0, limit).map(service.deviceSummary),
        hasMore: devices.length > limit,
      });
    }),
  );
  router.post(
    "/devices",
    adminOnly,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const body = parse(schemas.device, req.body);
      const result = await audit(
        req,
        "BusDevice",
        "create",
        ["busId", "label", "expiresAt"],
        () => service.authorize(body, req.admin),
      );
      res.status(201).json(result);
    }),
  );
  router.put(
    "/devices/:id",
    adminOnly,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      parse(z.strictObject({ enabled: z.literal(false) }), req.body);
      const device = await models.BusDevice.findById(req.params.id).maxTimeMS(
        3000,
      );
      if (!device) throw new HttpError(404, "Device not found");
      device.enabled = false;
      device.tokenVersion += 1;
      await audit(req, "BusDevice", "update", ["enabled"], () => device.save());
      res.json(service.deviceSummary(device));
    }),
  );
  router.get(
    "/live",
    validateQuery(schemas.query),
    asyncRoute(async (req, res) =>
      res.json(await service.live(req.validQuery)),
    ),
  );
  function driverOrAdmin(req, res, next) {
    requireAuth(req, res, (error) => {
      if (error) return next(error);
      if (!["driver", "admin"].includes(req.admin.role))
        return next(new HttpError(403, "Driver or admin access required"));
      next();
    });
  }
  router.get(
    "/trips/current",
    requireAuth,
    validateQuery(),
    asyncRoute(async (req, res) =>
      res.json({ trip: await service.current(req.admin) }),
    ),
  );
  router.get(
    "/trips",
    adminOnly,
    validateQuery(schemas.query),
    asyncRoute(async (req, res) => {
      const { page, limit, busId } = req.validQuery;
      const rows = await models.BusTrip.find({
        status: "active",
        ...(busId ? { busId } : {}),
      })
        .sort({ _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit + 1)
        .maxTimeMS(3000);
      res.json({
        data: rows
          .slice(0, limit)
          .map((trip) => ({
            _id: trip._id,
            busId: trip.busId,
            deviceId: trip.deviceId,
            expiresAt: trip.expiresAt,
            leaseExpiresAt: trip.leaseExpiresAt,
          })),
        hasMore: rows.length > limit,
      });
    }),
  );
  router.post(
    "/trips",
    driverOrAdmin,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const body = parse(schemas.start, req.body);
      const trip = await audit(
        req,
        "BusTrip",
        "create",
        ["consentAt", "busId", "deviceId"],
        () => service.start(body, req.admin),
      );
      res.status(201).json(trip);
    }),
  );
  router.post(
    "/trips/:id/end",
    driverOrAdmin,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      parse(z.strictObject({}), req.body);
      res.json(
        await audit(req, "BusTrip", "update", ["status", "endedAt"], () =>
          service.end(req.params.id, req.admin),
        ),
      );
    }),
  );
  router.post(
    "/trips/:id/locations",
    updateLimiter,
    requireAuth,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      res
        .status(201)
        .json(
          await service.ingest(
            req.params.id,
            parse(schemas.location, req.body),
            req.admin,
          ),
        );
    }),
  );
  return router;
}
module.exports = createTrackingRouter;
