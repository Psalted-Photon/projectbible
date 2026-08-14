/**
 * Is this event headed somewhere the user types?
 *
 * Several handlers in this app listen on `window` or `document` for every press
 * or keystroke — the edge-swipe detector, the reader's click-away that clears a
 * selection, the contents list's type-to-jump. Each of them has to leave text
 * fields alone, and historically each learned that the hard way: a new input
 * would be added, it would refuse to accept typing, and the field would get its
 * own hand-rolled `stopPropagation` shield. NotesPane still carries the note
 * that named the pattern — "every input in the app that works stops these
 * first."
 *
 * That is backwards. A global handler should excuse text entry itself, so a new
 * field works the moment it is added rather than after someone remembers to
 * defend it. This is the one test they all share.
 *
 * `closest` rather than a tag check, so it also covers a click landing on
 * something nested inside a contenteditable.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.(
    'input, textarea, select, [contenteditable="true"]',
  );
}
