/**
 * Aegis WebPush service-worker handler.
 *
 * Injected into the generated Workbox SW via `workbox.importScripts`
 * (see vite.config.ts). Runs inside the SW global scope — no DOM, no
 * `window`. Keep it tiny and dependency-free.
 *
 * Contract (must match `push-sender.server.ts` payload shape):
 *   { title: string, body: string, url: string, nonceId: string }
 */

/* eslint-disable no-restricted-globals */

self.addEventListener("push", (event) => {
  let data = { title: "Aegis", body: "Approval needed", url: "/", nonceId: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_e) {
    // Malformed payload — surface a generic notification rather than
    // silently dropping so the user isn't left waiting forever.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.nonceId || "aegis-approval",
      requireInteraction: true,
      renotify: true,
      data: { url: data.url, nonceId: data.nonceId },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an existing tab if one is already on the app.
      for (const c of all) {
        try {
          const u = new URL(c.url);
          if (u.origin === self.location.origin) {
            await c.focus();
            await c.navigate(target);
            return;
          }
        } catch (_e) {
          /* skip */
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
