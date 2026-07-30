import { writable } from 'svelte/store';

/**
 * Whether the wake alarm start screen is showing.
 *
 * Opened when the app is launched from an alarm notification — either by the
 * `?alarm=1` URL the service worker opens, or by a message from the service
 * worker when the app was already running and just got focused.
 */
export const wakeAlarmStartOpen = writable<boolean>(false);
