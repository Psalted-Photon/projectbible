/**
 * The two letters and the colour a member is known by.
 *
 * Every member of a shared notebook gets the badge a commentator gets — two
 * letters on a coloured disc — so the palette is the commentary palette rather
 * than a second one invented for this. A member's colour is identity, not
 * appearance: unlike the typeface and the page colours, which are each reader's
 * own, it is stored on the member row and looks the same to everyone.
 *
 * These are the defaults, worked out from what we already know about a person
 * at the moment they join. Phase 4 adds the picker that lets them change both.
 */

import { COMMENTARY_AUTHORS } from '../annotationConfig';

/**
 * The palette, in a fixed order, with duplicates removed.
 *
 * Fixed because the colour is derived from the user id below, and a palette
 * that reordered itself would give the same person a different colour on a
 * different device. Object key order in JavaScript is stable for string keys,
 * so this is the order annotationConfig lists them in.
 */
export const MEMBER_COLORS: string[] = [
  ...new Set(Object.values(COMMENTARY_AUTHORS).map((a) => a.color)),
];

/**
 * Two letters from a name: the initials where there are two words, the first
 * two letters where there is one.
 *
 * "Marlowe Scotts" → MS. "Marlowe" → Ma, in the same mixed case the commentary
 * badges use for a single-word name. An empty name falls back to two dashes
 * rather than an empty badge, because a blank disc looks like a bug.
 */
export function defaultInitials(displayName: string): string {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) {
    const word = words[0];
    return (word[0].toUpperCase() + (word[1] ?? '')).slice(0, 2);
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A colour for this account, the same one every time.
 *
 * Derived from the user id rather than picked at random so that joining from a
 * phone and a laptop does not produce two different colours for one person,
 * and so nothing has to be looked up before the join goes through — the roster
 * of a notebook you are not yet in is, correctly, unreadable.
 *
 * It can therefore land on a colour somebody in that notebook already has.
 * That is a collision in a badge, not in data, and phase 4's picker is where it
 * gets resolved — it will offer the free colours first.
 */
export function defaultMemberColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return MEMBER_COLORS[hash % MEMBER_COLORS.length] ?? '#888888';
}

/** Everything a new member row needs, from a display name and an account id. */
export function defaultMemberIdentity(
  displayName: string,
  userId: string,
): { displayName: string; initials: string; color: string } {
  const name = (displayName ?? '').trim();
  return {
    displayName: name,
    initials: defaultInitials(name),
    color: defaultMemberColor(userId),
  };
}
