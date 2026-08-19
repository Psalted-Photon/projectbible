/**
 * Web Push subscription — the half of the alarm that lives on the phone.
 *
 * A subscription is a URL at the browser vendor's push service plus two
 * encryption keys. Handing that to our server is what lets it wake this phone
 * later, with the app fully closed. Without a subscription row, an armed alarm
 * in `wake_alarms` has nowhere to be delivered.
 *
 * Everything here needs a real user gesture (permission prompts do) and a
 * registered service worker, so it only works on a built/deployed app — there
 * is no service worker in `vite dev`.
 */

import { supabase } from '../supabase/client';

const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

/** How long to wait for the service worker before giving up rather than hanging. */
const SW_READY_TIMEOUT_MS = 10_000;

export type PushSetupResult =
  | { ok: true; endpoint: string }
  | {
      ok: false;
      reason:
        | 'unsupported'        // browser has no Push API at all
        | 'ios-needs-install'  // iOS Safari tab — must be added to the home screen
        | 'no-key'             // VITE_VAPID_PUBLIC_KEY missing from the build
        | 'no-service-worker'  // dev server, or registration failed
        | 'denied'             // user said no, or said no previously
        | 'dismissed'          // user closed the prompt without choosing
        | 'signed-out'
        | 'error';
      message: string;
    };

/** True when running as an installed app rather than a browser tab. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari's own flag; the manifest uses display:fullscreen, so check that too.
  if ((window.navigator as any).standalone === true) return true;
  return ['standalone', 'fullscreen', 'minimal-ui'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ reports as Macintosh, so also look for a touch-capable "Mac".
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  );
}

/**
 * Whether this browser could ever receive an alarm. Used to explain the
 * situation up front instead of after a failed save.
 */
export function pushSupport():
  | { supported: true }
  | { supported: false; reason: 'unsupported' | 'ios-needs-install'; message: string } {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    if (isIOS() && !isInstalledApp()) {
      return {
        supported: false,
        reason: 'ios-needs-install',
        message: 'On iPhone, add Hexapla to your home screen first — Safari tabs cannot receive alarms.',
      };
    }
    return {
      supported: false,
      reason: 'unsupported',
      message: 'This browser cannot receive push notifications.',
    };
  }

  if (isIOS() && !isInstalledApp()) {
    return {
      supported: false,
      reason: 'ios-needs-install',
      message: 'On iPhone, add Hexapla to your home screen first — Safari tabs cannot receive alarms.',
    };
  }

  return { supported: true };
}

/** Base64url (what VAPID keys are) → the Uint8Array PushManager wants. */
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function serviceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

/**
 * Ask permission if needed, subscribe this device, and record it on the server.
 * Safe to call repeatedly — an existing subscription is reused, and the row is
 * upserted so the same phone never accumulates duplicates.
 *
 * Must be called from a user gesture.
 */
export async function ensurePushSubscription(): Promise<PushSetupResult> {
  const support = pushSupport();
  if (!support.supported) {
    return { ok: false, reason: support.reason, message: support.message };
  }

  if (!VAPID_PUBLIC_KEY) {
    return {
      ok: false,
      reason: 'no-key',
      message: 'This build has no push key (VITE_VAPID_PUBLIC_KEY). Rebuild with it set.',
    };
  }

  // Permission first — subscribing without it throws anyway.
  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch (err: any) {
      return { ok: false, reason: 'error', message: err?.message ?? 'Could not ask for notification permission.' };
    }
  }
  if (permission === 'denied') {
    return {
      ok: false,
      reason: 'denied',
      message: 'Notifications are blocked for this app. Turn them back on in your browser or phone settings, then save again.',
    };
  }
  if (permission !== 'granted') {
    return { ok: false, reason: 'dismissed', message: 'Notification permission was not granted, so the alarm cannot ring.' };
  }

  const registration = await serviceWorkerReady();
  if (!registration) {
    return {
      ok: false,
      reason: 'no-service-worker',
      message: 'The offline engine is not running yet. Reopen the app and try again (it is never available on the dev server).',
    };
  }

  let subscription: PushSubscription;
  try {
    subscription = await subscribeWithKey(registration);
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? 'Could not subscribe this device for notifications.' };
  }

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, reason: 'signed-out', message: 'Sign in to arm the alarm — the reminder is sent from your account.' };
  }

  const json = subscription.toJSON();
  try {
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint: subscription.endpoint,
        user_id: userId,
        p256dh: json.keys?.p256dh ?? arrayBufferToBase64Url(subscription.getKey('p256dh')),
        auth: json.keys?.auth ?? arrayBufferToBase64Url(subscription.getKey('auth')),
        user_agent: navigator.userAgent.slice(0, 300),
        expired_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? 'Could not save this device to your account.' };
  }

  return { ok: true, endpoint: subscription.endpoint };
}

/**
 * Reuse the existing subscription when it was made with the current key.
 * If the key was rotated, the old subscription is unusable and must be dropped
 * before a new one can be created.
 */
async function subscribeWithKey(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  const applicationServerKey = base64UrlToUint8Array(VAPID_PUBLIC_KEY);
  const existing = await registration.pushManager.getSubscription();

  if (existing) {
    const existingKey = arrayBufferToBase64Url(existing.options?.applicationServerKey ?? null);
    if (existingKey === VAPID_PUBLIC_KEY) return existing;
    await existing.unsubscribe();
  }

  return registration.pushManager.subscribe({
    // Required by Chrome: every push must result in a visible notification.
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as unknown as BufferSource,
  });
}

/** Current permission state, for showing the situation before the user saves. */
export function notificationPermission(): NotificationPermission | 'unavailable' {
  if (typeof Notification === 'undefined') return 'unavailable';
  return Notification.permission;
}

/**
 * Show the alarm notification right now, locally, without involving the server.
 *
 * This proves permission, the icon, and the name — not delivery. A real alarm
 * is sent by the server and can wake a closed app; this one only works with the
 * app running. Keep the options in step with public/push-handler.js, which is
 * plain JS in the service worker and cannot import from here.
 */
export async function showTestNotification(): Promise<PushSetupResult> {
  const support = pushSupport();
  if (!support.supported) {
    return { ok: false, reason: support.reason, message: support.message };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch (err: any) {
      return { ok: false, reason: 'error', message: err?.message ?? 'Could not ask for notification permission.' };
    }
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: permission === 'denied' ? 'denied' : 'dismissed',
      message:
        permission === 'denied'
          ? 'Notifications are blocked for this app. Turn them back on in your browser or phone settings.'
          : 'Notification permission was not granted.',
    };
  }

  const registration = await serviceWorkerReady();
  if (!registration) {
    return {
      ok: false,
      reason: 'no-service-worker',
      message: 'The offline engine is not running yet. Reopen the app and try again (never available on the dev server).',
    };
  }

  await registration.showNotification('Hexapla', {
    body: 'Test notification — this is how your wake alarm will look.',
    icon: '/pwa-192x192.png',
    badge: '/notification-badge-96.png',
    tag: 'projectbible-wake-alarm-test',
    requireInteraction: true,
    data: { url: '/?alarm=1&test=1' },
  } as NotificationOptions);

  return { ok: true, endpoint: 'local-test' };
}
