import { writable } from 'svelte/store';
import { supabase } from '../lib/supabase/client';
import { profileModalStore } from './profileModalStore';

/**
 * "Forgot password" lands back here from the email link already signed in,
 * and Supabase announces it once with a PASSWORD_RECOVERY event. That event is
 * the only sign the person still needs to pick a new password, so it is caught
 * at module load (before the auth client finishes reading the link) and kept
 * in sessionStorage so an auto-update reload doesn't lose the form.
 */
const FLAG_KEY = 'pb-password-recovery';

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
    // Private mode: the form just won't survive a reload.
  }
}

/** True while the person arrived from a reset link and hasn't set a new password yet. */
export const passwordRecovery = writable<boolean>(readFlag());

/** Plain-language message when an email link comes back expired or already used. */
export const authLinkError = writable<string>('');

export function finishPasswordRecovery(): void {
  writeFlag(false);
  passwordRecovery.set(false);
}

if (readFlag()) profileModalStore.open();

// An expired or reused link comes back as #error=...&error_code=otp_expired.
// Supabase leaves that in the address bar, so strip it here or every reload
// would repeat the message.
try {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const linkFailed = (p: URLSearchParams) =>
    !p.get('access_token') && (p.has('error_code') || p.has('error_description'));
  if (linkFailed(hash) || linkFailed(query)) {
    authLinkError.set(
      'That email link has expired or was already used. If it was a password reset, tap "Forgot password?" to get a new one.',
    );
    profileModalStore.open();
    for (const key of ['error', 'error_code', 'error_description']) query.delete(key);
    const rest = query.toString();
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + (rest ? `?${rest}` : ''),
    );
  }
} catch {
  // A malformed URL must not stop the app from starting.
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    writeFlag(true);
    passwordRecovery.set(true);
    profileModalStore.open();
  } else if (event === 'SIGNED_OUT') {
    finishPasswordRecovery();
  }
});
