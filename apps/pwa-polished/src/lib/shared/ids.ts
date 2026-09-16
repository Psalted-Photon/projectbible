/**
 * Ids for rows more than one account writes.
 *
 * The single-user tables use db.ts's generateId() — the clock in milliseconds
 * plus a short random tail. Inside one account that is fine: one device is
 * making the row, and the clock alone nearly settles it. A shared notebook is
 * a different situation. Two people on two devices insert into the same table,
 * with clocks that disagree, and an id that collides there does not lose a
 * draft — it overwrites somebody else's page. So shared rows get a real UUID,
 * where a collision is not something that happens.
 *
 * Every id on a shared row is made here: notebooks, member rows and pages.
 */

/**
 * A v4 UUID.
 *
 * crypto.randomUUID() needs a secure context. The app is served over HTTPS and
 * runs as an installed PWA, so it is always there in practice — but a plain
 * http:// dev server on a phone over the LAN is not a secure context, and
 * falling over there would be a silly way to lose an afternoon. The fallback
 * builds the same shape out of crypto.getRandomValues(), which has no such
 * requirement, and is only ever reached in that case.
 */
export function sharedId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * A short id for one paragraph inside a page, used by the pill gutter to tell
 * which line is which between one save and the next.
 *
 * Deliberately not a UUID: there is one of these per paragraph and they are
 * written into the page's own HTML, so a page of 200 paragraphs would carry
 * 7 KB of ids alone. They only have to be unique within a single page, where
 * 11 random characters is far more room than that needs.
 */
export function paragraphId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(36).padStart(2, '0');
  return out.slice(0, 11);
}
