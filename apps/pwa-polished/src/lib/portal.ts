/**
 * Svelte action: move an overlay to the end of <body>.
 *
 * Light and sepia put a filter on `.themed`, and a filter turns that ancestor
 * into the box `position: fixed` descendants are placed in (see
 * lib/fixedOrigin.ts) — so a full-screen overlay rendered inside a docked
 * window is boxed into that window. Out at <body> it covers the screen.
 *
 * Leaving `.themed` also leaves its theme filter behind, so the overlay takes
 * the class along when it was inside one and looks the same as before.
 */
export function portal(node: HTMLElement) {
  if (node.parentElement?.closest('.themed')) node.classList.add('themed');
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
