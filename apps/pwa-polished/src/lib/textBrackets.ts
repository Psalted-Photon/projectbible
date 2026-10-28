/**
 * What a tapped NET bracket means, for the reader's footnote card.
 *
 * NET brackets four different things, told apart by the bracket and the words
 * it encloses: a long passage its translators believe was added later ([[ ]]:
 * Mark 16:9-20, John 7:53-8:11), words they think may not be original
 * (John 9:38-39), a number missing from the Hebrew (1 Samuel 13:1), and a note
 * of their own (Daniel 2:4's "[What follows is in Aramaic]").
 */

const NUMBER_WORD =
  /^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)$/i;

/** True when every word enclosed is part of a number ("thirty", "forty-two"). */
function isNumber(enclosed: string): boolean {
  const words = enclosed.trim().split(/[\s-]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => NUMBER_WORD.test(w));
}

/**
 * `bracket` is the tapped mark ("[", "]", "[[" or "]]"); `enclosed` is the text
 * between it and its partner, or null when the partner is not on the page.
 */
export function netBracketNote(bracket: string, enclosed: string | null): { label: string; body: string } {
  if (bracket.length === 2) {
    return {
      label: 'Double brackets',
      body: 'Double brackets mark a passage the translators believe was added later. ' +
        'The oldest manuscripts don’t have it, but most later copies do, so it’s kept.',
    };
  }
  if (enclosed && /aramaic/i.test(enclosed)) {
    return {
      label: 'Translators’ note',
      body: 'These words are a note from the translators, not part of the Bible text. ' +
        'They mark where the original switches from Hebrew to Aramaic.',
    };
  }
  if (enclosed && isNumber(enclosed)) {
    return {
      label: 'Brackets',
      body: 'The number in brackets is missing or unclear in the Hebrew, so the translators filled it in.',
    };
  }
  return {
    label: 'Brackets',
    body: 'Brackets mark words the translators think may not be original. ' +
      'Some of the oldest manuscripts leave them out, but most copies have them, so they’re kept.',
  };
}
