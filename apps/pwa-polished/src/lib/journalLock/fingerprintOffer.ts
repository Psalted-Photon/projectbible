/**
 * The Android app's offer to lock the journal with the phone's fingerprint.
 *
 * When the journal opens unlocked, a toast offers it, with Fingerprint and
 * Not now buttons:
 *   - no lock yet: "You can lock your journal with your fingerprint."
 *     Fingerprint opens the setup straight at the fingerprint step
 *     (JournalLockDialog quick, shown by App.svelte).
 *   - locked, but opened here with the recovery code (it was locked on the
 *     website or another phone, whose fingerprints don't carry over):
 *     "Open your journal with your fingerprint next time?" Fingerprint adds
 *     this phone's fingerprint there and then.
 *
 * Offered once a launch at most. Not now stops it for 30 days; Settings →
 * Privacy has the lock any time. Never offered to an account that turned the
 * lock off before, on a phone with no fingerprint set up, or during the tour.
 *
 * App only: called from the journal's doors behind IS_ANDROID_APP.
 */

import { get, writable } from 'svelte/store';
import { showNotice } from '../../stores/noticeStore';
import { userProfileStore } from '../../stores/userProfileStore';
import { tutorial } from '../../tutorial/state';
import { addThisDeviceFingerprint, JournalLockError } from './actions';
import { currentLockView } from './lockState';
import { PasskeyError } from './passkey';
import { phoneFingerprintStatus, phoneSlots } from './phoneFingerprint';
import { readLocalLock } from './slotStore';

const SNOOZE_KEY = 'pb_fingerprint_offer_until';
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** True while the offer's Fingerprint is turning the lock on. App.svelte shows the setup for it. */
export const quickLockSetup = writable(false);

let offered = false;
let checking = false;

function snoozed(): boolean {
  try {
    return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // Private storage unavailable: it just offers again next launch.
  }
}

async function addPhoneFingerprint(): Promise<void> {
  try {
    await addThisDeviceFingerprint();
    showNotice('Your fingerprint now opens the journal.', 'success');
  } catch (err) {
    if (err instanceof PasskeyError && err.problem === 'cancelled') return;
    if (err instanceof JournalLockError) {
      showNotice(err.message, 'error');
    } else {
      console.warn('[JournalLock] Adding the phone’s fingerprint failed:', err);
      showNotice('Couldn’t add your fingerprint. Try again from Settings → Privacy.', 'error');
    }
  }
}

/** The journal just opened unlocked: offer the fingerprint if it fits. */
export async function offerFingerprintLock(): Promise<void> {
  if (offered || checking || snoozed() || !navigator.onLine) return;
  if (!get(userProfileStore).isSignedIn) return;
  // Not in the middle of the tour, which opens the journal to show it.
  const tour = get(tutorial);
  if (tour.on && tour.stage !== 'done') return;
  checking = true;
  try {
    const before = currentLockView();
    if (!before.ready || before.needsUnlock || before.work) return;
    const turnOn = before.mode === 'off' && before.slots.length === 0;
    const addPhone = before.mode === 'on' && before.unlocked;
    if (!turnOn && !addPhone) return;

    // Neither of these changes within a launch, so they're asked once.
    const { state, keys } = await phoneFingerprintStatus();
    if (state !== 'ready') {
      offered = true;
      return;
    }
    if (turnOn) {
      // An account that had the lock and turned it off chose that.
      const lock = await readLocalLock();
      if (lock && lock.updatedAt > 0) {
        offered = true;
        return;
      }
    }

    // Anything may have changed while the phone was asked.
    const view = currentLockView();
    if (view.needsUnlock || view.mode !== before.mode) return;
    if (addPhone && (!view.unlocked || phoneSlots(view.slots, view.keyId, keys).length > 0)) return;
    if (turnOn && view.slots.length > 0) return;

    offered = true;
    showNotice(
      turnOn ? 'You can lock your journal with your fingerprint.' : 'Open your journal with your fingerprint next time?',
      'info',
      {
        icon: 'fingerprint',
        action: {
          label: 'Fingerprint',
          icon: 'fingerprint',
          run: turnOn ? () => quickLockSetup.set(true) : () => void addPhoneFingerprint(),
        },
        secondary: { label: 'Not now', run: snooze },
      },
    );
  } finally {
    checking = false;
  }
}
