import { enablePush, disablePush, pushSupported } from "../src/lib/pushNotifications.js";
import { api } from "../src/api/client.js";
jest.mock("../src/api/client.js", () => ({ api: { pushConfig: jest.fn(), subscribePush: jest.fn(), unsubscribePush: jest.fn() } }));
let subscription, manager, serviceWorker;
beforeEach(() => {
  localStorage.clear(); jest.clearAllMocks();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "PushManager", { configurable: true, value: function () {} });
  Object.defineProperty(window, "Notification", { configurable: true, value: { requestPermission: jest.fn().mockResolvedValue("granted") } });
  subscription = { endpoint: "https://fcm.googleapis.com/send/synthetic", toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } }), unsubscribe: jest.fn().mockResolvedValue(true) };
  manager = { getSubscription: jest.fn().mockResolvedValue(null), subscribe: jest.fn().mockResolvedValue(subscription) };
  const registration = { pushManager: manager };
  serviceWorker = { register: jest.fn().mockResolvedValue(registration), ready: Promise.resolve(registration), getRegistration: jest.fn().mockResolvedValue(registration) };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  api.pushConfig.mockResolvedValue({ enabled: true, publicKey: "A".repeat(87) }); api.subscribePush.mockResolvedValue({}); api.unsubscribePush.mockResolvedValue({});
});
test("permission denial never registers a subscription or contacts subscribe endpoint", async () => {
  window.Notification.requestPermission.mockResolvedValue("denied");
  await expect(enablePush()).rejects.toThrow(/not permitted/);
  expect(serviceWorker.register).not.toHaveBeenCalled(); expect(api.subscribePush).not.toHaveBeenCalled();
});
test("explicit consent registers only public push and opt-out unsubscribes browser and server", async () => {
  expect(pushSupported()).toBe(true);
  await enablePush();
  expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);
  expect(api.subscribePush.mock.calls[0][0].consent).toBe(true);
  expect(api.subscribePush.mock.calls[0][0].deviceToken).toMatch(/^[a-f0-9]{64}$/);
  manager.getSubscription.mockResolvedValue(subscription);
  await disablePush();
  expect(subscription.unsubscribe).toHaveBeenCalled(); expect(api.unsubscribePush.mock.calls[0][0].endpoint).toBe(subscription.endpoint);
});
test("failed registration rolls back browser subscription and failed opt-out remains retryable", async () => {
  api.subscribePush.mockRejectedValueOnce(new Error("Synthetic network failure"));
  await expect(enablePush()).rejects.toThrow(); expect(subscription.unsubscribe).toHaveBeenCalled();
  manager.getSubscription.mockResolvedValue(subscription); api.unsubscribePush.mockRejectedValueOnce(new Error("offline"));
  await expect(disablePush()).rejects.toThrow("offline"); expect(localStorage.getItem("aikya_push_optout")).toBe(subscription.endpoint);
  manager.getSubscription.mockResolvedValue(null); await disablePush(); expect(localStorage.getItem("aikya_push_optout")).toBeNull();
});
