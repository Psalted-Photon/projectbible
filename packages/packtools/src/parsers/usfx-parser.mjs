/**
 * USFX parser.
 *
 * USFX is USFM expressed as XML, and eBible.org publishes WEB and KJV in it.
 * The markers are the same ones the USFM scanner reads, just spelled as
 * elements, so this produces the identical storage format: the same poetry and
 * paragraph sentinels, the same "+ note" runs closed by \x01, and the same
 * <b>/<i> spans.
 *
 *   <q style="q1">          a poetic line, level from the style or level attr
 *   <q level="2">           a second-level poetic line
 *   <p>                     a paragraph
 *   <c id="N"/> <v id="N"/> chapter and verse milestones, not containers
 *   <w s="H1234">word</w>   a word carrying a Strong's tag, kept for its text
 *   <f><fr>ref</fr><ft>…</ft></f>   a footnote
 *   <x><xo>ref</xo><xt>…</xt></x>   a cross-reference
 *   <s>…</s>                a section heading, returned alongside the verses
 *
 * Structure attaches the same way it does in USFM: a line marker that opens
 * before a verse milestone belongs to that verse and is stored at the head of
 * its text, while one that opens mid-verse is stored inline where it falls.
 */

import fs from 'fs';
import sax from 'sax';
import { STANZA, LINE_1, LINE_2 } from './usfm-scanner.mjs';

/** Elements whose text is dropped entirely -- titles, running heads, tables of contents. */
const SKIP_ELEMENTS = new Set([
  'id', 'ide', 'h', 'toc', 'cl', 'rem', 'sts', 'restore', 'periph',
  'fig', 'ref', 'cp', 'ca', 'va', 'vp', 'milestone',
]);

/** Paragraph styles that are titles rather than body text. */
const TITLE_STYLES = /^(mt|ms|mr|imt|is|iot|io|ip|ipi|im|iex|ie)/;

const ITALIC_ELEMENTS = new Set(['add', 'it', 'em', 'bk', 'qt', 'tl']);
const BOLD_ELEMENTS = new Set(['bd', 'bdit']);
const SMALL_CAPS_ELEMENTS = new Set(['nd', 'sc']);
const NOTE_ELEMENTS = new Set(['f', 'x']);

function poetryLevelFor(node) {
  const style = node.attributes?.style || '';
  const level = parseInt(node.attributes?.level || '', 10);
  if (level >= 2) return LINE_2;
  if (level === 1) return LINE_1;
  const m = style.match(/^q(\d)?/);
  if (!m) return LINE_1;
  return Number(m[1] || 1) >= 2 ? LINE_2 : LINE_1;
}

/**
 * Parse one USFX file.
 *
 * Returns { books: [{ code, verses: [{chapter, verse, text}], headings: [...] }] }
 * -- a USFX file holds the whole Bible, not one book per file as USFM does.
 */
