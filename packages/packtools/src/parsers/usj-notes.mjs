/**
 * BSB note enrichment from the USJ edition.
 *
 * BSB is published twice: as USFM, which this repo builds from, and as USJ,
 * the same text expressed as typed JSON. The USFM edition is plain -- its
 * footnotes are a run of text and nothing more. The USJ edition marks up what
 * that run is made of: which words are the alternate wording a printed BSB sets
 * in italics (\fqa, 5,298 of them), and which are references, each carrying the
 * target the publisher resolved it to (1,242 of them). That markup is the whole
 * difference between a footnote reference you can tap and one you cannot.
 *
 * Only the markup is taken, never the text. The USJ edition carries small
 * defects the USFM edition does not -- three stray "vvv" tokens in verse text,
 * and notes where a space went missing ("Alamothis probably a musical term") --
 * and it spells some references differently ("Psalm 94:11" for "Psalms 94:11").
 * So a USJ note is grafted on only where its text, markup stripped back off, is
 * character-for-character what the USFM note already said. That holds for 4,589
 * of 4,853 notes; the rest keep the USFM wording and are linked by detection
 * the way commentary references are.
 */

import fs from 'fs';
import path from 'path';
import {
  ANCHOR_SEP, REF_OPEN, REF_SEP, REF_CLOSE,
  NOTE_END, XREF_END, PARALLEL_END,
  NOTE_I_OPEN, NOTE_I_CLOSE,
} from './usfm-scanner.mjs';

/** USJ file name (MAT.usj) to the code the USFM file names use. */
export function usjCodeFor(usfmFileName) {
  const m = /^\d+([A-Z0-9]{3})BSB/.exec(usfmFileName);
  return m ? m[1] : null;
}

/**
 * "1CH 2:9-10" as USJ writes it, to the dotted OSIS form parseOsisRef reads.
 * A range keeps its tail; the reader takes the first reference out of it.
 */
function toOsis(loc) {
  return String(loc || '').trim().replace(/\s+/g, '.').replace(/:/g, '.');
}

/** Collect a node's text, with fqa and ref markup applied. */
function render(node, out) {
  if (typeof node === 'string') {
    out.text += node;
    out.plain += node;
    return;
  }
  if (Array.isArray(node)) {
    for (const c of node) render(c, out);
    return;
  }
  if (!node || typeof node !== 'object') return;

  if (node.type === 'ref') {
    const osis = toOsis(node.loc);
    out.text += REF_OPEN + osis + REF_SEP;
    for (const c of node.content || []) render(c, out);
    out.text += REF_CLOSE;
    return;
  }

  const marker = node.marker || '';
  if (marker === 'fr') {
    // The note's own verse reference, kept apart from what it says.
    const anchor = { text: '', plain: '' };
    for (const c of node.content || []) render(c, anchor);
    out.anchor = (out.anchor || '') + anchor.plain;
    return;
  }

  const italic = marker === 'fqa';
  if (italic) out.text += NOTE_I_OPEN;
  for (const c of node.content || []) render(c, out);
  if (italic) out.text += NOTE_I_CLOSE;
}

/**
 * Every footnote in one USJ file, in document order.
 * Each is { anchor, plain, markup } -- `plain` is what the note says with no
 * markup at all, for matching against the USFM note; `markup` is the same text
 * with the italics and reference targets kept.
 */
export function readUsjNotes(filePath) {
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const notes = [];

  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const c of node) walk(c);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'note') {
      const acc = { text: '', plain: '', anchor: '' };
      for (const c of node.content || []) render(c, acc);
      notes.push({
        anchor: acc.anchor.trim(),
        plain: acc.plain.trim(),
        markup: acc.text.trim(),
      });
      return;
    }
    for (const c of node.content || []) walk(c);
  };

  walk(doc);
  return notes;
}

/**
 * Graft one book's USJ note markup onto the verses the USFM scanner produced.
 *
 * Notes are paired in document order, which holds for every book: the two
 * editions carry the same footnotes in the same places. A note is only replaced
 * when the USJ text matches the USFM text exactly, so a pairing that has
 * slipped cannot quietly rewrite a note into something the source never said.
 *
 * Returns { enriched, skipped } so a build can say how much landed.
 */
export function enrichNotes(verses, usjNotes) {
  let index = 0;
  let enriched = 0;
  let skipped = 0;

  // Every note run, so a parallel-passage run sitting between two footnotes
  // cannot be swallowed into one match. Only a footnote run is a candidate
  // for grafting, since the USJ list holds footnotes and nothing else.
  const enders = NOTE_END + XREF_END + PARALLEL_END;
  const run = new RegExp(' \\+ ([^' + enders + ']*)([' + enders + '])', 'g');

  for (const verse of verses) {
    verse.text = verse.text.replace(run, (whole, body, end) => {
      if (end !== NOTE_END) return whole;
      const usj = usjNotes[index++];
      if (!usj) { skipped++; return whole; }

      const sep = body.indexOf(ANCHOR_SEP);
      const anchor = sep === -1 ? '' : body.slice(0, sep);
      const said = sep === -1 ? body : body.slice(sep + 1);

      if (usj.plain !== said) { skipped++; return whole; }

      enriched++;
      return ' + ' + (anchor ? anchor + ANCHOR_SEP : '') + usj.markup + end;
    });
  }

  return { enriched, skipped };
}

/** Load every book's notes from a USJ directory, keyed by book code. */
export function readUsjDirectory(dir) {
  const byCode = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.usj')) continue;
    byCode.set(file.slice(0, -4), readUsjNotes(path.join(dir, file)));
  }
  return byCode;
}
