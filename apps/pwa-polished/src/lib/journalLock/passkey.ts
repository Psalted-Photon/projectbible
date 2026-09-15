/**
 * The fingerprint lock: a passkey that hands the app a secret.
 *
 * Uses the WebAuthn PRF extension. Each passkey slot keeps a random salt;
 * asking the passkey to evaluate that salt — which only happens after the
 * phone's own fingerprint, face or passcode check — returns the same 32-byte
 * secret every time, and that secret opens the slot's copy of the journal
 * key. No server is asked whether the finger was right: without the passkey's
 * answer, the slot simply doesn't open.
 *
 * The passkey is saved in iCloud Keychain or Google Password Manager, so it
 * follows the account to the user's other devices on the same platform.
 */

import type { DBJournalKeySlot } from '../../adapters/db';
import {
  deriveSlotKey, fromBase64Url, randomBytes, toBase64Url, unwrapJournalKey, wrapJournalKey,
} from './crypto';

export type PasskeyProblem =
  /** The person closed the prompt, or it timed out. */
  | 'cancelled'
  /** This browser or phone can't hand over a secret (no PRF). */
  | 'unsupported'
  /** This device already has a fingerprint for the journal. */
  | 'already-added'
  /** None of the saved passkeys opened a current slot. */
  | 'no-match'
  /** Anything else. */
  | 'failed';

export class PasskeyError extends Error {
  /**
   * `detail` is what the browser itself said ("SecurityError: …"), kept so a
   * failure on a real phone can be read off the screen or eruda.
   */
  constructor(readonly problem: PasskeyProblem, readonly detail = '') {
    super(detail ? `${problem} (${detail})` : problem);
    this.name = 'PasskeyError';
  }
}

const PROMPT_TIMEOUT_MS = 120_000;

/**
 * The site a passkey is tied to. Both hexapla.app and www.hexapla.app share
 * one, so a passkey made on either works on both. Any other address (the old
 * vercel.app one, a local dev server) gets passkeys of its own.
 */
export function currentRpId(): string {
  const host = location.hostname;
  if (host === 'hexapla.app' || host.endsWith('.hexapla.app')) return 'hexapla.app';
  return host;
}

/**
 * Can this browser use a fingerprint for the journal? 'maybe' means nothing
 * ruled it out — some browsers only tell you by trying.
 */
export async function fingerprintSupport(): Promise<'yes' | 'no' | 'maybe'> {
  if (typeof window === 'undefined' || !window.isSecureContext) return 'no';
  if (!('PublicKeyCredential' in window) || !navigator.credentials?.create) return 'no';
  try {
    const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!platform) return 'no';
    const getCaps = (PublicKeyCredential as any).getClientCapabilities;
    if (typeof getCaps === 'function') {
      const caps = await getCaps.call(PublicKeyCredential);
      if (caps?.['extension:prf'] === true) return 'yes';
      if (caps?.['extension:prf'] === false) return 'no';
    }
  } catch {
    // A browser that throws here is not one to rule out; try it for real.
  }
  return 'maybe';
}

/** "iPhone · Safari", "Android · Chrome" — how a fingerprint device is listed. */
export function describeThisDevice(): string {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  let device = 'This device';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) device = 'iPad';
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Macintosh/.test(ua)) device = 'Mac';
  else if (/Windows/.test(ua)) device = 'Windows';
  else if (/CrOS/.test(ua)) device = 'Chromebook';
  else if (/Linux/.test(ua)) device = 'Linux';

  let browser = '';
  if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome|CriOS/.test(ua)) browser = 'Chrome';
  else if (/Safari/.test(ua)) browser = 'Safari';

  return browser ? `${device} · ${browser}` : device;
}

function asProblem(err: unknown, fallback: PasskeyProblem = 'failed'): PasskeyError {
  if (err instanceof PasskeyError) return err;
  const name = (err as { name?: string })?.name;
  const message = (err as { message?: string })?.message;
  const detail = [name, message].filter(Boolean).join(': ') || String(err);
  if (name === 'NotAllowedError' || name === 'AbortError') return new PasskeyError('cancelled', detail);
  if (name === 'InvalidStateError') return new PasskeyError('already-added', detail);
  if (name === 'NotSupportedError') return new PasskeyError('unsupported', detail);
  return new PasskeyError(fallback, detail);
}

