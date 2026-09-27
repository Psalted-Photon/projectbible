/**
 * A counter that moves every time this device's account data is cleared away
 * (sign-out, or a different account signing in).
 *
 * A pull reads it before it asks the server and again before it writes what
 * came back. If it has moved in between, the answer belongs to an account that
 * is no longer here, and writing it would put the old account's rows back on a
 * device that has just been emptied for the next one. So the pull drops it.
 *
 * No imports on purpose: both the sync service and the shared-notebook store
 * read it, and clearPersonalData moves it, and those already import each other
 * in ways that would turn into a cycle.
 */

let epoch = 0;

export function accountEpoch(): number {
  return epoch;
}

export function bumpAccountEpoch(): void {
  epoch++;
}
