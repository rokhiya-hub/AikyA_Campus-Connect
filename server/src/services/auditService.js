const AuditLog = require("../models/AuditLog");
const { HttpError } = require("../middleware/errors");
function createAuditor(Model = AuditLog) {
  return async (req, resource, action, fields, operation) => {
    let entry;
    try {
      entry = await Model.create({ actorId: req.admin.sub, actorRole: req.admin.role, action, resource,
        targetId: req.params.id, fields: fields.filter((field) => !/password|token|secret/i.test(field)),
        requestId: req.requestId, status: "attempted" });
    } catch { throw new HttpError(503, "Audit logging unavailable; no change was made"); }
    async function finish(status, targetId) {
      try { await Model.updateOne({ _id: entry._id }, { $set: { status, ...(targetId ? { targetId: String(targetId) } : {}) } }); }
      catch { console.error(JSON.stringify({ event: "audit_completion_failed", auditId: String(entry._id), requestId: req.requestId, status })); }
    }
    try {
      const result = await operation();
      await finish("succeeded", result?._id);
      return result;
    } catch (err) { await finish("failed"); throw err; }
  };
}
module.exports = { createAuditor };
