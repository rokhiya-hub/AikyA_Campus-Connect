// Opt-in only. Refuses production/remote DBs and cleans up only its own synthetic IDs.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { assertSeedSafety } = require("../src/seed/safety");
async function run() {
  const uri = process.env.TRACKING_TEST_MONGODB_URI;
  assertSeedSafety({ NODE_ENV: "test", MONGODB_URI: uri }, ["--confirm-local"]);
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  process.env.MONGODB_URI = uri;
  process.env.ADMIN_USERNAME = "";
  process.env.ADMIN_PASSWORD = "";
  const mongoose = require("mongoose");
  await mongoose.connect(uri, { autoIndex: false });
  let server, bus;
  const actorId = `synthetic-mongo-${crypto.randomBytes(12).toString("hex")}`;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName, "An explicitly local replica set is required");
    const { createApp } = require("../src/server");
    const Bus = require("../src/models/BusRoute"),
      Trip = require("../src/models/BusTrip"),
      Device = require("../src/models/BusDevice"),
      Location = require("../src/models/BusLocation");
    for (const Model of [Trip, Device, Location]) await Model.createIndexes();
    const Audit = require("../src/models/AuditLog");
    await Audit.createCollection();
    bus = await Bus.create({ routeNumber: actorId, trackingEnabled: true });
    server = createApp({
      services: { tracking: { enabled: () => true } },
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const request = (path, body, token) =>
      fetch(
        `http://127.0.0.1:${server.address().port}/api/bus-tracking${path}`,
        {
          method: body ? "POST" : "GET",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    const admin = require("../src/middleware/auth").signToken({
      role: "admin",
      sub: actorId,
    });
    const provision = await request(
      "/devices",
      {
        busId: String(bus._id),
        label: "Synthetic integration device",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      admin,
    );
    assert.equal(provision.status, 201);
    const device = await provision.json();
    const login = await request("/devices/session", {
      deviceId: device._id,
      secret: device.secret,
    });
    assert.equal(login.status, 200);
    const token = (await login.json()).token;
    const starts = await Promise.all([
      request("/trips", { consent: true }, token),
      request("/trips", { consent: true }, token),
    ]);
    assert.deepEqual(
      starts.map((response) => response.status).sort(),
      [201, 409],
    );
    const trip = await Trip.findOne({ busId: bus._id, status: "active" });
    assert.ok(trip);
    const response = await request(
      `/trips/${trip._id}/locations`,
      {
        latitude: 17,
        longitude: 82,
        accuracy: 15,
        recordedAt: new Date().toISOString(),
      },
      token,
    );
    assert.equal(response.status, 201);
    assert.equal(await Location.countDocuments({ tripId: trip._id }), 1);
    assert.ok((await Trip.findById(trip._id)).latest);
    const history = await Location.findOne({ tripId: trip._id });
    assert.equal(history.purgeAt - history.receivedAt, 86400000);
    assert.equal(
      (await Trip.findById(trip._id)).purgeAt.getTime(),
      history.purgeAt.getTime(),
    );
    await new Promise((resolve) => setTimeout(resolve, 5100));
    const previousFix = (
      await Trip.findById(trip._id)
    ).latest.recordedAt.toISOString();
    const originalSave = Location.prototype.save;
    Location.prototype.save = async () => {
      throw new Error(
        "Synthetic history failure for transaction rollback test",
      );
    };
    try {
      assert.equal(
        (
          await request(
            `/trips/${trip._id}/locations`,
            {
              latitude: 17,
              longitude: 82,
              accuracy: 15,
              recordedAt: new Date().toISOString(),
            },
            token,
          )
        ).status,
        500,
      );
    } finally {
      Location.prototype.save = originalSave;
    }
    assert.equal(
      (await Trip.findById(trip._id)).latest.recordedAt.toISOString(),
      previousFix,
    );
    assert.equal(await Location.countDocuments({ tripId: trip._id }), 1);
    assert.equal(
      (await request(`/trips/${trip._id}/end`, {}, token)).status,
      200,
    );
    assert.equal((await Trip.findById(trip._id)).latest, undefined);
    assert.deepEqual(
      (await (await request(`/live?busId=${bus._id}`)).json()).data,
      [],
    );
    console.log(
      "Mongo tracking integration PASS: real replica-set transactions and failure rollback, concurrent dispatch uniqueness, current/history persistence, retention deadline and end-trip privacy.",
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (bus) {
      const Device = require("../src/models/BusDevice"),
        Trip = require("../src/models/BusTrip"),
        Location = require("../src/models/BusLocation"),
        Audit = require("../src/models/AuditLog");
      const devices = await Device.find({ busId: bus._id }).select("_id");
      await Audit.deleteMany({
        actorId: {
          $in: [actorId, ...devices.map((device) => String(device._id))],
        },
      });
      await Location.deleteMany({ busId: bus._id });
      await Trip.deleteMany({ busId: bus._id });
      await Device.deleteMany({ busId: bus._id });
      await bus.deleteOne();
    }
    await mongoose.disconnect();
  }
}
run().catch(() => {
  console.error(
    "Mongo tracking integration failed. Use an isolated loopback _test replica set; no remote/production target is accepted.",
  );
  process.exitCode = 1;
});
