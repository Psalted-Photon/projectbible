/**
 * Join codes, and the links built out of them.
 *
 * A shared notebook is found by its code and by nothing else. Only the anon key
 * ever reaches this app, and no policy grants a stranger so much as a listing,
 * so there is no way to go looking for a notebook — you either hold the code or
 * you do not. That makes the code the whole of the invitation, and makes it
 * worth typing carefully.
 *
 * The alphabet is the one migration 012 generates from: no 0, O, 1, I, L or U,
 * so a code survives being read aloud across a room, written on a whiteboard,
 * or copied off a phone screen at arm's length. It is repeated here rather than
 * imported, because the two halves are checked in different places and a code
 * this side rejects would never reach the function that made it.
 */

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;

/** The query parameter a join link carries. Read in App.svelte, written below. */
export const JOIN_PARAM = 'join';

/**
 * What the person typed, as a code.
 *
 * Case and separators are noise: someone copying a code off a screen may keep
 * the hyphen this module prints, and someone reading it aloud will not say it.
 * Both are dropped, and so is any whitespace.
 *
 * Nothing else is guessed. It is tempting to map a typed O to a 0, or an I to a
 * 1 — but the characters that get confused for each other are exactly the ones
 * the alphabet leaves out, so there is no correct letter to map them *to*.
 * Silently turning a misread character into a plausible one would produce a
 * code that is wrong in a way nobody can see. Better to hand it back as typed
 * and let isJoinCode say it is not a code.
 */
export function normalizeJoinCode(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
}

/** Eight characters, all from the alphabet. Run it on a normalised code. */
export function isJoinCode(raw: string): boolean {
  const code = normalizeJoinCode(raw);
  if (code.length !== JOIN_CODE_LENGTH) return false;
  for (const ch of code) if (!JOIN_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * How a code is shown: `ABCD-EFGH`.
 *
 * Split in the middle because eight unbroken characters are read as one long
 * word and copied out wrong. The hyphen is presentation only — normalizeJoinCode
 * takes it straight back off, so a code pasted with it in is still the same code.
 */
export function formatJoinCode(code: string): string {
  const clean = normalizeJoinCode(code);
  if (clean.length !== JOIN_CODE_LENGTH) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/**
 * The link that opens this notebook.
 *
 * Built from the page's own origin and path, exactly as buildShareUrl is and
 * for the same reason: the same build is served from more than one host, and a
 * host that serves the app from a subpath would be sent to the root by a
 * baked-in domain.
 *
 * This is also the string a QR code carries and, later, the one an NFC tag
 * holds — both of which are just a URL, so neither needs any app work of its own.
 */
export function buildJoinUrl(code: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set(JOIN_PARAM, normalizeJoinCode(code));
  return url.toString();
}