export function parseUSFX(filePath) {
  const parser = sax.parser(true, { trim: false, normalize: false });
  const books = [];

  let book = null;
  let chapter = 0;
  let verse = null;
  let text = '';

  // Structure waiting for the verse it belongs to
  let pendingPoetry = '';
  let pendingStanza = false;
  let pendingHeading = null;

  let smallCaps = 0;
  let skipDepth = 0;      // inside an element whose text is dropped
  let noteDepth = 0;      // inside <f>/<x>
  let noteText = '';
  let headingDepth = 0;   // inside <s>
  let headingText = '';
  let headingLevel = 1;
  let titleDepth = 0;     // inside <d>, a psalm superscription
  let titleText = '';
  let pendingTitle = '';

  function flushVerse() {
    if (book && verse !== null && text.trim()) {
      book.verses.push({ chapter, verse, text: tidy(text) });
    }
    verse = null;
    text = '';
  }

  function tidy(s) {
    return s.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]{3,}/g, '  ').trim();
  }

  function append(chunk) {
    if (!chunk) return;
    // KJV writes its traditional paragraph mark as a literal ¶ at the head of
    // 2,970 verses, always just inside the <p> that already opens the
    // paragraph. It is the same information twice, and the marker is the half
    // the reader can lay out, so the glyph goes.
    chunk = chunk.replace(/¶\s*/g, '');
    if (!chunk) return;
    if (noteDepth > 0) noteText += chunk;
    else if (titleDepth > 0) titleText += chunk;
    else if (headingDepth > 0) headingText += chunk;
    else if (verse !== null) text += smallCaps > 0 ? chunk.toUpperCase() : chunk;
  }

  parser.onopentag = (node) => {
    const name = node.name;

    if (skipDepth > 0) { skipDepth++; return; }

    if (name === 'book') {
      flushVerse();
      book = { code: node.attributes.id, verses: [], headings: [] };
      books.push(book);
      chapter = 0;
      pendingPoetry = '';
      pendingStanza = false;
      return;
    }

    if (SKIP_ELEMENTS.has(name)) { skipDepth = 1; return; }

    if (name === 'c') {
      flushVerse();
      chapter = parseInt(node.attributes.id, 10) || 0;
      pendingPoetry = '';
      pendingStanza = false;
      return;
    }

    if (name === 'v') {
      flushVerse();
      // A verse id can be a range ("1-2"); it stores under the first number.
      verse = parseInt(String(node.attributes.id).split(/[-–]/)[0], 10);
      text = (pendingStanza ? STANZA : '') + pendingPoetry;
      if (pendingTitle) { text += `<i>${pendingTitle}</i> `; pendingTitle = ''; }
      pendingStanza = false;
      pendingPoetry = '';
      if (pendingHeading) {
        book.headings.push({ chapter, verse, heading: pendingHeading.text, level: pendingHeading.level });
        pendingHeading = null;
      }
      return;
    }

    if (name === 've') { flushVerse(); return; }

    if (name === 'q') {
      const level = poetryLevelFor(node);
      // Before a verse it opens that verse's line; inside one it breaks the
      // line where it falls. Neither adds a text character.
      if (verse === null) pendingPoetry = level;
      else text += (text.endsWith(' ') ? '' : ' ') + level;
      return;
    }

    if (name === 'p' || name === 'pi' || name === 'li' || name === 'q1' || name === 'q2') {
      const style = node.attributes?.style || '';
      if (TITLE_STYLES.test(style)) { skipDepth = 1; return; }
      // A verse runs to its <ve/>, and in USFX it may cross a paragraph
      // boundary on the way -- Numbers 7 puts a single verse across four <p>
      // elements. Only a paragraph opening before a verse starts one; inside
      // a verse it just continues the text.
      if (verse === null) pendingStanza = true;
      else if (!text.endsWith(' ')) text += ' ';
      return;
    }

    // Psalm superscription. It sits above verse 1 with nowhere else to go, so
    // it leads that verse as an italic title, exactly as the USFM scanner does.
    if (name === 'd') { headingDepth = 0; titleDepth = 1; titleText = ''; return; }

    if (name === 'b') {
      if (verse === null) pendingStanza = true;
      return;
    }

    if (name === 's') {
      headingDepth = 1;
      headingText = '';
      headingLevel = parseInt(node.attributes?.level || '1', 10) || 1;
      return;
    }

    if (NOTE_ELEMENTS.has(name)) { noteDepth = 1; noteText = ''; return; }
    if (noteDepth > 0) { noteDepth++; return; }

    if (SMALL_CAPS_ELEMENTS.has(name)) { smallCaps++; return; }
    if (ITALIC_ELEMENTS.has(name)) { append('<i>'); return; }
    if (BOLD_ELEMENTS.has(name)) { append('<b>'); return; }
    // <w> and anything else unrecognised: keep the text, drop the wrapper.
  };

  parser.onclosetag = (name) => {
    if (skipDepth > 0) { skipDepth--; return; }

    if (name === 'd' && titleDepth > 0) {
      titleDepth = 0;
      pendingTitle = titleText.replace(/\s+/g, ' ').trim();
      return;
    }

    if (name === 's' && headingDepth > 0) {
      headingDepth = 0;
      const heading = headingText.replace(/\s+/g, ' ').trim();
      if (heading) pendingHeading = { text: heading, level: headingLevel };
      return;
    }

    if (noteDepth > 0) {
      noteDepth--;
      if (noteDepth === 0) {
        // A cross-reference whose targets are empty leaves just its own verse
        // ref and a stray semicolon; there is nothing to show, so it is
        // dropped rather than stored as "+ 5:3 ;".
        const note = noteText.replace(/\s+/g, ' ').trim().replace(/[\s;,]+$/, '');
        const hasContent = /[A-Za-z-￿]/.test(note.replace(/^\d+[:.]\d+[a-z]?/, ''));
        if (note && hasContent && verse !== null) text += ` + ${note}\x01 `;
        noteText = '';
      }
      return;
    }

    if (SMALL_CAPS_ELEMENTS.has(name)) { smallCaps = Math.max(0, smallCaps - 1); return; }
    if (ITALIC_ELEMENTS.has(name)) { append('</i>'); return; }
    if (BOLD_ELEMENTS.has(name)) { append('</b>'); return; }
    if (name === 'book') { flushVerse(); return; }
  };

  parser.ontext = (t) => { if (skipDepth === 0) append(t); };
  parser.oncdata = parser.ontext;

  parser.write(fs.readFileSync(filePath, 'utf8')).close();
  flushVerse();

  return { books };
}
