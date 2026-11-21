/**
 * The journal lock's fingerprint in the Android app.
 *
 * On the web the fingerprint is a passkey (passkey.ts). The app's web view
 * has no passkeys, so the phone keeps a key of its own in Android's keystore,
 * which Android only lets the app use right after the fingerprint (or the
 * phone's PIN) is given (IrisFingerprintPlugin.java). That key locks a copy
 * of the journal key, and the locked copy is kept as a key slot like any
 * other, so it follows the account: the website lists it with the other
 * fingerprint devices and can remove it if the phone is lost.
 *
 * The slot is stored as kind 'passkey' with PHONE_RP in place of a website,
 * so the cloud needs no change: the website never tries to open it (its own
 * passkeys are matched by website), and passkey.ts sends every fingerprint
 * call here inside the app. credentialId names the phone's keystore key, so
 * each phone opens only its own slot.
 *
 * Everything here except PHONE_RP is for the app only, reached behind
 * IS_ANDROID_APP.
 */

import type { DBJournalKeySlot } from '../../adapters/db';
import { callNative } from '../android/bridge';
import { fromBase64Url, toBase64Url } from './crypto';

/** What a phone's fingerprint slot has in place of a passkey's website. */
export const PHONE_RP = 'android-app';

/** How the phone's fingerprint is listed among the fingerprint devices. */
const PHONE_LABEL = 'Android phone · irisBible app';

export type PhoneFingerprintState = 'ready' | 'not-enrolled' | 'no-hardware' | 'unavailable';

export interface PhoneFingerprintStatus {
  /** Whether a fingerprint is set up on the phone and can be used. */
  state: PhoneFingerprintState;
  /** The keystore keys this phone holds, by the credentialId of their slots. */
  keys: string[];
}

/**
 * Why a fingerprint step didn't finish, as the plugin says it: 'cancelled',
 * 'missing', 'reset', 'no-match', 'locked-out', 'not-enrolled', 'busy' or
 * 'failed'. `message` is Android's own words.
 */
export class PhoneFingerprintError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PhoneFingerprintError';
  }
}

function asError(err: unknown): PhoneFingerprintError {
  const e = err as { code?: string; message?: string };
  return new PhoneFingerprintError(e?.code || 'failed', e?.message || String(err));
}

// The plugin speaks plain base64; slots keep the URL-safe kind.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** What the locked copy is bound to, the same as every slot (crypto.ts slotContext). */
function slotBinding(slotId: string): string {
  return `hexapla journal key slot v1|${slotId}|passkey`;
}

export async function phoneFingerprintStatus(): Promise<PhoneFingerprintStatus> {
  try {
    const status = await callNative<PhoneFingerprintStatus>('IrisFingerprint', 'status');
    return { state: status.state ?? 'unavailable', keys: status.keys ?? [] };
  } catch {
    return { state: 'unavailable', keys: [] };
  }
}

/** The slots this phone holds the key for. */
export function phoneSlots(slots: DBJournalKeySlot[], keyId: string | null, keys: string[]): DBJournalKeySlot[] {
  return slots.filter((s) =>
    s.kind === 'passkey' && s.rpId === PHONE_RP && !!s.credentialId && keys.includes(s.credentialId)
    && (!keyId || s.keyId === keyId));
}

/**
 * Make a key on this phone, ask for the fingerprint, and lock a copy of the
 * journal key with it. `salt` is only kept so every passkey of a lock keeps
 * sharing one (passkey.ts createPasskeySlot); the phone's key needs none.
 */
export async function createPhoneSlot(
  journalKey: Uint8Array<ArrayBuffer>,
  keyId: string,
  userId: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<DBJournalKeySlot> {
  const id = crypto.randomUUID();
  const credentialId = crypto.randomUUID();
  let wrapped: string;
  try {
    ({ wrapped } = await callNative<{ wrapped: string }>('IrisFingerprint', 'create', {
      id: credentialId,
      secret: toBase64(journalKey),
      aad: slotBinding(id),
      title: 'Lock your journal',
      subtitle: 'Use your fingerprint to lock your irisBible journal',
      cancel: 'Cancel',
    }));
  } catch (err) {
    throw asError(err);
  }
  return {
    id,
    userId,
    kind: 'passkey',
    keyId,
    label: PHONE_LABEL,
    credentialId,
    rpId: PHONE_RP,
    salt: toBase64Url(salt),
    wrappedKey: toBase64Url(fromBase64(wrapped)),
    createdAt: Date.now(),
  };
}

/** The unlock already asking, which a second lock screen joins rather than stacking a prompt on. */
let opening: Promise<{ journalKey: Uint8Array<ArrayBuffer>; slot: DBJournalKeySlot }> | null = null;

/** Ask for the fingerprint and open this phone's slot. */
export function openWithPhone(
  slots: DBJournalKeySlot[],
  keyId: string | null,
): Promise<{ journalKey: Uint8Array<ArrayBuffer>; slot: DBJournalKeySlot }> {
  opening ??= runOpen(slots, keyId).finally(() => {
    opening = null;
  });
  return opening;
}

async function runOpen(
  slots: DBJournalKeySlot[],
  keyId: string | null,
): Promise<{ journalKey: Uint8Array<ArrayBuffer>; slot: DBJournalKeySlot }> {
  const { keys } = await phoneFingerprintStatus();
  const slot = phoneSlots(slots, keyId, keys)[0];
  if (!slot) throw new PhoneFingerprintError('missing', 'This phone has no fingerprint for the journal');
  try {
    const { secret } = await callNative<{ secret: string }>('IrisFingerprint', 'open', {
      id: slot.credentialId,
      wrapped: toBase64(fromBase64Url(slot.wrappedKey)),
      aad: slotBinding(slot.id),
      title: 'Unlock your journal',
      subtitle: 'Use your fingerprint to open your irisBible journal',
      cancel: 'Cancel',
    });
    return { journalKey: fromBase64(secret), slot };
  } catch (err) {
    throw asError(err);
  }
}

/** Delete this phone's key for a slot, so that slot can never be opened again. */
export function forgetPhoneKey(credentialId: string): void {
  void callNative('IrisFingerprint', 'remove', { id: credentialId }).catch(() => {});
}

/** Close the fingerprint prompt if one is showing. */
export function cancelPhonePrompt(): void {
  void callNative('IrisFingerprint', 'cancel').catch(() => {});
}
