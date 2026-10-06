import { writable } from 'svelte/store';

/**
 * In-app yes/no questions, in place of the browser's confirm() box. confirm()
 * is a gray system dialog that looks nothing like the rest of the app; these
 * ask in the same card as the notices. AppConfirm.svelte draws them.
 */

export interface ConfirmOptions {
  /** The yes button. Name the action where there is one: "Remove", "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** A red yes button and a warning icon, for anything that deletes. */
  danger?: boolean;
}

export interface ConfirmRequest {
  id: number;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

/** Questions waiting for an answer, oldest first. Only the first is on screen. */
export const confirms = writable<ConfirmRequest[]>([]);

let nextId = 1;

/** Ask, and resolve true for yes and false for no, Escape or a tap outside. */
export function askConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    confirms.update((list) => [
      ...list,
      {
        id: nextId++,
        message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        resolve,
      },
    ]);
  });
}

export function answerConfirm(id: number, ok: boolean) {
  confirms.update((list) => {
    list.find((c) => c.id === id)?.resolve(ok);
    return list.filter((c) => c.id !== id);
  });
}
