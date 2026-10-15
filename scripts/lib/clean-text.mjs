/**
 * Verse text the way the reader measures it.
 *
 * Offsets that the app lays over a verse (red-letter spans, word links) count
 * characters in its "clean" text: the stored text with <b>/<i> tags, notes and
 * poetry markers taken out. Builders that write those offsets measure them here,
 * so they land where the reader draws.
 */

/** Note terminators, matching packages/packtools/src/parsers/usfm-scanner.mjs. */
const NOTE_ENDERS = '\x01\x14\x15';

/**
 * Reduce stored text to the "clean" form the spans are measured against.
 * Must stay identical to buildCleanToStoredMap() in the PWA's verseRendering.ts,
 * or the red-letter offsets land in the wrong place.
 */
export function stripFootnotes(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // Poetic line / stanza markers are structure, not text
    if (ch === '\x10' || ch === '\x11' || ch === '\x12') { i++; continue; }
    let p = i - 1;
    while (p >= 0 && /[\x01-\x07\x0E\x0F\x10-\x12\x14-\x1B]/.test(text[p])) p--;
    const prev = p >= 0 ? text[p] : ' ';
    if (ch === '+' && (prev === ' ' || prev === '\n' || prev === '\t' || p < 0)) {
      // Any of the three note terminators: which one closes a note says
      // what kind it is, and all three end it.
      const end = NOTE_ENDERS.split('').reduce((best, ender) => {
        const at = text.indexOf(ender, i + 1);
        return at >= 0 && (best < 0 || at < best) ? at : best;
      }, -1);
      if (end >= 0) { i = end + 1; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Strip HTML tags (e.g. <b>...</b> in NET sqlite text). */
export function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '');
}

/**
 * Find a span word for word in the translation it was marked in, ignoring only
 * spacing — the span extractors and the pack builders disagree about spaces
 * around dashes and closing quotes ("heaven— the" / "heaven—the"). This is the
 * answer whenever it exists: the fuzzy strategies below are for carrying WEB's
 * spans into NET, and run on a text that has its own spans they would stretch
 * past a closing quote into narration or stop short of the last word.
 */
export function locateVerbatim(spanText, text, from) {
  const chars = [...spanText.replace(/\s+/g, '')];
  if (chars.length === 0) return null;
  const re = new RegExp(chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? { s: m.index, e: m.index + m[0].length } : null;
}

/**
 * The clean text the app's companionText() (verseRendering.ts) builds, with
 * where each of its characters sits in the stored text: tags out first, then
 * poetry markers and notes, the order the app does it in. `at[k]` is the
 * stored index of clean character k.
 */
export function cleanWithIndex(stored) {
  const work = [];
  const workAt = [];
  for (let i = 0; i < stored.length; i++) {
    if (stored[i] === '<') {
      const close = stored.indexOf('>', i);
      if (close >= 0) { i = close; continue; }
    }
    work.push(stored[i]);
    workAt.push(i);
  }
  let text = '';
  const at = [];
  let i = 0;
  while (i < work.length) {
    const ch = work[i];
    if (ch === '\x10' || ch === '\x11' || ch === '\x12') { i++; continue; }
    if (ch === '+') {
      let p = i - 1;
      while (p >= 0 && /[\x01-\x07\x0E\x0F\x10-\x12\x14-\x1C]/.test(work[p])) p--;
      if (p < 0 || work[p] === ' ' || work[p] === '\n' || work[p] === '\t') {
        let end = -1;
        for (let q = i + 1; q < work.length; q++) {
          if (NOTE_ENDERS.includes(work[q])) { end = q; break; }
        }
        if (end >= 0) { i = end + 1; continue; }
      }
    }
    text += ch;
    at.push(workAt[i]);
    i++;
  }
  return { text, at };
}
