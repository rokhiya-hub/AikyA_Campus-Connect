const { randomUUID } = require("node:crypto");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
function requestId(req, res, next) {
  req.requestId = randomUUID();
  res.set("X-Request-Id", req.requestId);
  next();
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = 500;
  let message = "The service could not complete this request";
  if (err instanceof HttpError) { status = err.status; message = err.message; }
  else if (err.name === "ZodError") { status = 400; message = "Invalid request data"; }
  else if (err.type === "entity.too.large") { status = 413; message = "Request body is too large"; }
  else if (err.type === "entity.parse.failed") { status = 400; message = "Invalid JSON body"; }
  else if (["ValidationError", "CastError", "StrictModeError"].includes(err.name)) { status = 400; message = "Invalid record data"; }
  else if (err.code === 11000) { status = 409; message = "Record conflicts with an existing record"; }
  else if (err.name === "VersionError") { status = 409; message = "This record changed; reload it before saving again"; }
  else if (/Mongo|Mongoose/.test(err.name || "")) { status = 503; message = "Database temporarily unavailable"; }
  // Never log error objects/messages: provider/driver errors can contain secrets.
  if (status >= 500) console.error(JSON.stringify({ event: "request_failed", requestId: req.requestId, status }));
  res.status(status).json({ error: message, requestId: req.requestId });
}
module.exports = { HttpError, asyncRoute, requestId, errorHandler };
