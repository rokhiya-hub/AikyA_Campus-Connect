const express = require("express");
const bcrypt = require("bcryptjs");
const { signToken, requireAuth } = require("../middleware/auth");
const DefaultFaculty = require("../models/Faculty");
const { asyncRoute, HttpError } = require("../middleware/errors");
const { parse, login, validateQuery } = require("../validation");

function createAuthRouter(Faculty = DefaultFaculty, limiter, ShopOwner, verifyDriver) {
  const router = express.Router();
  // Cache only the configured admin hash; bcrypt comparisons never block the event loop.
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const adminHash = configuredPassword ? bcrypt.hash(configuredPassword, 12) : Promise.resolve(null);
  router.post("/login", limiter, validateQuery(), asyncRoute(async (req, res) => {
    const { username, password } = parse(login, req.body);
    if (!process.env.JWT_SECRET?.trim()) throw new HttpError(503, "Authentication is not configured");
    const adminUser = process.env.ADMIN_USERNAME;
    if (adminUser && username === adminUser && configuredPassword && await bcrypt.compare(password, await adminHash)) {
      return res.json({ token: signToken({ role: "admin", sub: adminUser, username: adminUser }), role: "admin", username: adminUser });
    }
    // Only a validated string reaches the selector. No object operators can enter it.
    const faculty = await Faculty.findOne({ email: username }).select("+passwordHash").maxTimeMS(3000);
    if (faculty?.passwordHash && await bcrypt.compare(password, faculty.passwordHash)) {
      return res.json({ token: signToken({ role: "faculty", sub: String(faculty._id), username: faculty.email }),
        role: "faculty", username: faculty.email, name: faculty.name, facultyId: String(faculty._id), departmentName: faculty.departmentName });
    }
    throw new HttpError(401, "Invalid email/username or password");
  }));
  router.get("/me", requireAuth, validateQuery(), asyncRoute(async (req, res) => {
    if (req.admin.role === "driver") {
      if (!verifyDriver) throw new HttpError(403, "Use the driver tracking interface");
      await verifyDriver(req.admin);
    }
    if (req.admin.role === "shop_owner") await require("./shops").ownerSession(ShopOwner, req.admin);
    const { role, username, sub } = req.admin;
    res.json({ role, username, sub });
  }));
  return router;
}
module.exports = createAuthRouter;
