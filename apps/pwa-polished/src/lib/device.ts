/**
 * What kind of device and window the app is running in, for the few places
 * that have to behave differently on a phone or in the installed app.
 */

/** True when running as an installed app rather than a browser tab. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari's own flag; the manifest uses display:fullscreen, so check that too.
  if ((window.navigator as any).standalone === true) return true;
  return ['standalone', 'fullscreen', 'minimal-ui'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
  );
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ reports as Macintosh, so also look for a touch-capable "Mac".
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  );
}

/** An iPhone, iPad or Android device, where files go through the share sheet. */
export function isPhoneOrTablet(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isIOS() || /Android/i.test(navigator.userAgent);
}
