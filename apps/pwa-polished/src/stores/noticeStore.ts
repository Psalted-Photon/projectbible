import { writable } from 'svelte/store';

/**
 * In-app messages, in place of the browser's alert() box. alert() stops the
 * whole app until it's dismissed and looks nothing like the rest of it;
 * these slide in over whatever is open, in the app's own card, and go away by
 * themselves. AppNotice.svelte draws them.
 */

export type NoticeKind = 'success' | 'error';

export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
}

export const notices = writable<Notice[]>([]);

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** More than this and the oldest goes, so a run of failures can't fill the screen. */
const MAX_VISIBLE = 3;

export function showNotice(text: string, kind: NoticeKind = 'success') {
  const id = nextId++;
  notices.update((list) => {
    const next = [...list, { id, kind, text }];
    while (next.length > MAX_VISIBLE) dismissTimer(next.shift()!.id);
    return next;
  });
  // Errors tend to be longer and matter more, so they stay up longer, and a
  // long message gets time to be read.
  const base = kind === 'error' ? 8000 : 4000;
  const ms = Math.min(15000, Math.max(base, text.length * 60));
  timers.set(id, setTimeout(() => dismissNotice(id), ms));
}

export function dismissNotice(id: number) {
  dismissTimer(id);
  notices.update((list) => list.filter((n) => n.id !== id));
}

function dismissTimer(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

/** The readable part of a caught error — its message, not "Error: …". */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
