import { api } from "../api/client.js";
const DEVICE = "aikya_push_device", PENDING = "aikya_push_optout";
export const pushSupported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function deviceToken() {
  let token = localStorage.getItem(DEVICE);
  if (!token) { token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""); localStorage.setItem(DEVICE, token); }
  return token;
}
export async function finishOptOut() {
  const endpoint = localStorage.getItem(PENDING);
  if (endpoint) { await api.unsubscribePush({ endpoint, deviceToken: deviceToken() }); localStorage.removeItem(PENDING); }
}
export async function enablePush() {
  if (!pushSupported()) throw new Error("Web Push needs a supported browser and HTTPS. In-app updates remain available.");
  // Called only from the explicit user click; never prompt during page load.
  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not permitted. You can change this in browser settings.");
  await finishOptOut();
  const config = await api.pushConfig();
  if (!config.enabled || !config.publicKey) throw new Error("Optional Web Push is not configured. Use the in-app center.");
  const registration = await navigator.serviceWorker.register("/notifications-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const padded = config.publicKey.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - config.publicKey.length % 4) % 4);
  const key = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const value = subscription.toJSON();
  try { await api.subscribePush({ endpoint: value.endpoint, keys: value.keys, consent: true, deviceToken: deviceToken() }); }
  catch (error) { await subscription.unsubscribe(); throw error; }
}
export async function disablePush() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/"), subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    localStorage.setItem(PENDING, subscription.endpoint);
    if (!await subscription.unsubscribe()) throw new Error("Browser subscription could not be removed; retry or disable permission in browser settings.");
  }
  await finishOptOut();
}
