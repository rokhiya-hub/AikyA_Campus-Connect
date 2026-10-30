const jwt = require("jsonwebtoken");
const { HttpError } = require("./errors");

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) throw new Error("JWT_SECRET is not configured");
  return secret;
}

// Issues a signed JWT for the admin user.
function signToken(payload, { expiresIn } = {}) {
  return jwt.sign(payload, jwtSecret(), {
    algorithm: "HS256",
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || "7d",
  });
}

// Express middleware that guards write routes. Verifies the Bearer token from
// the Authorization header and puts the decoded payload on req.admin.
function requireAuth(req, res, next) {
  if (!process.env.JWT_SECRET?.trim()) {
    return next(new HttpError(503, "Authentication is not configured"));
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return next(new HttpError(401, "Authentication required"));
  }

  let principal;
  try {
    principal = jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] });
  } catch {
    return next(new HttpError(401, "Invalid or expired session"));
  }
  if (!["admin", "faculty", "shop_owner", "driver"].includes(principal.role) || typeof principal.sub !== "string" || !principal.sub ||
    (principal.role !== "admin" && !/^[a-fA-F0-9]{24}$/.test(principal.sub))) {
    return next(new HttpError(401, "Invalid or expired session"));
  }
  if (principal.role !== "admin") principal.sub = principal.sub.toLowerCase();
  req.admin = principal;
  next();
}

// Admin-only guard: only tokens issued to the campus admin may write to the
// shared collections. Faculty self-service updates are handled separately.
function adminOnly(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.admin || req.admin.role !== "admin") {
      return next(new HttpError(403, "Admin access required"));
    }
    next();
  });
}

function optionalAuth(req, res, next) {
  if (!req.headers.authorization) return next();
  return requireAuth(req, res, next);
}

module.exports = { signToken, requireAuth, optionalAuth, adminOnly, jwtSecret };
