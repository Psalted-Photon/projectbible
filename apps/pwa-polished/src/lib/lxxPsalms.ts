/**
 * Masoretic → Septuagint Psalm numbering.
 *
 * The Psalter is numbered differently in the two traditions, so a reference
 * taken from an English Bible ("Psalm 104:4") does not name the same chapter in
 * lxx2012 ("Psalms 103:4"). Every OT-quote card that lands in a Psalm goes
 * through here.
 *
 * The rule below is not hand-asserted prose: scripts/build-ot-quotes-index.mjs
 * re-derives it from lxx2012's own superscriptions, which carry the Hebrew
 * number in parentheses (LXX 103:1 opens "(104)"), and fails the build if this
 * function disagrees with any of the 136 labelled chapters. If the mapping ever
 * changes, the build says so rather than the reader silently showing the wrong
 * psalm.
 *
 * Two of the divergences move verses as well as chapters, which is why this
 * returns a verse and not just a chapter number:
 *
 *   MT 9 + MT 10   are one psalm in the LXX (LXX 9, 38 verses = 20 + 18), so
 *                  MT 10:7 is LXX 9:27 — chapter-only mapping lands 20 verses
 *                  short. Romans 3:14 quotes exactly this verse.
 *   MT 147         is two psalms in the LXX (LXX 146 = vv 1-11, LXX 147 =
 *                  vv 12-20), so MT 147:20 is LXX 147:9. Amos 3:2 refers here.
 *
 * Verified against the shipped pack: BSB Ps 9 has 20 verses and Ps 10 has 18,
 * against LXX 9's 38; BSB Ps 147 has 20 against LXX 146's 11 plus LXX 147's 9;
 * and LXX 147:1 is word-for-word BSB 147:12.
 */

/** A chapter and verse in Septuagint numbering. */
export interface LxxPsalmRef {
  chapter: number;
  verse: number;
}

/** Verses in MT Psalm 9, after which LXX 9 continues into MT Psalm 10. */
const MT_PSALM_9_LENGTH = 20;

/** Verses in LXX Psalm 146, after which MT 147 continues into LXX 147. */
const LXX_PSALM_146_LENGTH = 11;

/**
 * Map a Masoretic psalm reference to its Septuagint coordinates.
 *
 * Returns null for a chapter outside 1-150 — MT has no Psalm 151, and a
 * reference claiming otherwise is bad data rather than something to guess at.
 */
export function mtToLxxPsalm(chapter: number, verse: number): LxxPsalmRef | null {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) return null;
  if (!Number.isInteger(verse) || verse < 1) return null;

  // 1-8: identical.
  if (chapter <= 8) return { chapter, verse };

  // 9 and 10: merged into LXX 9, with 10's verses running on after 9's.
  if (chapter === 9) return { chapter: 9, verse };
  if (chapter === 10) return { chapter: 9, verse: verse + MT_PSALM_9_LENGTH };

  // 11-146: LXX runs one behind.
  if (chapter <= 146) return { chapter: chapter - 1, verse };

  // 147: split, so the second half restarts its verse numbering at 1.
  if (chapter === 147) {
    return verse <= LXX_PSALM_146_LENGTH
      ? { chapter: 146, verse }
      : { chapter: 147, verse: verse - LXX_PSALM_146_LENGTH };
  }

  // 148-150: back in step.
  return { chapter, verse };
}

/**
 * Chapter-only form, for the build script's assertion against lxx2012's
 * superscription labels. Verse 1 of an MT psalm always sits in the first of the
 * LXX chapters it maps to, so this is well defined even for the split 147.
 */
export function mtToLxxPsalmChapter(chapter: number): number | null {
  return mtToLxxPsalm(chapter, 1)?.chapter ?? null;
}
