/*
 * Wake alarm push handling.
 *
 * This file is pulled into the generated service worker via importScripts
 * (see workbox.importScripts in vite.config.ts). Workbox generates the service
 * worker itself and has a documented slot for exactly this, so the offline
 * caching stays untouched — nothing here caches or intercepts anything.
 *
 * Plain JS, no imports, no build step: importScripts runs it as-is inside the
 * worker. It lives in public/ so its URL stays /push-handler.js forever.
 *
 * Deliberately does NOT start audio. A service worker cannot play sound, and
 * the design is that reading only ever begins when the user presses start.
 */

/* eslint-disable no-undef */

const ALARM_TAG = 'projectbible-wake-alarm';

self.addEventListener('push', (event) => {
  // A push with no body still has to show something: Chrome requires every
  // push on a userVisibleOnly subscription to produce a notification, and it
  // shows its own "site updated in the background" message if we don't.
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'Hexapla';
  const options = {
    body: payload.body || 'Time to read.',
    icon: payload.icon || '/pwa-192x192.png',
    badge: '/notification-badge-96.png',
    // Same tag every time, so a missed alarm is replaced rather than stacking
    // up into a pile of notifications overnight.
    tag: payload.tag || ALARM_TAG,
    renotify: true,
    // Keep it on screen until acted on, where the platform honours this.
    requireInteraction: true,
    vibrate: [400, 200, 400, 200, 400],
    timestamp: Date.now(),
    data: {
      url: payload.url || '/?alarm=1',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || '/?alarm=1';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Prefer an app window that is already open — focusing it keeps the
      // user's place, downloaded packs and warm state instead of a cold boot.
      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        // Tell the running app an alarm just fired; it shows the start screen.
        client.postMessage({ type: 'wake-alarm-opened', url: target });
        return;
      }

      await self.clients.openWindow(target);
    })()
  );
});
