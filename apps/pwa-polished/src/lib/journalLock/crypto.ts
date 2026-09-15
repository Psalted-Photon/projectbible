/**
 * Scramble and unscramble for the journal lock.
 *
 * One random 256-bit journal key protects every journal title and entry.
 * Nothing here ever stores it: it lives in memory while the journal is
 * unlocked (lockState.ts), and at rest only as locked copies — key slots —
 * that a passkey or the recovery code can open.
 *
 * Fields are AES-256-GCM. Each one carries a version tag, so readable and
 * scrambled entries can sit side by side while the lock is switched on or
 * off, and is bound to its entry id, date and field name, so a scrambled
 * field copied onto another entry, another date or the other field fails to
 * open instead of showing up in the wrong place.
 */

/** Every scrambled field starts with this. The cloud guard checks for it too. */
export const SCRAMBLE_TAG = 'pbj1:';

const IV_BYTES = 12;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Bytes ↔ text ──────────────────────────────────────────────────────────

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ── The journal key ───────────────────────────────────────────────────────

export function generateJournalKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

async function hkdf(secret: Uint8Array<ArrayBuffer>, info: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/** The key that actually scrambles fields, derived from the journal key. */
export function deriveContentKey(journalKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return hkdf(journalKey, 'hexapla journal content v1', ['encrypt', 'decrypt']);
}

/**
 * A short public fingerprint of a journal key: tells a current key slot from
 * a stale one (the lock was turned off and on again) without revealing anything.
 */
export async function keyIdFor(journalKey: Uint8Array<ArrayBuffer>): Promise<string> {
  const label = enc.encode('hexapla journal key id v1:');
  const joined = new Uint8Array(label.length + journalKey.length);
  joined.set(label);
  joined.set(journalKey, label.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Fields ────────────────────────────────────────────────────────────────

export type ScrambledField = 'title' | 'text';

function fieldContext(entryId: string, date: string, field: ScrambledField): Uint8Array<ArrayBuffer> {
  return enc.encode(`hexapla journal field v1|${entryId}|${date}|${field}`);
}

export function isScrambled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SCRAMBLE_TAG);
}

/** Scramble one field. Empty stays empty, so a blank title stays blank. */
export async function scrambleField(
  contentKey: CryptoKey,
  entryId: string,
  date: string,
  field: ScrambledField,
  plain: string | null | undefined,
): Promise<string> {
  if (!plain) return '';
  const iv = randomBytes(IV_BYTES);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: fieldContext(entryId, date, field) },
    contentKey,
    enc.encode(plain),
  ));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return SCRAMBLE_TAG + toBase64Url(out);
}

/**
 * Unscramble one field. A readable value comes back unchanged. Throws if the
 * key is wrong or the field was tampered with or moved.
 */
export async function unscrambleField(
  contentKey: CryptoKey,
  entryId: string,
  date: string,
  field: ScrambledField,
  value: string | null | undefined,
): Promise<string> {
  if (!value) return '';
  if (!isScrambled(value)) return value;
  const bytes = fromBase64Url(value.slice(SCRAMBLE_TAG.length));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: fieldContext(entryId, date, field) },
    contentKey,
    bytes.slice(IV_BYTES),
  );
  return dec.decode(plain);
}

// ── Key slots ─────────────────────────────────────────────────────────────

function slotContext(slotId: string, kind: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`hexapla journal key slot v1|${slotId}|${kind}`);
}

/** Turn a secret from a passkey or recovery code into a slot's own lock. */
export function deriveSlotKey(secret: Uint8Array<ArrayBuffer>, kind: string): Promise<CryptoKey> {
  return hkdf(secret, `hexapla journal slot key v1|${kind}`, ['encrypt', 'decrypt']);
}

/** Lock a copy of the journal key inside a slot. */
export async function wrapJournalKey(
  slotKey: CryptoKey,
  slotId: string,
  kind: string,
  journalKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: slotContext(slotId, kind) },
    slotKey,
    journalKey,
  ));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64Url(out);
}

/** Open a slot. Throws if the passkey or recovery code doesn't match it. */
export async function unwrapJournalKey(
  slotKey: CryptoKey,
  slotId: string,
  kind: string,
  wrapped: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = fromBase64Url(wrapped);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: slotContext(slotId, kind) },
    slotKey,
    bytes.slice(IV_BYTES),
  );
  return new Uint8Array(raw);
}
