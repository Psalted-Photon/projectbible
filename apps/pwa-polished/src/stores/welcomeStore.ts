import { writable } from 'svelte/store';
import { supabase } from '../lib/supabase/client';

/**
 * The confirmation link from a signup email lands back here already signed in.
 * Supabase says so exactly once, in the URL fragment it then consumes
 * (`#access_token=...&type=signup`), so the arrival is caught at module load —
 * before the auth client has finished reading and clearing the link — and kept
 * in sessionStorage, so the service worker's auto-update reload doesn't eat the
 * welcome before it has been shown.
 *
 * Modelled on passwordRecoveryStore, which catches the sibling case.
 */
const FLAG_KEY = 'pb-welcome-pending';

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(FLAG_KEY, '1');
    else sessionStorage.removeItem(FLAG_KEY);
  } catch {
    // Private mode: the welcome just won't survive a reload.
  }
}

/** True while a newly confirmed account still has a welcome owed to it. */
export const welcomePending = writable<boolean>(readFlag());

export function dismissWelcome(): void {
  writeFlag(false);
  welcomePending.set(false);
}

/** Only here so the modal can be looked at without signing up again. */
export function showWelcome(): void {
  writeFlag(true);
  welcomePending.set(true);
}

// Read the link before supabase-js clears it. `type=signup` is what a
// confirmation return carries; a password reset says `recovery` and belongs to
// the other store.
try {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const arrivedFromConfirm = (p: URLSearchParams) =>
    p.get('type') === 'signup' && (p.has('access_token') || p.has('refresh_token'));
  if (arrivedFromConfirm(hash) || arrivedFromConfirm(query)) {
    writeFlag(true);
    welcomePending.set(true);
  }
} catch {
  // A malformed URL must not stop the app from starting.
}

supabase.auth.onAuthStateChange((event) => {
  // Signing out cancels an unshown welcome — it belonged to that account.
  if (event === 'SIGNED_OUT') dismissWelcome();
});
