/**
 * Shared USFM scanner.
 *
 * Lifted verbatim from the BSB pack builder, which was the only parser in the
 * tree that read poetry and paragraph structure properly. Every English
 * translation now goes through it, so a source's structure survives the trip
 * into a pack instead of being flattened.
 *
 * Behaviour is BSB's by default, byte for byte -- see the options below for
 * the two places other sources need to differ.
 */

/**
 * Storage sentinels. The poetry markers are deliberately NOT \x0B/\x0C, which
 * JavaScript treats as whitespace and would silently eat in trim()/\s. See
 * docs/FEATURES-REFERENCE.md.
 */
export const STANZA = '\x10';   // stanza break (verse-initial only)
export const LINE_1 = '\x11';   // new poetic line
export const LINE_2 = '\x12';   // new poetic line, indented

/**
 * Note sentinels.
 *
 * A note is a " + …" run closed by one of three terminators, and which one it
 * is says what kind of note it is. The sources have always drawn the
 * distinction — \f is a footnote, \x a cross-reference, \r a list of parallel
 * passages — and flattening all three into \x01 left the reader guessing the
 * kind back out of the prose, which it got wrong.
 *
 * \x01 stays the footnote terminator so packs built before this still read
 * correctly: nothing they contain means anything new, and a note with no
 * ANCHOR_SEP has its anchor parsed out of the body the old way.
 */
export const NOTE_END = '\x01';      // ends a footnote (\f)
export const XREF_END = '\x14';      // ends a cross-reference (\x)
export const PARALLEL_END = '\x15';  // ends a parallel-passage list (\r)

/** Splits a note's own anchor ("1:3") from its body, so it need not be guessed. */
export const ANCHOR_SEP = '\x16';

/**
 * A reference the source tagged with a machine-readable target, stored as
 * REF_OPEN + osis + REF_SEP + display text + REF_CLOSE. USFX writes these as
 * <ref tgt="EXO.30.12">, USJ as {"type":"ref","loc":"EXO 30:12"} — the target is
 * the source's own answer to "where does this point", and it beats re-deriving
 * one from the prose.
 */
export const REF_OPEN = '\x17';
export const REF_SEP = '\x18';
export const REF_CLOSE = '\x19';

/**
 * Italics inside a note: the alternate wording a printed Bible sets in
 * italics (\fqa). Verse-level italics are stored as literal <i> tags, but a
 * note cannot use those -- the reader strips tags out of the verse before it
 * reads notes, and its <b>/<i> span scanner measures offsets across the whole
 * verse, so a tag inside a note would be eaten by the first and miscounted by
 * the second. A sentinel is invisible to both.
 */
export const NOTE_I_OPEN = '\x1A';
export const NOTE_I_CLOSE = '\x1B';

/** Every terminator, for scanning to the end of a note of unknown kind. */
export const NOTE_ENDERS = NOTE_END + XREF_END + PARALLEL_END;

const POETRY_LEVEL = {
  q: LINE_1, q1: LINE_1, pi: LINE_1, pi1: LINE_1,
  q2: LINE_2, q3: LINE_2, q4: LINE_2, qr: LINE_2, qm: LINE_2, pi2: LINE_2
};

/** Line-level markers whose text continues the verse as ordinary prose. */
const PROSE_MARKERS = ['p', 'm', 'mi', 'nb', 'pmo', 'pm', 'pc', 'cls', 'ph1', 'li', 'li1', 'li2', 'li3'];

/**
 * Markers this builder has always separated with an unconditional space. Source
 * lines usually end in a space already, so that produces a double space —
 * invisible in HTML, and every shipped pack has them. Collapsing them now would
 * shift saved highlight offsets in ~7,700 poetic verses, so the existing byte
 * layout is preserved exactly. Markers outside this set are new here (their text
 * used to be glued onto the previous word) and get a space only when one is
 * actually missing.
 */
const LEGACY_SPACED_MARKERS = new Set(['p', 'm', 'q', 'q1', 'q2', 'q3', 'qm', 'qr', 'pmo', 'pm', 'pi', 'pi1', 'pi2']);

