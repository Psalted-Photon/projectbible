import { writable } from 'svelte/store';

/**
 * A join code waiting to be dealt with.
 *
 * The app has no router, so a join link is a query parameter read once at
 * launch and then stripped from the address bar — the same shape `?ref=` takes
 * in openSharedLink(). What the parameter cannot do is act on itself: it
 * arrives before anything is on screen, before the session is known, and
 * possibly on a device with no account at all. So it is parked here, and
 * SharedJoinLayer picks it up once there is an app to show it in.
 *
 * The same store is what the Shared tab opens when somebody types a code by
 * hand, so both routes in end up at the same sheet.
 */
export const pendingJoinCode = writable<string | null>(null);

/** Hand a code to the layer. Called from App.svelte and from the Notes pane. */
export function requestJoin(code: string) {
  pendingJoinCode.set(code);
}

/** The code has been dealt with — joined, refused, or dismissed. */
export function clearJoin() {
  pendingJoinCode.set(null);
}
