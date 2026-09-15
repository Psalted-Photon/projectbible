/**
 * The recovery code: the backup way to open the journal key.
 *
 * Six groups of four characters from a 32-letter alphabet with no look-alikes
 * (no I, L, O or U) — 120 random bits, far past guessing. It is shown once at
 * setup and never stored; only a slot it can open is kept.
 */

import type { DBJournalKeySlot } from '../../adapters/db';
import {
  deriveSlotKey, fromBase64Url, randomBytes, toBase64Url, unwrapJournalKey, wrapJournalKey,
} from './crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 6;
const GROUP_LENGTH = 4;
const CODE_LENGTH = GROUPS * GROUP_LENGTH;
const PBKDF2_ITERATIONS = 100_000;

export function generateRecoveryCode(): string {
  // 256 is an exact multiple of 32, so masking to 5 bits is unbiased.
  const bytes = randomBytes(CODE_LENGTH);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]);
  const groups: string[] = [];
  for (let i = 0; i < CODE_LENGTH; i += GROUP_LENGTH) {
    groups.push(chars.slice(i, i + GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}

/**
 * Tidy what someone typed: case, spaces and dashes don't matter, and the
 * look-alike letters are read as the digits they resemble.
 * Returns null when it can't be a recovery code.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-–—_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

/** The last group, which setup asks to have typed back. */
export function lastGroupOf(code: string): string {
  return code.split('-').pop() ?? '';
}

async function codeSecret(normalized: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(normalized), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** A slot the recovery code opens. `code` is the code as shown. */
export async function createRecoverySlot(
  journalKey: Uint8Array<ArrayBuffer>,
  keyId: string,
  userId: string,
  code: string,
): Promise<DBJournalKeySlot> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new Error('Not a recovery code');
  const id = crypto.randomUUID();
  const salt = randomBytes(16);
  const slotKey = await deriveSlotKey(await codeSecret(normalized, salt), 'recovery');
  return {
    id,
    userId,
    kind: 'recovery',
    keyId,
    label: '',
    credentialId: null,
    rpId: null,
    salt: toBase64Url(salt),
    wrappedKey: await wrapJournalKey(slotKey, id, 'recovery', journalKey),
    createdAt: Date.now(),
  };
}

/**
 * Try a typed code against the recovery slot. Resolves with the journal key,
 * or null when the code is wrong.
 */
export async function openRecoverySlot(
  slot: DBJournalKeySlot,
  typed: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const normalized = normalizeRecoveryCode(typed);
  if (!normalized) return null;
  try {
    const slotKey = await deriveSlotKey(await codeSecret(normalized, fromBase64Url(slot.salt)), 'recovery');
    return await unwrapJournalKey(slotKey, slot.id, 'recovery', slot.wrappedKey);
  } catch {
    return null;
  }
}
