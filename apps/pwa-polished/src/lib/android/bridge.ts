/**
 * Calling the Android app's own Java code (native/android/.../com/irisbible/app).
 *
 * Inside the app, Capacitor puts a `Capacitor` object on the page before any
 * of our code runs, and `nativePromise` sends one call to a plugin by name.
 * That is all the app needs, so @capacitor/core is not part of the web code.
 *
 * Everything in this folder is for the app only. Shared code reaches it behind
 * an `if (IS_ANDROID_APP)` check, so none of it ships on the website.
 */

interface CapacitorBridge {
  nativePromise<T>(plugin: string, method: string, options?: Record<string, unknown>): Promise<T>;
  isPluginAvailable(name: string): boolean;
  addListener?(plugin: string, event: string, callback: (data: unknown) => void): unknown;
}

function bridge(): CapacitorBridge | null {
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  return cap && typeof cap.nativePromise === 'function' ? cap : null;
}

/** One call to an app plugin. Rejects with the plugin's own message when it fails. */
export function callNative<T>(plugin: string, method: string, options: Record<string, unknown> = {}): Promise<T> {
  const cap = bridge();
  if (!cap) return Promise.reject(new Error('This only works in the irisBible app.'));
  return cap.nativePromise<T>(plugin, method, options);
}

/** Hears an event an app plugin sends to the page (notifyListeners in its Java). */
export function onNative<T>(plugin: string, event: string, handler: (data: T) => void): void {
  const cap = bridge();
  if (!cap?.addListener) return;
  cap.addListener(plugin, event, (data) => {
    if (data) handler(data as T);
  });
}
