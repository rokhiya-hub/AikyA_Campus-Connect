const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = require("node:crypto").randomBytes(32).toString("hex");
process.env.CLIENT_ORIGIN = "http://localhost:5173";
const { createApp } = require("../src/server");
const { memoryModel } = require("../test-support/memoryModels");
const { createAuditor } = require("../src/services/auditService");
const { signToken } = require("../src/middleware/auth");
const {
  openingStatus,
  publicItem,
  STOCK_TTL,
  PRICE_TTL,
} = require("../src/services/shopData");
const { plan } = require("../scripts/migrate-shops");
const v = require("../src/validation/shops");
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
  ].map((name) => [name, memoryModel(name)]),
);
const admin = signToken({ role: "admin", sub: "synthetic-admin" });
let server, base, owner, token, shop, other;
const request = (path, method = "GET", body, bearer) =>
  fetch(base + "/api" + path, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
before(async () => {
  owner = await models.ShopOwner.create({
    name: "Synthetic owner",
    email: "owner@example.test",
    passwordHash: await require("bcryptjs").hash("synthetic-test-password", 4),
    status: "approved",
  });
  token = signToken({
    role: "shop_owner",
    sub: String(owner._id),
    tokenVersion: 0,
  });
  shop = await models.PointOfInterest.create({
    type: "shop",
    name: "Synthetic print shop",
    area: "Synthetic Area",
    contact: "Synthetic contact",
    shopOwnerId: owner._id,
    items: [
      {
        name: "B/W Xerox",
        price: "Synthetic display price",
        category: "printing",
      },
      { name: "Notebook", category: "stationery" },
    ],
  });
  other = await models.PointOfInterest.create({
    type: "shop",
    name: "Synthetic other",
    items: [{ name: "Colour photocopy", category: "printing" }],
  });
  server = createApp({
    models,
    audit: createAuditor(models.AuditLog),
    limits: { login: 100, shop: 100 },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
test("product search matches item names, aliases and categories within the same item; pages remain arrays", async () => {
  for (const query of ["xerox", "photocopy"]) {
    const res = await request(`/shops?q=${query}&limit=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Has-More"), "true");
    const rows = await res.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].items.length, 1);
    assert.equal(rows[0].dataStatus, "demo_unverified");
  }
  const rows = await (
    await request("/shops?q=colour%20photocopy&itemCategory=printing")
  ).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, String(other._id));
  assert.deepEqual(
    await (await request("/shops?q=xerox%20notebook")).json(),
    [],
  );
  assert.equal((await request("/shops?limit=201")).status, 400);
  assert.equal((await request("/shops?q[$ne]=x")).status, 400);
  assert.equal((await request("/shops?mine=true")).status, 401);
  assert.equal(
    (await (await request("/shops?mine=true", "GET", null, token)).json())
      .length,
    1,
  );
});
test("legacy reports stay unconfirmed, preserve prices, and never expose owner IDs or hostel contact", async () => {
  const result = await (await request(`/shops/${shop._id}`)).json();
  const item = result.items[0];
  assert.equal(item.price, "Synthetic display price");
  assert.equal(item.stock.confirmation, "unconfirmed");
  assert.equal(item.stock.lastUpdatedAt, null);
  assert.equal(item.pricing.stale, true);
  assert.equal(result.contact, "Synthetic contact");
  assert.equal(result.shopOwnerId, undefined);
  const hostel = await models.PointOfInterest.create({
    type: "hostel",
    name: "Synthetic hostel",
    contact: "private contact",
  });
  assert.equal(
    (await (await request(`/poi/${hostel._id}`)).json()).contact,
    undefined,
  );
  const now = new Date();
  assert.equal(
    publicItem(
      {
        stock: {
          status: "in_stock",
          lastUpdatedAt: new Date(now - STOCK_TTL - 1),
        },
        pricing: { lastUpdatedAt: new Date(now - PRICE_TTL - 1) },
      },
      now,
    ).stock.confirmation,
    "unconfirmed",
  );
  assert.equal(
    publicItem(
      {
        stock: {
          status: "in_stock",
          lastUpdatedAt: new Date(now.getTime() + 1000),
        },
      },
      now,
    ).stock.confirmation,
    "unconfirmed",
  );
});
test("assigned owners report price and stock independently; actors are stored but public responses expose role only", async () => {
  const path = `/shops/${shop._id}/items/${shop.items[0]._id}`;
  let res = await request(path, "PUT", { stockStatus: "out_of_stock" }, token);
  assert.equal(res.status, 200);
  let item = (await res.json()).items[0];
  assert.equal(item.stock.reportedStatus, "out_of_stock");
  assert.equal(item.stock.confirmation, "recent_report");
  assert.equal(item.pricing.lastUpdatedAt, null);
  assert.equal(item.stock.updatedBy, "shop_owner");
  const stockAt = item.stock.lastUpdatedAt;
  res = await request(
    path,
    "PUT",
    { price: "Synthetic revised display" },
    token,
  );
  assert.equal(res.status, 200);
  item = (await res.json()).items[0];
  assert.equal(item.stock.lastUpdatedAt, stockAt);
  assert.ok(item.pricing.lastUpdatedAt);
  assert.equal(
    String(
      (await models.PointOfInterest.findById(shop._id)).items[0].pricing
        .updatedBy.id,
    ),
    String(owner._id),
  );
  assert.equal(
    (
      await request(
        `/shops/${shop._id}/items`,
        "POST",
        { name: "Synthetic service", category: "service" },
        token,
      )
    ).status,
    201,
  );
});
test("owners cannot write other shops, structural fields, provenance, assignments, admin queues or faculty self-service", async () => {
  const faculty = await models.Faculty.create({
    _id: owner._id,
    name: "Synthetic same-ID faculty",
  });
  const calls = [
    [`/shops/${other._id}`, "PUT", { contact: "Denied" }, 403],
    [`/shops/${shop._id}`, "PUT", { shopOwnerId: String(owner._id) }, 400],
    [`/shops/${shop._id}`, "PUT", { latitude: 17 }, 400],
    [
      `/shops/${shop._id}/items/${shop.items[0]._id}`,
      "PUT",
      { pricing: { lastUpdatedAt: new Date().toISOString() } },
      400,
    ],
    [`/shops/${shop._id}/owner`, "PUT", { ownerId: null }, 403],
    ["/shop-feedback", "GET", null, 403],
    ["/shop-owners", "GET", null, 403],
    [`/faculty/${faculty._id}`, "PUT", { designation: "Denied" }, 403],
    ["/chat/analytics", "GET", null, 403],
    ["/poi", "POST", { type: "shop", name: "Denied" }, 403],
  ];
  for (const [path, method, body, code] of calls)
    assert.equal((await request(path, method, body, token)).status, code, path);
  const facultyToken = signToken({ role: "faculty", sub: String(faculty._id) });
  assert.equal(
    (
      await request(
        `/shops/${shop._id}`,
        "PUT",
        { contact: "Denied" },
        facultyToken,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(`/shops/${shop._id}`, "PUT", { contact: "Denied" })).status,
    401,
  );
});
test("admin reassignment immediately removes former owner scope; suspension and reapproval revoke old sessions", async () => {
  const next = await models.ShopOwner.create({
    name: "Synthetic next",
    email: "next@example.test",
    passwordHash: "unused-hash",
    status: "approved",
  });
  assert.equal(
    (
      await request(
        `/shops/${shop._id}/owner`,
        "PUT",
        { ownerId: String(next._id) },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/shops/${shop._id}`, "PUT", { contact: "Denied" }, token))
      .status,
    403,
  );
  await request(
    `/shops/${shop._id}/owner`,
    "PUT",
    { ownerId: String(owner._id) },
    admin,
  );
  const res = await request(
    `/shop-owners/${owner._id}`,
    "PUT",
    { status: "suspended" },
    admin,
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).passwordHash, undefined);
  assert.equal((await request("/auth/me", "GET", null, token)).status, 403);
  assert.equal(
    (await request(`/shops/${shop._id}`, "PUT", { contact: "Denied" }, token))
      .status,
    403,
  );
  await request(
    `/shop-owners/${owner._id}`,
    "PUT",
    { status: "approved" },
    admin,
  );
  assert.equal((await request("/auth/me", "GET", null, token)).status, 403);
  const login = await request("/auth/shop-owner/login", "POST", {
    username: owner.email,
    password: "synthetic-test-password",
  });
  assert.equal(login.status, 200);
  token = (await login.json()).token;
  assert.equal(
    (
      await request(
        `/shops/${shop._id}`,
        "PUT",
        { contact: "Synthetic updated contact" },
        token,
      )
    ).status,
    200,
  );
});
test("self-registration cannot approve or assign itself; approval enables separate owner login", async () => {
  const data = {
    name: "Synthetic pending",
    email: "pending@example.test",
    password: "synthetic-new-password",
  };
  assert.equal(
    (
      await request("/shop-owners/register", "POST", {
        ...data,
        status: "approved",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/shop-owners/register", "POST", data)).status,
    202,
  );
  assert.equal(
    (await request("/shop-owners/register", "POST", data)).status,
    202,
  );
  assert.equal(
    (
      await request("/auth/shop-owner/login", "POST", {
        username: data.email,
        password: data.password,
      })
    ).status,
    401,
  );
  const pending = await models.ShopOwner.findOne({ email: data.email });
  assert.equal(pending.status, "pending");
  assert.equal(
    (
      await request(
        `/shops/${shop._id}/owner`,
        "PUT",
        { ownerId: String(pending._id) },
        admin,
      )
    ).status,
    400,
  );
  await request(
    `/shop-owners/${pending._id}`,
    "PUT",
    { status: "approved" },
    admin,
  );
  assert.equal(
    (
      await request("/auth/shop-owner/login", "POST", {
        username: data.email,
        password: data.password,
      })
    ).status,
    200,
  );
  const queue = await (
    await request("/shop-owners", "GET", null, admin)
  ).json();
  assert.ok(
    queue.every((row) => !row.passwordHash && row.tokenVersion === undefined),
  );
});
test("weekly/weekend schedules respect Kolkata midnight and explicit exceptions over holidays", async () => {
  const schedule = {
    timeZone: "Asia/Kolkata",
    weekly: { Sunday: [{ start: "00:00", end: "24:00" }], Monday: [] },
    holidays: [{ date: "2026-10-25", periods: [] }],
    exceptions: [
      { date: "2026-10-25", periods: [{ start: "10:00", end: "11:00" }] },
    ],
  };
  assert.equal(
    openingStatus(
      { openingSchedule: schedule },
      new Date("2026-10-25T04:45:00Z"),
    ).state,
    "scheduled_open",
  );
  assert.equal(
    openingStatus(
      { openingSchedule: schedule },
      new Date("2026-10-25T18:45:00Z"),
    ).weekday,
    "Monday",
  );
  assert.equal(
    openingStatus(
      { openingSchedule: schedule },
      new Date("2026-10-25T18:45:00Z"),
    ).state,
    "scheduled_closed",
  );
  assert.equal(
    openingStatus(
      { openingSchedule: schedule },
      new Date("2026-10-27T04:45:00Z"),
    ).state,
    "unknown",
  );
  assert.equal(
    (
      await request(
        `/shops/${shop._id}`,
        "PUT",
        { openingSchedule: schedule },
        token,
      )
    ).status,
    200,
  );
  const bad = [
    { ...schedule, timeZone: "UTC" },
    { ...schedule, weekly: { Monday: [{ start: "9:00", end: "10:00" }] } },
    { ...schedule, weekly: { Monday: [{ start: "22:00", end: "02:00" }] } },
    {
      ...schedule,
      weekly: {
        Monday: [
          { start: "09:00", end: "11:00" },
          { start: "10:00", end: "12:00" },
        ],
      },
    },
    { ...schedule, exceptions: [{ date: "2026-02-30", periods: [] }] },
    { ...schedule, holidays: [...schedule.holidays, ...schedule.holidays] },
  ];
  for (const value of bad) {
    assert.throws(() => v.parse(v.profile, { openingSchedule: value }));
    assert.equal(
      (
        await request(
          `/shops/${shop._id}`,
          "PUT",
          { openingSchedule: value },
          token,
        )
      ).status,
      400,
    );
  }
});
test("student feedback stays private until admin moderation and never mutates stock automatically", async () => {
  const before = JSON.stringify(
    (await models.PointOfInterest.findById(shop._id)).items,
  );
  assert.equal(
    (
      await request(`/shops/${shop._id}/feedback`, "POST", {
        reason: "stock",
        message: "Synthetic inaccurate stock report",
        itemId: String(other.items[0]._id),
      })
    ).status,
    400,
  );
  const res = await request(`/shops/${shop._id}/feedback`, "POST", {
    reason: "stock",
    message: "Synthetic inaccurate stock report",
    itemId: String(shop.items[0]._id),
  });
  assert.equal(res.status, 202);
  assert.equal((await request("/shop-feedback")).status, 401);
  const reports = await (
    await request("/shop-feedback", "GET", null, admin)
  ).json();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].reporterIdentity, "unverified_guest");
  assert.equal(
    (
      await request(
        `/shop-feedback/${reports[0]._id}`,
        "PUT",
        { status: "resolved", moderationNote: "Synthetic reviewed note" },
        token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/shop-feedback/${reports[0]._id}`,
        "PUT",
        { status: "resolved", moderationNote: "Synthetic reviewed note" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    JSON.stringify((await models.PointOfInterest.findById(shop._id)).items),
    before,
  );
  assert.ok(
    !JSON.stringify([...models.AuditLog.records.values()]).includes(
      "synthetic-test-password",
    ),
  );
  assert.ok(
    !JSON.stringify([...models.AuditLog.records.values()]).includes(
      "Synthetic inaccurate stock report",
    ),
  );
});
test("legacy admin menu editing preserves item identity/provenance and archives omitted entries", async () => {
  const current = await models.PointOfInterest.findById(shop._id);
  const item = current.items[0];
  const id = String(item._id),
    stock = item.stock.lastUpdatedAt.toISOString();
  const res = await request(
    `/poi/${shop._id}`,
    "PUT",
    {
      items: [
        { name: item.name, price: item.price, available: item.available },
      ],
    },
    admin,
  );
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]._id, id);
  assert.equal(result.items[0].stock.lastUpdatedAt, stock);
  assert.equal(
    (await models.PointOfInterest.findById(shop._id)).items.length,
    current.items.length,
  );
});
test("additive migration plans preserve inventory, prices and provenance and are idempotent", () => {
  const legacy = {
    items: [
      {
        _id: "synthetic-id",
        name: "Notebook",
        price: "Synthetic price",
        available: true,
      },
    ],
  };
  const changes = plan(legacy);
  assert.ok(changes["items.0.searchTokens"].includes("notebook"));
  assert.equal(changes["items.0._id"], undefined);
  assert.ok(
    !Object.keys(changes).some((key) =>
      /stock|pricing|price|available|updatedAt/.test(key),
    ),
  );
  const migrated = {
    ...legacy,
    catalogVersion: 1,
    category: "unclassified",
    items: [
      {
        ...legacy.items[0],
        searchTokens: changes["items.0.searchTokens"],
        category: "unclassified",
      },
    ],
  };
  assert.deepEqual(plan(migrated), {});
  assert.ok(
    models.PointOfInterest.schema
      .indexes()
      .some(([spec]) => spec["items.searchTokens"] === 1),
  );
});
test("unmigrated raw shops remain searchable and unclassified filters include missing categories", async () => {
  const id = new (require("mongoose").Types.ObjectId)();
  models.PointOfInterest.records.set(String(id), {
    _id: id,
    type: "shop",
    name: "Synthetic raw legacy",
    items: [
      {
        _id: new (require("mongoose").Types.ObjectId)(),
        name: "Photocopy service",
        available: true,
      },
    ],
  });
  const res = await request(
    "/shops?q=xerox&category=unclassified&itemCategory=unclassified",
  );
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, String(id));
  assert.equal(rows[0].items[0].stock.confirmation, "unconfirmed");
  assert.deepEqual(
    await (
      await request(
        "/shops?q=copy&category=unclassified&itemCategory=unclassified",
      )
    ).json(),
    [],
  );
});
test("archiving and restoring preserve provenance; duplicate names, invalid IDs and privileged views fail safely", async () => {
  const id = String(shop.items[0]._id),
    path = `/shops/${shop._id}/items/${id}`;
  const stockBefore = (
    await models.PointOfInterest.findById(shop._id)
  ).items[0].stock.lastUpdatedAt.toISOString();
  assert.equal(
    (await request(path, "PUT", { active: false }, token)).status,
    200,
  );
  assert.ok(
    !(await (await request(`/shops/${shop._id}`)).json()).items.some(
      (item) => item._id === id,
    ),
  );
  const privateRows = await (
    await request("/shops?mine=true", "GET", null, token)
  ).json();
  assert.ok(
    privateRows[0].items.some(
      (item) => item._id === id && item.active === false,
    ),
  );
  assert.equal(
    (await request(path, "PUT", { active: true }, token)).status,
    200,
  );
  assert.equal(
    (
      await models.PointOfInterest.findById(shop._id)
    ).items[0].stock.lastUpdatedAt.toISOString(),
    stockBefore,
  );
  assert.equal(
    (
      await request(
        `/shops/${shop._id}/items`,
        "POST",
        { name: shop.items[0].name },
        token,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/shops/${shop._id}/items/invalid`,
        "PUT",
        { stockStatus: "in_stock" },
        token,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/shops?manage=true", "GET", null, token)).status,
    403,
  );
  assert.equal(
    (await request(`/faculty/${owner._id}?view=private`, "GET", null, token))
      .status,
    403,
  );
});
test("only an admin can verify a listing and verification never confirms inventory", async () => {
  const verified = {
    shopVerification: {
      status: "verified",
      source: "Synthetic official confirmation for tests only",
      verifiedAt: new Date(Date.now() - 1000).toISOString(),
    },
  };
  assert.equal(
    (await request(`/shops/${shop._id}`, "PUT", verified, token)).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/shops/${shop._id}`,
        "PUT",
        { shopVerification: { status: "verified" } },
        admin,
      )
    ).status,
    400,
  );
  const res = await request(`/shops/${other._id}`, "PUT", verified, admin);
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.dataStatus, "verified_listing");
  assert.equal(result.items[0].stock.confirmation, "unconfirmed");
});
test("registration and feedback rate limits reject abuse and unavailable audit logging blocks owner mutations", async () => {
  const { HttpError } = require("../src/middleware/errors");
  const limited = createApp({
    models,
    limits: { shop: 1 },
    audit: async () => {
      throw new HttpError(503, "Audit unavailable");
    },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => limited.once("listening", resolve));
  const send = (path, data, bearer) =>
    fetch(`http://127.0.0.1:${limited.address().port}/api${path}`, {
      method:
        path.endsWith("/feedback") || path.endsWith("/register")
          ? "POST"
          : "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(data),
    });
  try {
    const before = models.PointOfInterest.writes;
    assert.equal(
      (await send(`/shops/${shop._id}`, { contact: "Must not persist" }, token))
        .status,
      503,
    );
    assert.equal(models.PointOfInterest.writes, before);
    assert.equal(
      (
        await send(`/shops/${shop._id}/feedback`, {
          reason: "stock",
          message: "Synthetic abuse test",
        })
      ).status,
      202,
    );
    assert.equal(
      (
        await send(`/shops/${shop._id}/feedback`, {
          reason: "stock",
          message: "Synthetic abuse test",
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await send("/shop-owners/register", {
          name: "Synthetic",
          email: "rate@example.test",
          password: "synthetic-password-for-limit-test",
        })
      ).status,
      429,
    );
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
});
test("registration fails closed when the unique account email index is not provisioned", async () => {
  class WithoutIndexes extends models.ShopOwner {
    static async listIndexes() {
      return [];
    }
  }
  const instance = createApp({
    models: { ...models, ShopOwner: WithoutIndexes },
    audit: createAuditor(models.AuditLog),
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => instance.once("listening", resolve));
  try {
    const before = models.ShopOwner.writes;
    const res = await fetch(
      `http://127.0.0.1:${instance.address().port}/api/shop-owners/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Synthetic no index",
          email: "no-index@example.test",
          password: "synthetic-test-password",
        }),
      },
    );
    assert.equal(res.status, 503);
    assert.equal(models.ShopOwner.writes, before);
  } finally {
    await new Promise((resolve) => instance.close(resolve));
  }
});
