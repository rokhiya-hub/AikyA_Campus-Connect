// Public, generic wake-up only. Restricted content is never put on a lock screen.
self.addEventListener("push", event => {
  let tag = "aikya-update";
  try { const data = event.data?.json(); if (/^aikya-[a-f0-9]{24}$/.test(data?.tag)) tag = data.tag; } catch { /* generic notice */ }
  event.waitUntil(self.registration.showNotification("AIKYA campus update", { body: "Open the notification center to check current announcements.", tag, data: { path: "/notifications" } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL("/notifications", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url === target);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});
