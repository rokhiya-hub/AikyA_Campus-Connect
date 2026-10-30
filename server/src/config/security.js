function originsFor(env = process.env) {
  const origins = (env.CLIENT_ORIGIN || (env.NODE_ENV === "production" ? "" : "http://localhost:5173,http://127.0.0.1:5173"))
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error("CLIENT_ORIGIN must contain exact HTTP(S) origins"); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error("CLIENT_ORIGIN must contain exact HTTP(S) origins");
    }
  }
  return origins;
}
function validateProductionConfig(env = process.env) {
  const origins = originsFor(env);
  if (env.NODE_ENV !== "production") return;
  if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET.trim()) < 32) throw new Error("Production requires JWT_SECRET of at least 32 bytes");
  if (!env.ADMIN_USERNAME?.trim() || !env.ADMIN_PASSWORD || Buffer.byteLength(env.ADMIN_PASSWORD) < 12 || Buffer.byteLength(env.ADMIN_PASSWORD) > 72) {
    throw new Error("Production requires ADMIN_USERNAME and ADMIN_PASSWORD (12-72 bytes)");
  }
  if (!origins.length) throw new Error("Production requires CLIENT_ORIGIN");
  if (env.BUS_TRACKING_ENABLED === "true" && origins.some(origin => new URL(origin).protocol !== "https:")) throw new Error("Production bus tracking requires HTTPS browser origins");
  if (!env.MONGODB_URI?.trim()) throw new Error("Production requires MONGODB_URI");
}
module.exports = { originsFor, validateProductionConfig };