/**
 * Character markers whose content is kept but whose wrapper is dropped. \w is
 * NET's word-level Strong's tagging (645,619 of them) written as
 * `\w word|strong="H1234"\w*`; the tag is metadata the pack already holds in
 * its own tables, so only the word survives.
 */
const PLAIN_CHAR_MARKERS = new Set(['w', 'add', 'em']);

/**
 * Per-source differences. Everything not listed here is BSB's behaviour, which
 * has to stay byte-identical because saved highlight offsets point into it.
 *
 * paragraphFromProseMarker — a bare \p (or \m, \pmo …) opens a new paragraph.
 *   True for every source but BSB. BSB's USFM writes an explicit \b before
 *   nearly every paragraph, so it reads its breaks from that; turning this on
 *   for BSB would add ~925 markers, almost all directly after a section
 *   heading that already separates the text, and would change its bytes.
 *
 * legacySpacedMarkers — BSB's preserved double-space layout. Other sources
 *   have no shipped bytes to protect, so they get a space only where one is
 *   actually missing.
 *
 * boldMarkers / italicMarkers — character markers stored as <b>/<i>, matching
 *   how the reader already renders them.
 */
export function parseUSFM(content, options = {}) {
  const {
    paragraphFromProseMarker = false,
    legacySpacedMarkers = LEGACY_SPACED_MARKERS,
    italicMarkers = new Set(['it']),
    boldMarkers = new Set(),
    // Whitespace is skipped after every marker, which is right for a line
    // marker -- the space separates it from its text -- but wrong after a
    // character marker's closing form, where the space is the gap between two
    // words. A source written with word-level tagging is almost nothing but
    // closing markers, so without this its text arrives with every word run
    // together. BSB has two character markers in the whole Bible and a byte
    // layout to preserve, so it leaves this off.
    preserveSpaceAfterCharClose = false,
    // Markers printed in small caps -- \nd, the divine name. There is no small
    // caps in the stored text, and every shipped pack spells it LORD, so the
    // enclosed text is upper-cased instead. It wraps a nested \+w in NET, so
    // this has to be a state the enclosed text is written through rather than
    // a span of raw text to grab.
    smallCapsMarkers = new Set(),
  } = options;
  let smallCaps = 0;
  const verses = [];
  let currentChapter = 0;
  let currentVerse = null;
  let verseText = '';
  let pendingHeading = '';
  let pendingCrossRef = '';
  // Structure that appears before the verse it belongs to
  let pendingPoetry = '';
  let pendingStanza = false;
  let pendingTitle = '';

  // Process content character by character to handle inline markers
  let i = 0;
  while (i < content.length) {
    // Look for backslash markers
    if (content[i] === '\\') {
      const markerStart = i;
      i++;

      // A character marker nested inside another is written with a leading
      // plus -- \+w inside \d, say. The plus is USFM's nesting notation, not
      // part of the name. NET writes 13,240 of them; BSB writes none.
      if (content[i] === '+') i++;

      // Extract marker name
      let marker = '';
      while (i < content.length && /[a-z0-9]/.test(content[i])) {
        marker += content[i];
        i++;
      }

      // Closing form of a character marker, e.g. \it*
      let closingMarker = false;
      if (content[i] === '*') {
        closingMarker = true;
        i++;
      }

      // Skip whitespace after marker
      let skippedSpace = false;
      while (i < content.length && content[i] === ' ') {
        skippedSpace = true;
        i++;
      }

      // Chapter marker
      if (marker === 'c') {
        // Save previous verse
        if (currentVerse !== null && verseText.trim()) {
          verses.push({
            chapter: currentChapter,
            verse: currentVerse,
            text: verseText.trim()
          });
          verseText = '';
        }
        
        // Read chapter number
        let chNum = '';
        while (i < content.length && /\d/.test(content[i])) {
          chNum += content[i];
          i++;
        }
        currentChapter = parseInt(chNum);
        currentVerse = null;
        pendingHeading = '';
        pendingCrossRef = '';
        pendingPoetry = '';
        pendingStanza = false;
        pendingTitle = '';
        
        // Skip to end of line
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }
      
      // Section headings
      if (marker === 's1' || marker === 's2') {
        const lineEnd = content.indexOf('\n', i);
        if (lineEnd > i) {
          pendingHeading = content.substring(i, lineEnd).trim();
          i = lineEnd;
        }
        continue;
      }
      
      // Cross-reference marker (parallel passages)
      if (marker === 'r') {
        const lineEnd = content.indexOf('\n', i);
        if (lineEnd > i) {
          const ref = content.substring(i, lineEnd).trim();
          // Remove parentheses if present
          pendingCrossRef = ref.replace(/^\(|\)$/g, '').trim();
          i = lineEnd;
        }
        continue;
      }
      
      // Verse marker
      if (marker === 'v') {
        // Save previous verse
        if (currentVerse !== null && verseText.trim()) {
          verses.push({
            chapter: currentChapter,
            verse: currentVerse,
            text: verseText.trim(),
            heading: null // Heading goes with the verse it precedes
          });
        }
        
        // Read verse number. A verse may be published as a range -- \v 1-2 --
        // where one block of text covers both; it is stored under the first
        // number, and the rest of the token is dropped rather than left to
        // land at the head of the text as a stray "-2". LXX has 49; BSB and
        // NET have none.
        let vNum = '';
        while (i < content.length && /\d/.test(content[i])) {
          vNum += content[i];
          i++;
        }
        while (i < content.length && /[-–\d]/.test(content[i])) i++;
        currentVerse = parseInt(vNum);
        verseText = '';
        
        // Skip whitespace
        while (i < content.length && content[i] === ' ') i++;
        
        // Store heading separately (will be attached to this verse)
        const headingForVerse = pendingHeading;
        pendingHeading = '';

        // We'll attach the heading when saving the verse
        // Mark this verse as having a heading
        if (headingForVerse) {
          // Store temporarily - we'll add it when verse completes
          verseText = `__HEADING__${headingForVerse}__HEADING_END__`;
        }

        // Structure that arrived ahead of this verse: stanza gap, the poetic
        // line it opens, and any psalm superscription. The heading token stays
        // first so processVerses() can still strip it off the front.
        verseText += (pendingStanza ? STANZA : '') + pendingPoetry;
        if (pendingTitle) verseText += `${pendingTitle} `;
        pendingStanza = false;
        pendingPoetry = '';
        pendingTitle = '';

        continue;
      }
      
      // Note markers: \f + \fr ref \ft text \f* is a footnote, and \x + \xo ref
      // \xt target \x* a cross-reference. They are different things and are now
      // stored as different things -- the terminator says which. LXX carries
      // 298 cross-references that were lost while only \f was recognised; BSB
      // has none, NET has none.
      if (marker === 'f' || marker === 'x') {
        const endMarker = '\\' + marker + '*';
        const noteEnd = marker === 'x' ? XREF_END : NOTE_END;
        // Skip the + sign
        if (content[i] === '+') i++;
        while (i < content.length && content[i] === ' ') i++;

        // A note's own verse reference (\fr, \xo) is not part of what the note
        // says, so it is kept beside the body rather than glued to the front of
        // it where the reader had to guess it back off with a regex.
        let anchorText = '';
        let footnoteText = '';
        let field = 'body';
        let italic = false;
        let inFootnote = true;
        let trailingNoteSpace = false;

        const closeItalic = () => {
          if (italic) { footnoteText += NOTE_I_CLOSE; italic = false; }
        };

        while (i < content.length && inFootnote) {
          if (content[i] === '\\') {
            // Check for the closing marker
            if (content.substring(i, i + 3) === endMarker) {
              i += 3;
              closeItalic();
              // A note must not be glued to the word after it: the stored text
              // is what search and previews read. Where the source already has
              // a space the main loop appends it; where it does not, one is
              // added here.
              if (preserveSpaceAfterCharClose && content[i] && !/[\s,.;:!?)]/.test(content[i])) {
                trailingNoteSpace = true;
              }
              inFootnote = false;
              break;
            }
            // Any other marker inside the note is structure, not words, and a
            // note can nest character markers (\+add ...\+add*). Skip the
            // marker itself and keep what it wraps -- but only collapse the
            // space after an opening marker, since the space after a closing
            // one is the gap between two words.
            let j = i + 1;
            if (content[j] === '+') j++;
            let inner = '';
            while (j < content.length && /[a-z0-9]/.test(content[j])) inner += content[j++];
            if (inner) {
              const innerClosing = content[j] === '*';
              if (innerClosing) j++;
              i = j;
              if (!innerClosing) while (i < content.length && content[i] === ' ') i++;
              // \fr and \xo carry the anchor; every other marker sends the text
              // back to the body. \fqa is the alternate wording a translation
              // prints in italics, and like the rest of these it is written
              // unclosed: it runs until the next marker.
              if (!innerClosing) {
                closeItalic();
                field = inner === 'fr' || inner === 'xo' ? 'anchor' : 'body';
                if (inner === 'fqa') { footnoteText += NOTE_I_OPEN; italic = true; }
              }
              continue;
            }
          }
          if (field === 'anchor') anchorText += content[i];
          else footnoteText += content[i];
          i++;
        }

        const anchor = anchorText.trim();
        const body = footnoteText.trim();
        // An anchor with nothing after it is a note the source left empty --
        // five of them in LXX. It is stored anyway, because whether a note was
        // there is the source's statement to make, not this parser's; the
        // reader is what decides there is nothing worth showing.
        if (anchor || body) {
          verseText += ` + ${anchor ? anchor + ANCHOR_SEP : ''}${body}${noteEnd}`;
          if (trailingNoteSpace) verseText += ' ';
        }
        continue;
      }
      
      // Stanza break — belongs to the verse that follows it
      if (marker === 'b') {
        pendingStanza = true;
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }

      // Psalm superscription ("A Psalm of David") — printed as an italic title
      // above verse 1, and the pack has nowhere else to put it, so it leads
      // that verse rather than being dropped.
      if (marker === 'd') {
        // A bare "\d" (Zechariah 12) puts the newline right at i, so guard the
        // not-found case explicitly — treating it as "no newline" would swallow
        // the rest of the file as the title.
        const lineEnd = content.indexOf('\n', i);
        const end = lineEnd === -1 ? content.length : lineEnd;
        const title = content.substring(i, end).trim();
        if (title) pendingTitle = `<i>${cleanUSFMMarkup(title)}</i>`;
        i = end;
        continue;
      }

      // Acrostic stanza labels (ALEPH, BETH…) belong above the verse, not welded
      // to the end of the previous one. They ship in the headings pack instead.
      if (marker === 'qa') {
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }

      // Skip structural markers that carry no verse text
      if (['id', 'h', 'toc1', 'toc2', 'toc3', 'mt1', 'mt2', 'mt3', 'ms', 'ms1', 'mr', 'sp', 'rem'].includes(marker)) {
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }

      // Italic character marker (supplied/emphasised wording), stored the way
      // NET stores it so the existing <i> renderer picks it up.
      const reopenSpace =
        preserveSpaceAfterCharClose && closingMarker && skippedSpace ? ' ' : '';

      if (smallCapsMarkers.has(marker)) {
        if (currentVerse === null) continue;
        if (closingMarker) {
          smallCaps = Math.max(0, smallCaps - 1);
          verseText += reopenSpace;
        } else {
          smallCaps++;
        }
        continue;
      }

      if (italicMarkers.has(marker)) {
        if (currentVerse !== null) verseText += (closingMarker ? '</i>' : '<i>') + reopenSpace;
        continue;
      }

      if (boldMarkers.has(marker)) {
        if (currentVerse !== null) verseText += (closingMarker ? '</b>' : '<b>') + reopenSpace;
        continue;
      }

      // Kept for their content, not their wrapper. \w carries a Strong's tag
      // after a pipe -- "word|strong=..." -- which is dropped with it.
      if (PLAIN_CHAR_MARKERS.has(marker)) {
        if (currentVerse === null) continue;
        if (closingMarker) {
          verseText += reopenSpace;
          continue;
        }
        const next = content.indexOf('\\', i);
        const stop = next === -1 ? content.length : next;
        const inner = content.slice(i, stop);
        const pipe = inner.indexOf('|');
        const word = pipe === -1 ? inner : inner.slice(0, pipe);
        verseText += smallCaps > 0 ? word.toUpperCase() : word;
        i = stop;
        continue;
      }

      // Poetry and paragraph continuation markers. The rest of the line may hold
      // verse text; a bare marker instead opens the line the next verse starts.
      const poetry = POETRY_LEVEL[marker];
      if (poetry || PROSE_MARKERS.includes(marker)) {
        let k = i;
        while (k < content.length && content[k] !== '\n' && /\s/.test(content[k])) k++;
        const bareLine = k >= content.length || content[k] === '\n';

        if (bareLine) {
          if (poetry) pendingPoetry = poetry;
          // A bare prose marker opens a paragraph. BSB reads its paragraphs
          // from the \b that precedes nearly every one of them, so it leaves
          // this off to keep its shipped bytes; every other source has only
          // the marker to go on.
          else if (paragraphFromProseMarker) pendingStanza = true;
          continue;
        }
        // The separating space is kept beside the marker: strip the markers and
        // the text is byte-for-byte what this builder produced before.
        if (currentVerse !== null && verseText.trim().length > 0) {
          if (legacySpacedMarkers.has(marker) || !/\s$/.test(verseText)) {
            verseText += ' ';
          }
          if (poetry) verseText += poetry;
        }
        continue;
      }

      // Unknown marker - skip it
      continue;
    }
    
    // Regular text - add to current verse if we have one.
    // The sources are CRLF; a bare \r is a line terminator, not verse text, and
    // leaving it in makes "does this already end in whitespace?" answer wrongly.
    if (currentVerse !== null && content[i] !== '\n' && content[i] !== '\r') {
      // A possessive stays lowercase inside small caps: the divine name is
      // printed LORD's, not LORD'S, and the ’s sits inside the \nd span.
      const afterApostrophe = verseText.endsWith('’') || verseText.endsWith("'");
      verseText +=
        smallCaps > 0 && !afterApostrophe ? content[i].toUpperCase() : content[i];
    }
    
    // A \r line lists the passages parallel to this section. It belongs to
    // the section's first verse, and is a third kind of note -- neither a
    // footnote nor a \x cross-reference.
    if (content[i] === '\n' && currentVerse !== null && pendingCrossRef && verseText.trim()) {
      verseText += ` + ${pendingCrossRef}${PARALLEL_END}`;
      pendingCrossRef = '';
    }
    
    i++;
  }
  
  // Save final verse
  if (currentVerse !== null && verseText.trim()) {
    // Extract heading if present
    let heading = null;
    let finalText = verseText.trim();
    const headingMatch = finalText.match(/^__HEADING__(.+?)__HEADING_END__/);
    if (headingMatch) {
      heading = headingMatch[1];
      finalText = finalText.replace(/^__HEADING__.+?__HEADING_END__/, '').trim();
    }
    verses.push({
      chapter: currentChapter,
      verse: currentVerse,
      text: finalText,
      heading: heading
    });
  }
  
  return verses;
}

