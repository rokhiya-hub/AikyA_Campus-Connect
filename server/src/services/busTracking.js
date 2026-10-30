const crypto = require("node:crypto");
const { HttpError } = require("../middleware/errors");
const { signToken } = require("../middleware/auth");
const RETENTION_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 90 * 1000;
const MAX_TRIP_MS = 4 * 60 * 60 * 1000;
const hashSecret = (secret) =>
  crypto.createHash("sha256").update(secret).digest("hex");
function distanceMeters(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const lat = rad(b.latitude - a.latitude),
    lon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function validateFix(fix, trip, now) {
  const recorded = new Date(fix.recordedAt).getTime();
  if (
    recorded < trip.startedAt.getTime() ||
    now - recorded > 30000 ||
    recorded - now > 5000
  )
    throw new HttpError(
      400,
      "GPS timestamp must be from this trip and within the last 30 seconds (maximum 5 seconds clock lead)",
    );
  if (trip.latest) {
    if (now - trip.latest.receivedAt < 5000)
      throw new HttpError(429, "Wait at least 5 seconds between GPS updates");
    const elapsed = recorded - trip.latest.recordedAt.getTime();
    if (elapsed <= 0)
      throw new HttpError(
        409,
        "GPS updates must have strictly increasing timestamps",
      );
    const distance = Math.max(
      0,
      distanceMeters(trip.latest, fix) - trip.latest.accuracy - fix.accuracy,
    );
    if ((distance / (elapsed / 1000)) * 3.6 > 160)
      throw new HttpError(
        400,
        "GPS jump exceeds the tracking speed limit; obtain a fresh accurate fix",
      );
  }
}
function createTrackingService({
  models,
  transaction,
  now = () => new Date(),
  enabled = () => process.env.BUS_TRACKING_ENABLED === "true",
  onChange = () => {},
}) {
  const {
    BusRoute: Bus,
    BusTrip: Trip,
    BusLocation: Location,
    BusDevice: Device,
  } = models;
  function requireEnabled() {
    if (!enabled()) throw new HttpError(503, "Live bus tracking is disabled");
  }
  async function ready() {
    const [trips, locations] = await Promise.all([
      Trip.listIndexes(),
      Location.listIndexes(),
    ]);
    const unique = (field) =>
      trips.some(
        (index) =>
          index.unique &&
          index.key?.[field] === 1 &&
          Object.keys(index.key).length === 1 &&
          index.partialFilterExpression?.status === "active" &&
          Object.keys(index.partialFilterExpression).length === 1,
      );
    const ttl = (indexes) =>
      indexes.some(
        (index) =>
          index.key?.purgeAt === 1 &&
          Object.keys(index.key).length === 1 &&
          index.expireAfterSeconds === 0 &&
          !index.partialFilterExpression,
      );
    if (
      !unique("busId") ||
      !unique("deviceId") ||
      !ttl(trips) ||
      !ttl(locations)
    )
      throw new HttpError(
        503,
        "Tracking uniqueness and retention indexes must be provisioned before trips start",
      );
  }
  async function activeDevice(principal, session) {
    if (principal.role !== "driver")
      throw new HttpError(403, "Driver/device access required");
    const device = await Device.findById(principal.sub)
      .session(session || null)
      .maxTimeMS(3000);
    if (
      !device ||
      !device.enabled ||
      device.expiresAt <= now() ||
      device.tokenVersion !== principal.tokenVersion
    )
      throw new HttpError(403, "Device authorization expired or revoked");
    return device;
  }
  async function busFor(device, session) {
    const bus = await Bus.findById(device.busId)
      .session(session || null)
      .maxTimeMS(3000);
    if (!bus?.trackingEnabled)
      throw new HttpError(403, "This bus is not authorized for tracking");
    return bus;
  }
  const deviceSummary = (device) => ({
    _id: device._id,
    busId: device.busId,
    label: device.label,
    enabled: device.enabled,
    expiresAt: device.expiresAt,
  });
  function sessionFor(device) {
    const seconds = Math.min(
      900,
      Math.floor((device.expiresAt - now()) / 1000),
    );
    if (seconds < 1) throw new HttpError(403, "Device authorization expired");
    return {
      token: signToken(
        {
          role: "driver",
          sub: String(device._id),
          tokenVersion: device.tokenVersion,
        },
        { expiresIn: seconds },
      ),
      busId: device.busId,
      expiresAt: new Date(now().getTime() + seconds * 1000),
    };
  }
  async function authorize(body, actor) {
    requireEnabled();
    const expires = new Date(body.expiresAt);
    if (expires <= now() || expires - now() > 30 * RETENTION_MS)
      throw new HttpError(
        400,
        "Device authorization must expire within 30 days",
      );
    const bus = await Bus.findById(body.busId).maxTimeMS(3000);
    if (!bus?.trackingEnabled)
      throw new HttpError(400, "Enable tracking on an existing bus first");
    const secret = crypto.randomBytes(32).toString("hex");
    const device = await Device.create({
      busId: bus._id,
      label: body.label,
      expiresAt: expires,
      secretHash: hashSecret(secret),
      authorizedBy: actor.sub,
    });
    // Only this provisioning response contains the one-time credential.
    return { ...deviceSummary(device), secret };
  }
  async function login(body) {
    requireEnabled();
    const device = await Device.findById(body.deviceId)
      .select("+secretHash")
      .maxTimeMS(3000);
    const supplied = Buffer.from(hashSecret(body.secret), "hex"),
      expected = Buffer.from(
        device?.secretHash || hashSecret("invalid"),
        "hex",
      );
    const valid = crypto.timingSafeEqual(supplied, expected);
    if (!valid || !device || !device.enabled || device.expiresAt <= now())
      throw new HttpError(401, "Invalid or inactive device credentials");
    await busFor(device);
    return sessionFor(device);
  }
  async function refresh(principal) {
    requireEnabled();
    const device = await activeDevice(principal);
    await busFor(device);
    return sessionFor(device);
  }
  async function start(body, principal) {
    requireEnabled();
    await ready();
    return transaction(async (session) => {
      let device;
      if (principal.role === "admin") {
        device =
          body.deviceId &&
          (await Device.findById(body.deviceId)
            .session(session)
            .maxTimeMS(3000));
        if (!device || !device.enabled || device.expiresAt <= now())
          throw new HttpError(400, "Select an active authorized device");
      } else {
        device = await activeDevice(principal, session);
        if (body.deviceId && body.deviceId !== String(device._id))
          throw new HttpError(403, "Cannot start another device's trip");
      }
      await busFor(device, session);
      const existing = await Trip.findOne({
        busId: device.busId,
        status: "active",
      })
        .session(session)
        .maxTimeMS(3000);
      if (existing)
        throw new HttpError(
          409,
          "End the previous trip before starting another, including expired trips",
        );
      const time = now(),
        expiresAt = new Date(
          Math.min(time.getTime() + MAX_TRIP_MS, device.expiresAt.getTime()),
        );
      const trip = new Trip({
        busId: device.busId,
        deviceId: device._id,
        deviceVersion: device.tokenVersion,
        status: "active",
        consentAt: time,
        startedAt: time,
        expiresAt,
        leaseExpiresAt: new Date(
          Math.min(time.getTime() + LEASE_MS, expiresAt.getTime()),
        ),
        purgeAt: new Date(expiresAt.getTime() + RETENTION_MS),
      });
      device.lastUsedAt = time;
      await device.save({ session });
      await trip.save({ session });
      return tripSummary(trip);
    });
  }
  function tripSummary(trip) {
    return {
      _id: trip._id,
      busId: trip.busId,
      status: trip.status,
      startedAt: trip.startedAt,
      expiresAt: trip.expiresAt,
      leaseExpiresAt: trip.leaseExpiresAt,
    };
  }
  async function ownedTrip(id, principal, session, allowExpired = false) {
    const trip = await Trip.findById(id).session(session).maxTimeMS(3000);
    if (!trip) throw new HttpError(404, "Trip not found");
    let device;
    if (principal.role === "driver") {
      device = await activeDevice(principal, session);
      if (
        String(trip.deviceId) !== principal.sub ||
        trip.deviceVersion !== device.tokenVersion
      )
        throw new HttpError(
          403,
          "Trip belongs to another device or authorization",
        );
    } else if (principal.role !== "admin")
      throw new HttpError(403, "Driver or admin access required");
    if (
      !allowExpired &&
      (trip.status !== "active" ||
        trip.expiresAt <= now() ||
        trip.leaseExpiresAt <= now())
    )
      throw new HttpError(
        409,
        "Trip is ended or its tracking authorization has expired; end it and start again with consent",
      );
    return { trip, device };
  }
  async function ingest(id, fix, principal) {
    requireEnabled();
    if (principal.role !== "driver")
      throw new HttpError(403, "Only an assigned device may submit GPS");
    const receipt = await transaction(async (session) => {
      const { trip, device } = await ownedTrip(id, principal, session);
      await busFor(device, session);
      const receivedAt = now();
      validateFix(fix, trip, receivedAt);
      const point = {
        ...fix,
        recordedAt: new Date(fix.recordedAt),
        receivedAt,
        trackingStatus: "receiving",
      };
      const location = new Location({
        busId: trip.busId,
        tripId: trip._id,
        ...point,
        purgeAt: new Date(receivedAt.getTime() + RETENTION_MS),
      });
      trip.latest = point;
      // Embedded latest coordinates have the same retention deadline as history.
      trip.purgeAt = new Date(receivedAt.getTime() + RETENTION_MS);
      trip.leaseExpiresAt = new Date(
        Math.min(receivedAt.getTime() + LEASE_MS, trip.expiresAt.getTime()),
      );
      device.lastUsedAt = receivedAt;
      // Replica-set transaction: no acknowledged point without both latest state and history.
      // Writing the grant serializes ingestion against concurrent device revocation.
      await device.save({ session });
      await trip.save({ session });
      await location.save({ session });
      return {
        busId: trip.busId,
        tripId: trip._id,
        receivedAt,
        leaseExpiresAt: trip.leaseExpiresAt,
        trackingStatus: "receiving",
      };
    });
    try {
      onChange({
        busId: String(receipt.busId),
        tripId: String(receipt.tripId),
      });
    } catch {
      /* A transport subscriber cannot invalidate a committed update. */
    }
    return receipt;
  }
  async function end(id, principal) {
    requireEnabled();
    const result = await transaction(async (session) => {
      const { trip } = await ownedTrip(id, principal, session, true);
      if (trip.status === "ended") return tripSummary(trip);
      trip.status = "ended";
      trip.endedAt = now();
      trip.latest = undefined;
      trip.leaseExpiresAt = now();
      trip.purgeAt = new Date(now().getTime() + RETENTION_MS);
      await trip.save({ session });
      return tripSummary(trip);
    });
    try {
      onChange({ busId: String(result.busId), tripId: String(result._id) });
    } catch {}
    return result;
  }
  async function current(principal) {
    requireEnabled();
    const device = await activeDevice(principal);
    const trip = await Trip.findOne({
      deviceId: device._id,
      status: "active",
    }).maxTimeMS(3000);
    return trip ? tripSummary(trip) : null;
  }
  async function live(query) {
    requireEnabled();
    const time = now(),
      filter = {
        status: "active",
        expiresAt: { $gt: time },
        ...(query.busId ? { busId: query.busId } : {}),
      };
    const trips = await Trip.find(filter)
      .sort({ _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit + 1)
      .maxTimeMS(3000);
    const rows = await Promise.all(
      trips.slice(0, query.limit).map(async (trip) => {
        const [bus, device] = await Promise.all([
          Bus.findById(trip.busId).maxTimeMS(3000),
          Device.findById(trip.deviceId).maxTimeMS(3000),
        ]);
        if (
          !bus?.trackingEnabled ||
          !device?.enabled ||
          device.expiresAt <= time ||
          device.tokenVersion !== trip.deviceVersion
        )
          return null;
        const age = trip.latest
          ? Math.max(0, time - trip.latest.receivedAt)
          : Infinity;
        const status =
          trip.leaseExpiresAt <= time || age > LEASE_MS
            ? "offline"
            : age > 30000
              ? "stale"
              : "live";
        return {
          busId: bus._id,
          tripId: trip._id,
          routeNumber: bus.routeNumber,
          vehicleLabel: bus.vehicleLabel || "",
          routeDescription: bus.routeDescription || "",
          stops: bus.stops.map((stop) => ({
            name: stop.name,
            time: stop.time,
          })),
          trackingStatus: status,
          recordedAt: trip.latest?.recordedAt || null,
          receivedAt: trip.latest?.receivedAt || null,
          authorizationExpiresAt: new Date(
            Math.min(
              trip.leaseExpiresAt.getTime(),
              trip.expiresAt.getTime(),
              device.expiresAt.getTime(),
            ),
          ),
          location:
            status === "offline" || !trip.latest
              ? null
              : {
                  latitude: trip.latest.latitude,
                  longitude: trip.latest.longitude,
                  accuracy: trip.latest.accuracy,
                },
          eta: {
            available: false,
            reason:
              "Verified route geometry, stop positions and a validated arrival model are not configured",
          },
        };
      }),
    );
    return {
      data: rows.filter(Boolean),
      hasMore: trips.length > query.limit,
      calculatedAt: time,
    };
  }
  return {
    enabled,
    requireEnabled,
    ready,
    authorize,
    login,
    refresh,
    activeDevice,
    start,
    end,
    ingest,
    current,
    live,
    deviceSummary,
  };
}
module.exports = {
  createTrackingService,
  validateFix,
  distanceMeters,
  hashSecret,
  RETENTION_MS,
  LEASE_MS,
  MAX_TRIP_MS,
};
