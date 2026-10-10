/**
 * The move from hexapla.app to irisbible.com.
 *
 * Both addresses serve the same app for about eleven months. Everything saved
 * on a device lives on the address it was made on, so the old address shows a
 * moving screen (components/MovingScreen.svelte) that gets people's work up to
 * their account and then sends them over. Until hexapla.app lapses, the old
 * address keeps working in full: nothing here signs anyone out, clears
 * anything, or blocks the app for good.
 */

/** The address being left. */
export const OLD_HOST = 'hexapla.app';
/** The address everyone is moving to. */
export const NEW_ORIGIN = 'https://irisbible.com';

/** Whether the app is running on the old address (or a subdomain of it). */
export function onOldAddress(host: string = window.location.hostname): boolean {
  const h = host.toLowerCase();
  return h === OLD_HOST || h.endsWith('.' + OLD_HOST);
}

/** The page being viewed, at the new address: path, query and hash all kept. */
export function newAddressFor(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location): string {
  return NEW_ORIGIN + loc.pathname + loc.search + loc.hash;
}
