/**
 * The screen's safe-area insets (a notch, a status bar, the home indicator),
 * for placing cards in script. CSS can read `env(safe-area-inset-*)` but
 * script can't, so a hidden probe carries them as padding and reports back.
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let probe: HTMLElement | null = null;

export function safeInsets(): Insets {
  if (!probe?.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    // Inside the tutorial's own root when it's there, so the app's page never
    // gains an element it doesn't know about.
    (document.querySelector('.tut-root') ?? document.body).appendChild(probe);
  }
  const style = getComputedStyle(probe);
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}
