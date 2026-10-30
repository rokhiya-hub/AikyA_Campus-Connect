const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = require("node:crypto").randomBytes(32).toString("hex");
process.env.CLIENT_ORIGIN = "http://localhost:5173";
const { createApp } = require("../src/server");
const { memoryModel } = require("../test-support/memoryModels");
const { signToken } = require("../src/middleware/auth");
const { createAuditor } = require("../src/services/auditService");
const { RETENTION_MS, MAX_TRIP_MS } = require("../src/services/busTracking");
const models = Object.fromEntries(
  [
    "Faculty",
    "Department",
    "PointOfInterest",
    "BusRoute",
    "Event",
    "QueryLog",
    "AuditLog",
    "ShopOwner",
    "ShopFeedback",
    "BusDevice",
    "BusTrip",
    "BusLocation",
  ].map((name) => [name, memoryModel(name)]),
);
let clock = new Date(),
  feature = true,
  server,
  base,
  changes = [];
let queue = Promise.resolve();
// Serial, rollback-capable test transactions. MongoDB behavior still needs replica-set rehearsal.
const transaction = (work) => {
  const run = queue.then(async () => {
    const snapshots = ["BusDevice", "BusTrip", "BusLocation"].map((name) => [
      models[name],
      new Map(models[name].records),
    ]);
    try {
      return await work(null);
    } catch (error) {
      for (const [Model, snapshot] of snapshots) {
        Model.records.clear();
        for (const [key, value] of snapshot) Model.records.set(key, value);
      }
      throw error;
    }
  });
  queue = run.catch(() => {});
  return run;
};
const admin = signToken({ role: "admin", sub: "synthetic-tracking-admin" });
const outsiderId = new (require("mongoose").Types.ObjectId)().toString();
const faculty = signToken({ role: "faculty", sub: outsiderId });
const shopOwner = signToken({ role: "shop_owner", sub: outsiderId });
const request = (path, method = "GET", body, token) =>
  fetch(base + "/api" + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const advance = (ms) => {
  clock = new Date(clock.getTime() + ms);
};
test("production tracking requires HTTPS browser origins", () => {
  const { validateProductionConfig } = require("../src/config/security");
  const env = {
    NODE_ENV: "production",
    JWT_SECRET: require("node:crypto").randomBytes(32).toString("hex"),
    ADMIN_USERNAME: "synthetic",
    ADMIN_PASSWORD: "synthetic-long-password",
    MONGODB_URI: "synthetic-not-used",
    CLIENT_ORIGIN: "http://localhost:5173",
    BUS_TRACKING_ENABLED: "true",
  };
  assert.throws(() => validateProductionConfig(env), /HTTPS/);
  assert.doesNotThrow(() =>
    validateProductionConfig({
      ...env,
      CLIENT_ORIGIN: "https://campus.example.test",
    }),
  );
});
const fix = (extra = {}) => ({
  latitude: 17,
  longitude: 82,
  accuracy: 15,
  recordedAt: clock.toISOString(),
  ...extra,
});
before(async () => {
  server = createApp({
    models,
    audit: createAuditor(models.AuditLog),
    services: {
      tracking: {
        transaction,
        now: () => clock,
        enabled: () => feature,
        onChange: (change) => changes.push(change),
      },
    },
    limits: { trackingLogin: 500, trackingUpdates: 500 },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
async function assigned() {
  const bus = await models.BusRoute.create({
    routeNumber: "Synthetic route",
    trackingEnabled: true,
    driverName: "PRIVATE SYNTHETIC NAME",
    driverContact: "PRIVATE SYNTHETIC CONTACT",
    stops: [{ name: "Synthetic stop", time: "Synthetic schedule" }],
  });
  const grantResponse = await request(
    "/bus-tracking/devices",
    "POST",
    {
      busId: String(bus._id),
      label: "Synthetic mounted device",
      expiresAt: new Date(clock.getTime() + RETENTION_MS).toISOString(),
    },
    admin,
  );
  assert.equal(grantResponse.status, 201);
  const device = await grantResponse.json();
  const login = await request("/bus-tracking/devices/session", "POST", {
    deviceId: device._id,
    secret: device.secret,
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  return { bus, device, token: session.token };
}
async function started() {
  const assignedDevice = await assigned();
  const response = await request(
    "/bus-tracking/trips",
    "POST",
    { consent: true },
    assignedDevice.token,
  );
  assert.equal(response.status, 201);
  return { ...assignedDevice, trip: await response.json() };
}
test("tracking defaults off and does not break existing route browsing", async () => {
  const app = createApp({
    models,
    audit: createAuditor(models.AuditLog),
    services: { tracking: { enabled: () => false } },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => app.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${app.address().port}/api`;
    assert.equal(
      (await (await fetch(url + "/bus-tracking/status")).json()).enabled,
      false,
    );
    assert.equal((await fetch(url + "/bus-tracking/live")).status, 503);
    assert.equal((await fetch(url + "/buses")).status, 200);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});
test("device authorization is admin-only, bus-scoped, expiring and never exposes stored credentials", async () => {
  const a = await assigned();
  for (const bearer of [undefined, faculty, shopOwner, a.token])
    assert.equal(
      (
        await request(
          "/bus-tracking/devices",
          "POST",
          {
            busId: String(a.bus._id),
            label: "Denied",
            expiresAt: new Date(clock.getTime() + 1000).toISOString(),
          },
          bearer,
        )
      ).status,
      bearer ? 403 : 401,
    );
  const list = await (
    await request("/bus-tracking/devices", "GET", null, admin)
  ).json();
  assert.ok(
    list.data.every(
      (item) =>
        !item.secret && !item.secretHash && item.tokenVersion === undefined,
    ),
  );
  const stored = await models.BusDevice.findById(a.device._id);
  assert.notEqual(stored.secretHash, a.device.secret);
  assert.equal(stored.secretHash.length, 64);
  assert.equal(
    (
      await request("/bus-tracking/devices/session", "POST", {
        deviceId: a.device._id,
        secret: "0".repeat(64),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/bus-tracking/devices",
        "POST",
        {
          busId: String(a.bus._id),
          label: "Expired",
          expiresAt: new Date(clock - 1).toISOString(),
        },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/bus-tracking/devices",
        "POST",
        {
          busId: String(a.bus._id),
          label: "Too long",
          expiresAt: new Date(
            clock.getTime() + 31 * RETENTION_MS,
          ).toISOString(),
        },
        admin,
      )
    ).status,
    400,
  );
  assert.ok(
    !JSON.stringify([...models.AuditLog.records.values()]).includes(
      a.device.secret,
    ),
  );
});
test("trip start requires consent, active bus authorization and correct device scope", async () => {
  const a = await assigned(),
    b = await assigned();
  assert.equal(
    (await request("/bus-tracking/trips", "POST", { consent: false }, a.token))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "/bus-tracking/trips",
        "POST",
        { consent: true, deviceId: b.device._id },
        a.token,
      )
    ).status,
    403,
  );
  for (const bearer of [undefined, faculty, shopOwner])
    assert.equal(
      (await request("/bus-tracking/trips", "POST", { consent: true }, bearer))
        .status,
      bearer ? 403 : 401,
    );
  a.bus.trackingEnabled = false;
  await a.bus.save();
  assert.equal(
    (await request("/bus-tracking/trips", "POST", { consent: true }, a.token))
      .status,
    403,
  );
  assert.equal(
    (await request("/bus-tracking/trips", "POST", { consent: true }, admin))
      .status,
    400,
  );
});
test("concurrent dispatch requests cannot create two active trips for the same bus", async () => {
  const a = await assigned();
  const results = await Promise.all([
    request("/bus-tracking/trips", "POST", { consent: true }, a.token),
    request("/bus-tracking/trips", "POST", { consent: true }, a.token),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const current = await (
    await request("/bus-tracking/trips/current", "GET", null, a.token)
  ).json();
  assert.ok(current.trip);
  assert.ok(new Date(current.trip.expiresAt) - clock <= MAX_TRIP_MS);
});
test("GPS uploads persist current state/history with server receipt time and private device IDs", async () => {
  const a = await started();
  advance(1000);
  const res = await request(
    `/bus-tracking/trips/${a.trip._id}/locations`,
    "POST",
    fix(),
    a.token,
  );
  assert.equal(res.status, 201);
  const receipt = await res.json();
  assert.equal(receipt.receivedAt, clock.toISOString());
  assert.equal(receipt.latitude, undefined);
  const history = [...models.BusLocation.records.values()].find(
    (row) => String(row.tripId) === a.trip._id,
  );
  assert.equal(history.latitude, 17);
  assert.equal(String(history.busId), String(a.bus._id));
  assert.equal(history.trackingStatus, "receiving");
  assert.equal(history.purgeAt - history.receivedAt, RETENTION_MS);
  const live = await (
    await request(`/bus-tracking/live?busId=${a.bus._id}`)
  ).json();
  assert.equal(live.data[0].location.latitude, 17);
  assert.equal(live.data[0].trackingStatus, "live");
  assert.equal(live.data[0].eta.available, false);
  assert.equal(live.data[0].stops[0].name, "Synthetic stop");
  const data = JSON.stringify(live);
  assert.ok(!data.includes("PRIVATE SYNTHETIC"));
  assert.ok(!data.includes(a.device._id));
  assert.ok(!data.includes(a.device.secret));
  assert.deepEqual(changes.at(-1), {
    busId: String(a.bus._id),
    tripId: a.trip._id,
  });
});
test("coordinate bounds, accuracy, fresh timestamps and strict permitted fields reject unsafe locations", async () => {
  const a = await started();
  advance(1000);
  for (const body of [
    fix({ latitude: 91 }),
    fix({ longitude: -181 }),
    fix({ accuracy: 201 }),
    fix({ accuracy: -1 }),
    fix({ recordedAt: new Date(clock - 31000).toISOString() }),
    fix({ recordedAt: new Date(clock.getTime() + 6000).toISOString() }),
    fix({ driverId: outsiderId }),
    fix({ source: "simulated" }),
    fix({ receivedAt: clock.toISOString() }),
  ])
    assert.equal(
      (
        await request(
          `/bus-tracking/trips/${a.trip._id}/locations`,
          "POST",
          body,
          a.token,
        )
      ).status,
      400,
    );
  assert.equal((await request("/bus-tracking/live?busId[$ne]=x")).status, 400);
  assert.equal((await request("/bus-tracking/live?limit=1000")).status, 400);
  assert.equal(
    (
      await request(
        "/bus-tracking/trips/invalid/locations",
        "POST",
        fix(),
        a.token,
      )
    ).status,
    400,
  );
});
test("update frequency, replayed timestamps and improbable speed jumps are rejected without history writes", async () => {
  const a = await started();
  advance(1000);
  const first = fix();
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        first,
        a.token,
      )
    ).status,
    201,
  );
  const before = models.BusLocation.records.size;
  advance(1000);
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        fix(),
        a.token,
      )
    ).status,
    429,
  );
  advance(5000);
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        first,
        a.token,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        fix({ latitude: 18 }),
        a.token,
      )
    ).status,
    400,
  );
  assert.equal(models.BusLocation.records.size, before);
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        fix({ latitude: 17.0001 }),
        a.token,
      )
    ).status,
    201,
  );
});
test("drivers cannot upload or end another trip, mutate campus data or access admin history/analytics", async () => {
  const a = await started(),
    b = await started();
  advance(1000);
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        fix(),
        b.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/end`,
        "POST",
        {},
        b.token,
      )
    ).status,
    403,
  );
  for (const bearer of [undefined, faculty, shopOwner, admin])
    assert.equal(
      (
        await request(
          `/bus-tracking/trips/${a.trip._id}/locations`,
          "POST",
          fix(),
          bearer,
        )
      ).status,
      bearer ? 403 : 401,
    );
  for (const path of [
    "/bus-tracking/devices",
    "/bus-tracking/trips",
    "/chat/analytics",
  ])
    assert.equal((await request(path, "GET", null, a.token)).status, 403);
  assert.equal(
    (
      await request(
        `/buses/${a.bus._id}`,
        "PUT",
        { trackingEnabled: true },
        a.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/faculty/${a.device._id}`,
        "PUT",
        { designation: "Denied" },
        a.token,
      )
    ).status,
    403,
  );
  assert.equal((await request("/bus-tracking/history")).status, 404);
});
test("stale fixes become offline without coordinates, and expired leases cannot resume without a new consented trip", async () => {
  const a = await started();
  advance(1000);
  await request(
    `/bus-tracking/trips/${a.trip._id}/locations`,
    "POST",
    fix(),
    a.token,
  );
  advance(31000);
  let feed = await (
    await request(`/bus-tracking/live?busId=${a.bus._id}`)
  ).json();
  assert.equal(feed.data[0].trackingStatus, "stale");
  assert.ok(feed.data[0].location);
  advance(60000);
  feed = await (await request(`/bus-tracking/live?busId=${a.bus._id}`)).json();
  assert.equal(feed.data[0].trackingStatus, "offline");
  assert.equal(feed.data[0].location, null);
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        fix(),
        a.token,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/end`,
        "POST",
        {},
        a.token,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/bus-tracking/trips", "POST", { consent: true }, a.token))
      .status,
    201,
  );
});
test("ending a trip clears latest coordinates and immediately removes it from the public feed", async () => {
  const a = await started();
  advance(1000);
  await request(
    `/bus-tracking/trips/${a.trip._id}/locations`,
    "POST",
    fix(),
    a.token,
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/end`,
        "POST",
        {},
        a.token,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await (await request(`/bus-tracking/live?busId=${a.bus._id}`)).json())
      .data,
    [],
  );
  const stored = await models.BusTrip.findById(a.trip._id);
  assert.equal(stored.latest, undefined);
  assert.equal(stored.status, "ended");
  const purgeAt = stored.purgeAt.toISOString();
  advance(1000);
  await request(`/bus-tracking/trips/${a.trip._id}/end`, "POST", {}, a.token);
  assert.equal(
    (await models.BusTrip.findById(a.trip._id)).purgeAt.toISOString(),
    purgeAt,
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        fix(),
        a.token,
      )
    ).status,
    409,
  );
});
test("revoking a device or disabling its bus hides GPS and blocks updates and session renewal", async () => {
  const a = await started();
  advance(1000);
  await request(
    `/bus-tracking/trips/${a.trip._id}/locations`,
    "POST",
    fix(),
    a.token,
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/devices/${a.device._id}`,
        "PUT",
        { enabled: false },
        admin,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await (await request(`/bus-tracking/live?busId=${a.bus._id}`)).json())
      .data,
    [],
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${a.trip._id}/locations`,
        "POST",
        fix(),
        a.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/bus-tracking/devices/session/refresh",
        "POST",
        {},
        a.token,
      )
    ).status,
    403,
  );
  assert.equal((await request("/auth/me", "GET", null, a.token)).status, 403);
  const b = await started();
  advance(1000);
  await request(
    `/bus-tracking/trips/${b.trip._id}/locations`,
    "POST",
    fix(),
    b.token,
  );
  b.bus.trackingEnabled = false;
  await b.bus.save();
  assert.deepEqual(
    (await (await request(`/bus-tracking/live?busId=${b.bus._id}`)).json())
      .data,
    [],
  );
  assert.equal(
    (
      await request(
        `/bus-tracking/trips/${b.trip._id}/locations`,
        "POST",
        fix(),
        b.token,
      )
    ).status,
    403,
  );
});
test("admin can dispatch/end assigned trips, list abandoned metadata without GPS and ordinary drivers can renew sessions", async () => {
  const a = await assigned();
  const dispatched = await request(
    "/bus-tracking/trips",
    "POST",
    { consent: true, deviceId: a.device._id },
    admin,
  );
  assert.equal(dispatched.status, 201);
  const trip = await dispatched.json();
  const list = await (
    await request(`/bus-tracking/trips?busId=${a.bus._id}`, "GET", null, admin)
  ).json();
  assert.equal(list.data[0]._id, trip._id);
  assert.equal(list.data[0].latest, undefined);
  assert.equal(
    (
      await request(
        "/bus-tracking/devices/session/refresh",
        "POST",
        {},
        a.token,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/bus-tracking/trips/${trip._id}/end`, "POST", {}, admin))
      .status,
    200,
  );
});
test("missing retention/uniqueness indexes and expired grants fail closed before trip creation", async () => {
  const a = await assigned();
  const original = models.BusTrip.listIndexes;
  models.BusTrip.listIndexes = async () => [];
  try {
    assert.equal(
      (await request("/bus-tracking/trips", "POST", { consent: true }, a.token))
        .status,
      503,
    );
  } finally {
    models.BusTrip.listIndexes = original;
  }
  const device = await models.BusDevice.findById(a.device._id);
  device.expiresAt = new Date(clock - 1);
  await device.save();
  assert.equal(
    (await request("/bus-tracking/trips", "POST", { consent: true }, a.token))
      .status,
    403,
  );
  assert.equal(
    (
      await request("/bus-tracking/devices/session", "POST", {
        deviceId: a.device._id,
        secret: a.device.secret,
      })
    ).status,
    401,
  );
});
test("history write failure rolls back current location and suppresses transport notifications", async () => {
  const a = await started();
  advance(1000);
  const original = models.BusLocation.prototype.save,
    before = changes.length;
  models.BusLocation.prototype.save = async () => {
    throw new Error("Synthetic storage failure");
  };
  try {
    assert.equal(
      (
        await request(
          `/bus-tracking/trips/${a.trip._id}/locations`,
          "POST",
          fix(),
          a.token,
        )
      ).status,
      500,
    );
  } finally {
    models.BusLocation.prototype.save = original;
  }
  assert.equal((await models.BusTrip.findById(a.trip._id)).latest, undefined);
  assert.equal(changes.length, before);
});
test("tracking session/upload limits include malformed attempts before parsing or database access", async () => {
  const instance = createApp({
    models,
    services: {
      tracking: { enabled: () => true, transaction, now: () => clock },
    },
    audit: createAuditor(models.AuditLog),
    limits: { trackingLogin: 1, trackingUpdates: 1 },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => instance.once("listening", resolve));
  const send = (path, body) =>
    fetch(
      `http://127.0.0.1:${instance.address().port}/api/bus-tracking${path}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
  try {
    assert.equal((await send("/devices/session", "{")).status, 400);
    assert.equal((await send("/devices/session", "{}")).status, 429);
    const path = `/trips/${outsiderId}/locations`;
    assert.equal((await send(path, "{}")).status, 401);
    assert.equal((await send(path, "{}")).status, 429);
  } finally {
    await new Promise((resolve) => instance.close(resolve));
  }
});