/**
 * Post-process verses to extract headings properly
 */
export function processVerses(verses) {
  return verses.map(v => {
    let heading = v.heading;
    let text = v.text;
    
    // Extract heading if embedded in text
    const headingMatch = text.match(/^__HEADING__(.+?)__HEADING_END__/);
    if (headingMatch) {
      heading = headingMatch[1];
      text = text.replace(/^__HEADING__.+?__HEADING_END__/, '').trim();
    }
    
    return {
      chapter: v.chapter,
      verse: v.verse,
      text: text,
      heading: heading
    };
  });
}

/**
 * Clean USFM markup from text
 */
export function cleanUSFMMarkup(text) {
  // Remove common USFM markers but keep inline notes (our + prefix)
  return text
    .replace(/\\f \+.*?\\f\*/g, '') // Remove footnotes
    .replace(/\\x \+.*?\\x\*/g, '') // Remove cross-refs in \\x format
    .replace(/\\+[a-z]{1,3}\s/g, '') // Remove other markers
    .replace(/\\+[a-z]{1,3}\*/g, '')
    .replace(/â€"/g, '—') // Fix em-dash encoding
    .replace(/â€"/g, '–') // Fix en-dash encoding
    .replace(/â€œ/g, '"') // Fix left quote
    .replace(/â€\u009d/g, '"') // Fix right quote
    .trim();
}
