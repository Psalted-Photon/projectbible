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

/*
 * Devotional reminders ride the same push path, marked `gentle`: a reminder,
 * not an alarm, so it lets itself go and buzzes once instead of three times.
 * Their URLs carry devo=, which is how a tap is told apart from an alarm's.
 */

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
    // An alarm stays on screen until acted on, where the platform honors this.
    requireInteraction: !payload.gentle,
    vibrate: payload.gentle ? [200] : [400, 200, 400, 200, 400],
    timestamp: Date.now(),
    data: {
      url: payload.url || '/?alarm=1',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/*
 * Which open windows are the installed app. On Android the installed app runs
 * on Chrome and shares its storage, so to this worker a hexapla.app tab left
 * open in Chrome looks exactly like the app, and a tap used to bring forward
 * whichever it found first. Each window says what it is when it starts
 * (App.svelte). That is kept in a cache of its own, not in memory: the worker
 * is shut down long before an overnight alarm. Workbox's cleanupOutdatedCaches
 * only deletes its own precaches, so it leaves this one alone.
 */
const WINDOWS_CACHE = 'hexapla-window-kinds';
const APP_WINDOW_PREFIX = '/__window-kind/app/';
const APP_ON_DEVICE_KEY = '/__window-kind/app-on-device';

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'window-kind') return;
  if (!event.source || !event.source.id) return;
  event.waitUntil(recordWindowKind(event.source.id, event.data.app === true));
});

async function recordWindowKind(clientId, isApp) {
  const cache = await caches.open(WINDOWS_CACHE);
  if (isApp) {
    await cache.put(APP_WINDOW_PREFIX + clientId, new Response('1'));
    await cache.put(APP_ON_DEVICE_KEY, new Response('1'));
  }

  // Forget windows that have since closed. Every launch is a new window, so
  // without this the list would only ever grow.
  const open = new Set(
    (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map((client) => client.id)
  );
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(APP_WINDOW_PREFIX)) continue;
    if (!open.has(path.slice(APP_WINDOW_PREFIX.length))) await cache.delete(request);
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || '/?alarm=1';
  // Tell the running app what was tapped: a devotional reminder opens its
  // reading, an alarm shows the start screen.
  const isDevotional = new URL(target, self.location.origin).searchParams.has('devo');
  const message = { type: isDevotional ? 'devotional-opened' : 'wake-alarm-opened', url: target };

  event.waitUntil(
    (async () => {
      // Most recently focused first.
      const clientList = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(
        (client) => new URL(client.url).origin === self.location.origin
      );
      const cache = await caches.open(WINDOWS_CACHE);

      // Prefer an app window that is already open, even one asleep in the
      // background: focusing it keeps the user's place, downloaded packs and
      // warm state instead of a cold boot.
      for (const client of clientList) {
        if (!(await cache.match(APP_WINDOW_PREFIX + client.id))) continue;
        await client.focus();
        client.postMessage(message);
        return;
      }

      // No app window open. On Android, once the app has run here, open the
      // link fresh: Chrome hands it to the installed app, where focusing a tab
      // would land in Chrome. Elsewhere, or where only the website has been
      // used, bring forward an open tab so taps don't pile up new ones.
      const appTakesLinks =
        /Android/i.test(self.navigator.userAgent) && Boolean(await cache.match(APP_ON_DEVICE_KEY));
      if (!appTakesLinks && clientList.length > 0) {
        await clientList[0].focus();
        clientList[0].postMessage(message);
        return;
      }

      await self.clients.openWindow(target);
    })()
  );
});
