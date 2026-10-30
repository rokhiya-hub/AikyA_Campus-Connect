import { useEffect, useCallback, useSyncExternalStore } from "react";
import { api } from "../api/client.js";

const cache = new Map(), inflight = new Map(), listeners = new Set(), pendingRefresh = new Set();
let version = 0;
const TTL = 60000;
const GETTERS = { faculty: () => api.getFaculty(), departments: () => api.getDepartments(), pois: () => api.getPOIs(), buses: () => api.getBuses(), events: () => api.getEvents() };
const publish = () => { version++; for (const listener of listeners) listener(); };
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => version;
function loadCollection(key, force = false) {
  if (!GETTERS[key]) return Promise.resolve();
  if (inflight.has(key)) { if (force) pendingRefresh.add(key); return inflight.get(key); }
  const previous = cache.get(key);
  if (!force && previous?.loadedAt && Date.now() - previous.loadedAt < TTL) return Promise.resolve(previous.data);
  cache.set(key, { ...previous, status: "loading", error: null });
  const promise = Promise.resolve().then(GETTERS[key]).then((data) => {
    if (!Array.isArray(data)) throw new Error("Invalid collection response");
    cache.set(key, { data, status: "ready", error: null, loadedAt: Date.now() });
    return data;
  }).catch((error) => {
    cache.set(key, { ...previous, status: "error", error: error.message || "Campus service unavailable" });
    return previous?.data;
  }).finally(() => {
    inflight.delete(key);
    publish();
    if (pendingRefresh.delete(key)) return loadCollection(key, true);
  });
  inflight.set(key, promise);
  publish();
  return promise;
}
export function resetUniverseCache() { cache.clear(); publish(); }
if (typeof window !== "undefined") window.addEventListener("aikya:collections-changed", (event) => {
  const key = event.detail;
  if (GETTERS[key]) { cache.set(key, { ...cache.get(key), loadedAt: 0 }); loadCollection(key, true); }
});
export function useUniverse(keys = Object.keys(GETTERS)) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const signature = keys.join(",");
  useEffect(() => {
    const selected = signature.split(",").filter(Boolean);
    selected.forEach((key) => loadCollection(key));
    const update = () => { if (document.visibilityState !== "hidden") selected.forEach((key) => loadCollection(key)); };
    const timer = setInterval(update, TTL);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [signature]);
  const refresh = useCallback((key) => Promise.all((key ? [key] : signature.split(",").filter(Boolean)).map((entry) => loadCollection(entry, true))), [signature]);
  const data = {}, errors = {}, statuses = {}, loadedAt = {};
  for (const key of keys) {
    const entry = cache.get(key);
    if (entry?.data) data[key] = entry.data;
    if (entry?.error) errors[key] = entry.error;
    statuses[key] = entry?.status || "loading";
    loadedAt[key] = entry?.loadedAt || null;
  }
  const groupedErrors = new Map();
  for (const [key, message] of Object.entries(errors)) groupedErrors.set(message, [...(groupedErrors.get(message) || []), key]);
  const error = [...groupedErrors].map(([message, collections]) => `${collections.join(", ")}: ${message}`).join("; ");
  return { data, loading: keys.some((key) => statuses[key] === "loading"), error, errors, statuses, loadedAt, refresh };
}

// Existing prototype reference points and bounds are UNVERIFIED, not surveyed campus coordinates.
export const CAMPUS_CENTER = { latitude: 17.0894, longitude: 82.0668, coordinateVerification: { status: "unverified" } };
export const CAMPUS_GATE = { ...CAMPUS_CENTER, name: "Main Gate reference (unverified)" };
export function getCampusConfig() { return { canvasWidth: 1200, canvasHeight: 760, bounds: { minLat: 17.0875, maxLat: 17.0912, minLng: 82.065, maxLng: 82.069 } }; }
export function projectPOI(poi, cfg) {
  const { minLat, maxLat, minLng, maxLng } = cfg.bounds;
  const x = (((poi.longitude ?? poi.lng ?? 0) - minLng) / (maxLng - minLng)) * cfg.canvasWidth;
  const y = ((maxLat - (poi.latitude ?? poi.lat ?? 0)) / (maxLat - minLat)) * cfg.canvasHeight;
  return { x: Math.min(Math.max(x, 20), cfg.canvasWidth - 40), y: Math.min(Math.max(y, 20), cfg.canvasHeight - 40) };
}
export function unproject(x, y, cfg) {
  const { minLat, maxLat, minLng, maxLng } = cfg.bounds;
  return { latitude: maxLat - (y / cfg.canvasHeight) * (maxLat - minLat), longitude: minLng + (x / cfg.canvasWidth) * (maxLng - minLng) };
}
export function distanceMeters(a, b) {
  const valid = (p) => typeof p?.latitude === "number" && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && typeof p?.longitude === "number" && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
  if (!valid(a) || !valid(b)) return null;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const h = Math.sin(toRad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(toRad(b.longitude - a.longitude) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))));
}
