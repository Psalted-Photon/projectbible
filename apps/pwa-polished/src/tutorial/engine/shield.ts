/**
 * Keeps taps on the tutorial from being read by the app as taps elsewhere.
 *
 * Several parts of the app close themselves when you press anywhere outside
 * them: the tap-a-word ring listens for presses on the whole document, before
 * any element sees them, and the navbar's dropdowns close on any click outside.
 * A tutorial card saying "now pick a chapter" would close the very dropdown it
 * is pointing at the moment its Next button was pressed.
 *
 * So presses that land on the tutorial's own cards, dots and dimmed areas are
 * stopped at the window, before the app's document-level listeners run, and
 * clicks are stopped at the tutorial's root on their way back up. The
 * tutorial's own buttons still work: they react to click, which reaches them
 * first. Taps in the spotlight's hole never touch the tutorial at all, so the
 * app gets those untouched.
 *
 * `.tut-lane` is the exception: the invisible strip the tour lays over a screen
 * edge so a drag starting there opens a window. The app's edge-gesture detector
 * listens on the window, so that press has to be let through.
 */

const PRESS_EVENTS = ['pointerdown', 'mousedown', 'touchstart'] as const;

export function installShield(root: HTMLElement): () => void {
  const onPress = (event: Event) => {
    const target = event.target as Node | null;
    if (!target || !root.contains(target)) return;
    if ((target as Element).closest?.('.tut-lane')) return;
    event.stopPropagation();
  };

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest?.('.tut-lane')) return;
    event.stopPropagation();
  };

  for (const type of PRESS_EVENTS) {
    window.addEventListener(type, onPress, { capture: true, passive: true });
  }
  root.addEventListener('click', onClick);

  return () => {
    for (const type of PRESS_EVENTS) {
      window.removeEventListener(type, onPress, { capture: true });
    }
    root.removeEventListener('click', onClick);
  };
}
