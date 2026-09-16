/**
 * Putting text on the clipboard, everywhere the app does it.
 *
 * Lifted out of ShareModal when the shared-notebook invite needed the same
 * thing. It is two lines of API and a fallback, and the fallback is the reason
 * it is worth having in one place: navigator.clipboard is absent on http://
 * (a dev server reached over the LAN is not a secure context) and refuses
 * without a user gesture in a few browsers, and a Copy button that silently
 * does nothing is worse than no Copy button.
 */

/** Pre-clipboard-API fallback, so the button is never simply dead. */
function legacyCopy(text: string): boolean {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
  document.body.appendChild(el);
  el.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}

/** True if the text is now on the clipboard. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

/**
 * Whether there is a share sheet to open at all.
 *
 * Firefox on the desktop has none, so the button would open nothing — better
 * to drop it and leave Copy as the single obvious way out. Read once: nothing
 * about it changes while a sheet is open.
 */
export const canShare =
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Hand text to the OS share sheet.
 *
 * Returns false when the person dismissed it, which is not a failure and must
 * not be reported as one — the sheet that called this should stay open so the
 * choice can be made again.
 */
export async function shareText(text: string): Promise<boolean> {
  try {
    await navigator.share({ text });
    return true;
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') console.error('Share failed:', err);
    return false;
  }
}
