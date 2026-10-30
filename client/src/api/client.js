const BASE_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/+$/, "");

const TOKEN_KEY = "aikya_token";

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function request(path, options = {}, withHeaders = false) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch (error) {
    if (error.name === "AbortError" || options.signal?.aborted) throw error;
    throw new Error("Cannot reach the campus API. Check that the backend is running and its database connection is configured.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (["POST", "PUT", "DELETE"].includes(options.method) && typeof window !== "undefined") {
    const key = ({ poi: "pois", shops: "pois", faculty: "faculty", departments: "departments", buses: "buses", events: "events" })[path.split("/")[1]];
    if (key && !path.endsWith("/feedback")) window.dispatchEvent(new CustomEvent("aikya:collections-changed", { detail: key }));
  }
  return withHeaders ? { data, headers: res.headers } : data;
}

async function collection(path, privateView = false) {
  const records = [];
  // Keep the existing array API for every page while following bounded pages.
  for (let page = 1; page <= 100; page += 1) {
    const { data, headers } = await request(`${path}?page=${page}&limit=200${privateView ? "&view=private" : ""}`, {}, true);
    if (!Array.isArray(data)) throw new Error("Invalid collection response");
    records.push(...data);
    if (headers.get("X-Has-More") !== "true") return records;
  }
  throw new Error("Collection exceeds the browsing limit; use a bounded search");
}

async function paged(path, signal) {
  const { data, headers } = await request(path, { signal }, true);
  if (!Array.isArray(data)) throw new Error("Invalid collection response");
  return { data, hasMore: headers.get("X-Has-More") === "true" };
}

export const api = {
  notifications: (page = 1, signal) => request(`/notifications?page=${page}&limit=20`, { signal }),
  readNotification: (id, read) => request(`/notifications/${id}/read`, { method: "PUT", body: JSON.stringify({ read }) }),
  adminNotifications: (page = 1) => request(`/notifications/admin?page=${page}&limit=20`),
  saveNotification: (id, body) => request(`/notifications/admin${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
  cancelNotification: id => request(`/notifications/admin/${id}/cancel`, { method: "POST", body: "{}" }),
  notificationDeliveries: id => request(`/notifications/admin/${id}/deliveries`),
  pushConfig: () => request("/notifications/push/config"),
  subscribePush: body => request("/notifications/push/subscribe", { method: "POST", body: JSON.stringify(body) }),
  unsubscribePush: body => request("/notifications/push/unsubscribe", { method: "POST", body: JSON.stringify(body) }),
  trackingStatus: signal => request("/bus-tracking/status", { signal }),
  liveBuses: (params = {}, signal) => request(`/bus-tracking/live?${new URLSearchParams(params)}`, { signal }),
  trackingDevices: (page = 1) => request(`/bus-tracking/devices?page=${page}&limit=20`),
  trackingTrips: (page = 1) => request(`/bus-tracking/trips?page=${page}&limit=20`),
  authorizeBusDevice: body => request("/bus-tracking/devices", { method: "POST", body: JSON.stringify(body) }),
  revokeBusDevice: id => request(`/bus-tracking/devices/${id}`, { method: "PUT", body: JSON.stringify({ enabled: false }) }),
  driverSession: body => request("/bus-tracking/devices/session", { method: "POST", body: JSON.stringify(body) }),
  refreshDriverSession: token => request("/bus-tracking/devices/session/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" }),
  driverCurrentTrip: token => request("/bus-tracking/trips/current", { headers: { Authorization: `Bearer ${token}` } }),
  startBusTrip: token => request("/bus-tracking/trips", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ consent: true }) }),
  endBusTrip: (id, token, keepalive = false) => request(`/bus-tracking/trips/${id}/end`, { method: "POST", keepalive, headers: { Authorization: `Bearer ${token}` }, body: "{}" }),
  sendBusLocation: (id, fix, token, signal) => request(`/bus-tracking/trips/${id}/locations`, { method: "POST", signal, headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(fix) }),
  shopOwnerAssignment: id => request(`/shops/${id}/owner`),
  shopPage: (params = {}, signal) => paged(`/shops?${new URLSearchParams(params)}`, signal),
  shopOwners: (page = 1) => paged(`/shop-owners?page=${page}&limit=30`),
  shopReports: (page = 1) => paged(`/shop-feedback?page=${page}&limit=30`),
  registerShopOwner: data => request("/shop-owners/register", { method: "POST", body: JSON.stringify(data) }),
  getDepartments: (privateView = false) => collection("/departments", privateView),
  getFaculty: (privateView = false) => collection("/faculty", privateView),
  getPOIs: (privateView = false) => collection("/poi", privateView),
  getBuses: (privateView = false) => collection("/buses", privateView),
  getEvents: (privateView = false) => collection("/events", privateView),
  getFacultyProfile: (id) => request(`/faculty/${id}?view=private`),
  sendChatMessage: (message, allowExternalAI = false, signal) =>
    request("/chat", { method: "POST", signal, body: JSON.stringify({ message, allowExternalAI }) }),
  getAnalytics: () => request("/chat/analytics"),

  // Auth
  login: (username, password, accountType) =>
    request(accountType === "shop_owner" ? "/auth/shop-owner/login" : "/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => request("/auth/me"),

  // Faculty self-service (timetable + free time)
  getFacultyTimetable: (id) => request(`/faculty/${id}/timetable`),
  updateFacultyTimetable: (id, timetable, onLeave) =>
    request(`/faculty/${id}/timetable`, { method: "PUT", body: JSON.stringify({ timetable, onLeave }) }),

  // Admin mutations (writes require admin token)
  create: (resource, data) =>
    request(`/${resource}`, { method: "POST", body: JSON.stringify(data) }),
  update: (resource, id, data) =>
    request(`/${resource}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (resource, id) => request(`/${resource}/${id}`, { method: "DELETE" }),
};
