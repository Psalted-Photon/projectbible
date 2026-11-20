/**
 * Which build this is: the web app at irisbible.com, or the Android app.
 *
 * Both are built from this same code. `npm run build:android` builds with
 * Vite's mode set to "android" (see vite.config.ts), and Vite writes the
 * answer below into the code as a plain true or false. The branch that cannot
 * run in a build is then dropped from it, so web-only pieces (the service
 * worker, Chrome's install offer, the hexapla.app moving screen) never ship
 * inside the app, and app-only pieces never reach the website.
 *
 * Anything that should behave differently in the app checks IS_ANDROID_APP.
 * The web build must come out exactly as it was without this file.
 */
export const IS_ANDROID_APP: boolean = import.meta.env.MODE === 'android';

/** The live site, where links made inside the app point. */
export const SITE_ORIGIN = 'https://irisbible.com';

/**
 * The start of a link someone else will open: a shared verse, a notebook's
 * join link, a devotional, a sign-in email.
 *
 * On the web that is the page's own address, path included, since the same
 * build is served from more than one host. Inside the app the page runs at
 * https://localhost, which on anyone else's phone is that phone itself, so app
 * links go to irisbible.com, where anyone can open them.
 */
export function linkOrigin(): string {
  return IS_ANDROID_APP ? SITE_ORIGIN : window.location.origin;
}

/** linkOrigin with the page's path: what a shared link's query is added to. */
export function linkBase(): URL {
  return IS_ANDROID_APP ? new URL('/', SITE_ORIGIN) : new URL(window.location.pathname, window.location.origin);
}
