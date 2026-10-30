const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { adminOnly, requireAuth, signToken } = require("../middleware/auth");
const { asyncRoute, HttpError } = require("../middleware/errors");
const { validateQuery, validateId, login } = require("../validation");
const v = require("../validation/shops");
const { serialize } = require("../services/publicData");
const { words, matchesItem } = require("../services/shopData");
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const legacyPattern = (term) =>
  term === "xerox"
    ? "(?:xerox|photocop)"
    : term === "color"
      ? "colou?r"
      : escape(term);
async function ownerSession(Model, principal) {
  const owner = await Model.findById(principal.sub).maxTimeMS(3000);
  if (
    !owner ||
    owner.status !== "approved" ||
    owner.tokenVersion !== principal.tokenVersion
  )
    throw new HttpError(403, "Shop-owner account is not active; sign in again");
  return owner;
}
function stampItem(item, changes, principal) {
  const now = new Date();
  const actor = { id: principal.sub, role: principal.role };
  const { stockStatus, ...fields } = changes;
  item.set(fields);
  if (Object.hasOwn(changes, "price"))
    item.pricing = { lastUpdatedAt: now, updatedBy: actor };
  if (stockStatus !== undefined) {
    item.stock = { status: stockStatus, lastUpdatedAt: now, updatedBy: actor };
    item.available = stockStatus === "in_stock";
  }
  item.lastUpdatedAt = now;
  item.updatedBy = actor;
}
function page(res, rows, pageNumber, limit) {
  const more = rows.length > limit;
  res.set({
    "X-Page": String(pageNumber),
    "X-Has-More": String(more),
    "X-Next-Page": more ? String(pageNumber + 1) : "",
  });
  return rows.slice(0, limit);
}
function createShopRouters(models, audit, limiter) {
  const {
    PointOfInterest: POI,
    ShopOwner: Owner,
    ShopFeedback: Feedback,
  } = models;
  const shops = express.Router(),
    owners = express.Router(),
    feedback = express.Router(),
    auth = express.Router();
  const getShop = async (id) => {
    const shop = await POI.findOne({ _id: id, type: "shop" }).maxTimeMS(3000);
    if (!shop) throw new HttpError(404, "Shop not found");
    return shop;
  };
  const scoped = asyncRoute(async (req, res, next) => {
    if (req.admin.role !== "admin") {
      if (req.admin.role !== "shop_owner")
        throw new HttpError(403, "Shop-owner or admin access required");
      await ownerSession(Owner, req.admin);
    }
    req.shop = await getShop(req.params.id);
    if (
      req.admin.role !== "admin" &&
      String(req.shop.shopOwnerId) !== req.admin.sub
    )
      throw new HttpError(403, "This shop is not assigned to your account");
    next();
  });
  auth.post(
    "/shop-owner/login",
    validateQuery(),
    asyncRoute(async (req, res) => {
      const body = v.parse(login, req.body);
      const owner = await Owner.findOne({ email: body.username.toLowerCase() })
        .select("+passwordHash")
        .maxTimeMS(3000);
      if (
        !owner ||
        owner.status !== "approved" ||
        !(await bcrypt.compare(body.password, owner.passwordHash))
      )
        throw new HttpError(
          401,
          "Invalid credentials or account is not approved",
        );
      res.json({
        role: "shop_owner",
        sub: String(owner._id),
        name: owner.name,
        username: owner.email,
        token: signToken({
          role: "shop_owner",
          sub: String(owner._id),
          tokenVersion: owner.tokenVersion,
          username: owner.email,
        }),
      });
    }),
  );
  owners.post(
    "/register",
    validateQuery(),
    asyncRoute(async (req, res) => {
      const body = v.parse(v.owner, req.body);
      const passwordHash = await bcrypt.hash(body.password, 12);
      // Unique index must exist before accepting concurrent registrations.
      await Owner.init();
      const indexes = await Owner.listIndexes();
      if (
        !indexes.some(
          (index) =>
            index.unique &&
            index.key?.email === 1 &&
            Object.keys(index.key).length === 1 &&
            !index.partialFilterExpression,
        )
      ) {
        throw new HttpError(
          503,
          "Owner registration requires the unique email index; contact an administrator",
        );
      }
      const existing = await Owner.findOne({ email: body.email }).maxTimeMS(
        3000,
      );
      if (!existing) {
        try {
          await Owner.create({
            name: body.name,
            email: body.email,
            passwordHash,
            status: "pending",
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
      res.status(202).json({
        message:
          "Account request received. An admin must approve and assign a shop before sign-in.",
      });
    }),
  );
  owners.get(
    "/",
    adminOnly,
    validateQuery(v.query),
    asyncRoute(async (req, res) => {
      const { page: p, limit } = req.validQuery;
      const rows = await Owner.find({})
        .sort({ _id: 1 })
        .skip((p - 1) * limit)
        .limit(limit + 1)
        .maxTimeMS(3000);
      res.json(
        page(res, rows, p, limit).map((o) => ({
          _id: o._id,
          name: o.name,
          email: o.email,
          status: o.status,
        })),
      );
    }),
  );
  owners.put(
    "/:id",
    adminOnly,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const changes = v.parse(v.ownerUpdate, req.body);
      const owner = await Owner.findById(req.params.id).maxTimeMS(3000);
      if (!owner) throw new HttpError(404, "Owner not found");
      if (changes.password) {
        owner.passwordHash = await bcrypt.hash(changes.password, 12);
        delete changes.password;
        owner.tokenVersion += 1;
      }
      if (changes.status && changes.status !== owner.status)
        owner.tokenVersion += 1;
      owner.set(changes);
      await audit(req, "ShopOwner", "update", Object.keys(changes), () =>
        owner.save(),
      );
      res.json({
        _id: owner._id,
        name: owner.name,
        email: owner.email,
        status: owner.status,
      });
    }),
  );
  shops.get(
    "/",
    validateQuery(v.query),
    asyncRoute(async (req, res, next) => {
      if (req.validQuery.mine || req.validQuery.manage)
        return requireAuth(req, res, next);
      next();
    }),
    asyncRoute(async (req, res) => {
      const {
        page: p,
        limit,
        q,
        category,
        itemCategory,
        area,
        mine,
        manage,
      } = req.validQuery;
      if (manage && req.admin.role !== "admin")
        throw new HttpError(403, "Admin access required");
      const filter = {
        type: "shop",
        ...(category && category !== "unclassified" ? { category } : {}),
        ...(area ? { area } : {}),
      };
      if (category === "unclassified")
        filter.$and = [
          { $or: [{ category }, { category: { $exists: false } }] },
        ];
      if (mine) {
        if (req.admin.role !== "shop_owner")
          throw new HttpError(403, "Owner access required");
        await ownerSession(Owner, req.admin);
        filter.shopOwnerId = req.admin.sub;
      }
      if (q || itemCategory) {
        const terms = words(q);
        const categoryTerms = itemCategory
          ? [
              itemCategory === "unclassified"
                ? {
                    $or: [
                      { category: itemCategory },
                      { category: { $exists: false } },
                    ],
                  }
                : { category: itemCategory },
            ]
          : [];
        const itemFilter = (predicates) => ({
          active: { $ne: false },
          ...(predicates.length ? { $and: predicates } : {}),
        });
        // Indexed prefixes for upgraded shops; bounded legacy fallback only for unmigrated shops.
        filter.$or = [
          {
            catalogVersion: 1,
            items: {
              $elemMatch: itemFilter([
                ...categoryTerms,
                ...terms.map((term) => ({
                  searchTokens: { $regex: `^${escape(term)}` },
                })),
              ]),
            },
          },
          {
            catalogVersion: { $ne: 1 },
            items: {
              $elemMatch: itemFilter([
                ...categoryTerms,
                ...terms.map((term) => ({
                  $or: ["name", "category", "keywords"].map((field) => ({
                    [field]: {
                      $regex: `(?:^|[^\\p{L}\\p{N}])${legacyPattern(term)}`,
                      $options: "i",
                    },
                  })),
                })),
              ]),
            },
          },
        ];
      }
      const rows = await POI.find(filter)
        .sort({ _id: 1 })
        .skip((p - 1) * limit)
        .limit(limit + 1)
        .maxTimeMS(3000);
      res.json(
        page(res, rows, p, limit).map((shop) => {
          const result = serialize("PointOfInterest", shop);
          if (mine || manage)
            result.items = shop.items.map((item) =>
              require("../services/shopData").publicItem(item),
            );
          if (q || itemCategory)
            result.items = result.items.filter((item) =>
              matchesItem(item, q, itemCategory),
            );
          return result;
        }),
      );
    }),
  );
  shops.get(
    "/:id",
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) =>
      res.json(serialize("PointOfInterest", await getShop(req.params.id))),
    ),
  );
  shops.get(
    "/:id/owner",
    adminOnly,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const shop = await getShop(req.params.id);
      res.json({ shopOwnerId: shop.shopOwnerId || null });
    }),
  );
  shops.put(
    "/:id/owner",
    adminOnly,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const { ownerId } = v.parse(
        z.strictObject({ ownerId: v.id.nullable() }),
        req.body,
      );
      const shop = await getShop(req.params.id);
      if (ownerId) {
        const owner = await Owner.findById(ownerId).maxTimeMS(3000);
        if (!owner || owner.status !== "approved")
          throw new HttpError(400, "Select an approved owner");
      }
      shop.shopOwnerId = ownerId;
      await audit(req, "PointOfInterest", "update", ["shopOwnerId"], () =>
        shop.save(),
      );
      res.json({ _id: shop._id, shopOwnerId: shop.shopOwnerId });
    }),
  );
  shops.put(
    "/:id",
    requireAuth,
    validateId,
    validateQuery(),
    scoped,
    asyncRoute(async (req, res) => {
      const changes = v.parse(
        req.admin.role === "admin" ? v.adminProfile : v.profile,
        req.body,
      );
      req.shop.set(changes);
      await audit(req, "PointOfInterest", "update", Object.keys(changes), () =>
        req.shop.save(),
      );
      res.json(serialize("PointOfInterest", req.shop));
    }),
  );
  shops.post(
    "/:id/items",
    requireAuth,
    validateId,
    validateQuery(),
    scoped,
    asyncRoute(async (req, res) => {
      const changes = v.parse(v.item, req.body);
      if (req.shop.items.some((item) => item.name === changes.name))
        throw new HttpError(
          409,
          "An item with this name exists; edit or restore that entry",
        );
      if (req.shop.items.length >= 200)
        throw new HttpError(400, "Menu limit reached; edit existing entries");
      req.shop.items.push({ name: changes.name });
      stampItem(req.shop.items[req.shop.items.length - 1], changes, req.admin);
      await audit(req, "PointOfInterest", "update", ["items"], () =>
        req.shop.save(),
      );
      res.status(201).json(serialize("PointOfInterest", req.shop));
    }),
  );
  shops.put(
    "/:id/items/:itemId",
    requireAuth,
    validateId,
    validateQuery(),
    scoped,
    asyncRoute(async (req, res) => {
      const itemId = v.parse(v.id, req.params.itemId);
      const changes = v.parse(
        v.item.partial().refine((o) => Object.keys(o).length),
        req.body,
      );
      const item = req.shop.items.id(itemId);
      if (!item) throw new HttpError(404, "Item not found");
      if (
        changes.name &&
        req.shop.items.some(
          (entry) =>
            String(entry._id) !== itemId && entry.name === changes.name,
        )
      )
        throw new HttpError(409, "An item with this name already exists");
      stampItem(item, changes, req.admin);
      await audit(
        req,
        "PointOfInterest",
        "update",
        ["items", ...Object.keys(changes)],
        () => req.shop.save(),
      );
      res.json(serialize("PointOfInterest", req.shop));
    }),
  );
  shops.post(
    "/:id/feedback",
    limiter,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const body = v.parse(v.feedback, req.body);
      const shop = await getShop(req.params.id);
      if (body.itemId && !shop.items.id(body.itemId))
        throw new HttpError(400, "Item does not belong to this shop");
      await Feedback.create({
        ...body,
        shopId: shop._id,
        reporterIdentity: "unverified_guest",
        status: "pending",
      });
      res.status(202).json({
        message:
          "Report received for admin review. Listings do not change automatically.",
      });
    }),
  );
  feedback.get(
    "/",
    adminOnly,
    validateQuery(
      z.strictObject({
        page: v.query.shape.page,
        limit: v.query.shape.limit,
        status: z
          .enum(["pending", "resolved", "dismissed"])
          .optional()
          .default("pending"),
      }),
    ),
    asyncRoute(async (req, res) => {
      const { page: p, limit, status } = req.validQuery;
      const rows = await Feedback.find({ status })
        .sort({ createdAt: -1, _id: -1 })
        .skip((p - 1) * limit)
        .limit(limit + 1)
        .maxTimeMS(3000);
      res.json(page(res, rows, p, limit));
    }),
  );
  feedback.put(
    "/:id",
    adminOnly,
    validateId,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const changes = v.parse(v.moderation, req.body);
      const report = await Feedback.findById(req.params.id).maxTimeMS(3000);
      if (!report) throw new HttpError(404, "Report not found");
      report.set({
        ...changes,
        moderatedAt: new Date(),
        moderatedBy: req.admin.sub,
      });
      await audit(req, "ShopFeedback", "update", Object.keys(changes), () =>
        report.save(),
      );
      res.json({ _id: report._id, status: report.status });
    }),
  );
  return { shops, owners, feedback, auth };
}
module.exports = { createShopRouters, ownerSession, stampItem };