/**
 * Tell the password manager a passkey is no longer used, so it stops being
 * offered. Best effort: only some browsers can, and only for passkeys saved
 * on this device.
 */
export function forgetPasskey(rpId: string, credentialId: string): void {
  try {
    const signal = (PublicKeyCredential as any)?.signalUnknownCredential;
    if (typeof signal === 'function') {
      void Promise.resolve(signal.call(PublicKeyCredential, { rpId, credentialId })).catch(() => {});
    }
  } catch {
    // Nothing to do — the unused passkey just stays listed.
  }
}

/**
 * The fingerprint request this app has open. A request the phone never shows
 * stays open until it times out, and while it does the phone refuses every
 * new one ("A request is already pending"), so it has to be closable.
 */
let openPrompt: AbortController | null = null;

/** Close a fingerprint request that's still open. */
export function cancelPasskeyPrompt(): void {
  openPrompt?.abort();
  openPrompt = null;
}

/**
 * Run one passkey request, closing any still-open one first. `run` is called
 * straight away, not after an await, so the tap that started it still counts
 * as the tap (iPhones insist).
 */
async function withPrompt<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const closedOne = openPrompt !== null;
  cancelPasskeyPrompt();
  const controller = new AbortController();
  openPrompt = controller;
  try {
    try {
      return await run(controller.signal);
    } catch (err) {
      // The phone can take a moment to let go of the request just closed.
      if (closedOne && (err as { name?: string })?.name === 'OperationError' && !controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return await run(controller.signal);
      }
      throw err;
    }
  } finally {
    if (openPrompt === controller) openPrompt = null;
  }
}

function prfFirst(credential: PublicKeyCredential): Uint8Array<ArrayBuffer> | null {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (!first) return null;
  const bytes = first instanceof ArrayBuffer
    ? new Uint8Array(first)
    : new Uint8Array((first as ArrayBufferView).buffer.slice(
        (first as ArrayBufferView).byteOffset,
        (first as ArrayBufferView).byteOffset + (first as ArrayBufferView).byteLength,
      ) as ArrayBuffer);
  return bytes.length >= 32 ? bytes : null;
}

/**
 * Make a new passkey on this device and a slot it opens. The person may be
 * asked for their fingerprint twice: some phones only hand over the secret
 * when the new passkey is used, not when it is made.
 *
 * `sharedSalt` is the salt the lock's other passkeys already use. Sharing one
 * is safe (each passkey turns the same salt into its own, unrelated secret)
 * and lets unlocking ask all of them with a single plain request.
 */
export async function createPasskeySlot(
  journalKey: Uint8Array<ArrayBuffer>,
  keyId: string,
  userId: string,
  accountName: string,
  existingCredentialIds: string[],
  sharedSalt?: Uint8Array<ArrayBuffer>,
): Promise<DBJournalKeySlot> {
  const rpId = currentRpId();
  const salt = sharedSalt ?? randomBytes(32);

  let created: PublicKeyCredential | null;
  try {
    created = (await withPrompt((signal) => navigator.credentials.create({
      signal,
      publicKey: {
        rp: { id: rpId, name: 'Hexapla' },
        // A fresh random handle per passkey, so adding a second device never
        // replaces the first one's passkey in a synced password manager.
        user: { id: randomBytes(16), name: accountName || 'Journal lock', displayName: 'Hexapla journal lock' },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -8 },   // EdDSA
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
        excludeCredentials: existingCredentialIds.map((id) => ({ type: 'public-key' as const, id: fromBase64Url(id) })),
        attestation: 'none',
        timeout: PROMPT_TIMEOUT_MS,
        extensions: { prf: { eval: { first: salt } } },
      },
    }))) as PublicKeyCredential | null;
  } catch (err) {
    throw asProblem(err);
  }
  if (!created) throw new PasskeyError('cancelled');

  const credentialId = toBase64Url(created.rawId);
  const prf = created.getClientExtensionResults().prf;
  let secret = prfFirst(created);

  try {
    if (!secret) {
      if (prf?.enabled === false) throw new PasskeyError('unsupported');
      // Made, but the secret only comes when it's used. Use it once.
      let used: PublicKeyCredential | null;
      try {
        used = (await withPrompt((signal) => navigator.credentials.get({
          signal,
          publicKey: {
            rpId,
            challenge: randomBytes(32),
            allowCredentials: [{ type: 'public-key', id: fromBase64Url(credentialId) }],
            userVerification: 'required',
            timeout: PROMPT_TIMEOUT_MS,
            extensions: { prf: { eval: { first: salt } } },
          },
        }))) as PublicKeyCredential | null;
      } catch (err) {
        throw asProblem(err);
      }
      if (!used) throw new PasskeyError('cancelled');
      secret = prfFirst(used);
      if (!secret) throw new PasskeyError('unsupported');
    }
  } catch (err) {
    // The passkey exists but can't be used for the journal: don't leave it
    // cluttering the password manager.
    forgetPasskey(rpId, credentialId);
    throw err;
  }

  const id = crypto.randomUUID();
  const slotKey = await deriveSlotKey(secret, 'passkey');
  return {
    id,
    userId,
    kind: 'passkey',
    keyId,
    label: describeThisDevice(),
    credentialId,
    rpId,
    salt: toBase64Url(salt),
    wrappedKey: await wrapJournalKey(slotKey, id, 'passkey', journalKey),
    createdAt: Date.now(),
  };
}

/** Passkey slots a fingerprint on this site could open. */
export function usablePasskeySlots(slots: DBJournalKeySlot[], keyId: string | null): DBJournalKeySlot[] {
  const rpId = currentRpId();
  return slots.filter((s) =>
    s.kind === 'passkey' && !!s.credentialId && s.rpId === rpId && (!keyId || s.keyId === keyId));
}

/**
 * Ask for a fingerprint and open whichever slot its passkey belongs to.
 * Must be called from a tap: phones refuse the prompt otherwise.
 */
export async function openWithPasskey(
  slots: DBJournalKeySlot[],
  keyId: string | null,
): Promise<{ journalKey: Uint8Array<ArrayBuffer>; slot: DBJournalKeySlot }> {
  const usable = usablePasskeySlots(slots, keyId);
  if (usable.length === 0) throw new PasskeyError('no-match');

  // When the passkeys share a salt (always, for one passkey), ask without
  // naming them: the phone shows its own passkey picker, the same route that
  // made the passkey. Naming passkeys by id takes a different route on
  // Android that, in the installed app, stalls without ever showing a prompt.
  // Only passkeys with different salts still need to be named.
  const shared = new Set(usable.map((s) => s.salt)).size === 1;
  let request: PublicKeyCredentialRequestOptions;
  if (shared) {
    request = {
      rpId: currentRpId(),
      challenge: randomBytes(32),
      userVerification: 'required',
      timeout: PROMPT_TIMEOUT_MS,
      extensions: { prf: { eval: { first: fromBase64Url(usable[0].salt) } } },
    };
  } else {
    const evalByCredential: Record<string, { first: Uint8Array<ArrayBuffer> }> = {};
    for (const slot of usable) evalByCredential[slot.credentialId!] = { first: fromBase64Url(slot.salt) };
    request = {
      rpId: currentRpId(),
      challenge: randomBytes(32),
      allowCredentials: usable.map((s) => ({ type: 'public-key' as const, id: fromBase64Url(s.credentialId!) })),
      userVerification: 'required',
      timeout: PROMPT_TIMEOUT_MS,
      extensions: { prf: { evalByCredential } },
    };
  }

  let credential: PublicKeyCredential | null;
  try {
    credential = (await withPrompt((signal) =>
      navigator.credentials.get({ signal, publicKey: request }))) as PublicKeyCredential | null;
  } catch (err) {
    throw asProblem(err);
  }
  if (!credential) throw new PasskeyError('cancelled');

  const slot = usable.find((s) => s.credentialId === toBase64Url(credential!.rawId));
  if (!slot) throw new PasskeyError('no-match', 'that passkey isn’t one of this lock’s');
  const secret = prfFirst(credential);
  if (!secret) throw new PasskeyError('unsupported', 'the passkey gave no secret');

  try {
    const slotKey = await deriveSlotKey(secret, 'passkey');
    const journalKey = await unwrapJournalKey(slotKey, slot.id, 'passkey', slot.wrappedKey);
    return { journalKey, slot };
  } catch (err) {
    throw new PasskeyError('no-match', `the secret didn't open the slot: ${(err as Error)?.name ?? err}`);
  }
}
