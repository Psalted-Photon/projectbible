/**
 * eastonRefFixes — where eastonRefs' own rules pick the wrong book.
 *
 * Each line is a person id (or several, when people share one Easton entry),
 * the words as they appear in the bio, and the right book — or null to leave
 * the words plain. Every reference inside those words goes to that book, so
 * the words must take in the whole reference: "(6:9-15)", not "(6:9".
 * Quote more of the sentence when the reference alone could turn up twice.
 *
 * A bare number like "(42)" is read as a chapter of that book. Give `chapter`
 * to make it a verse of that chapter instead.
 *
 * Once a fix places a reference, the references after it follow on from that
 * book, so one fix often mends the rest of a paragraph too.
 *
 * After adding a line, run `npx tsx scripts/check-people-refs.ts` to see it
 * take, then push live. The People pack itself never changes.
 */

import type { BioFix } from './eastonRefs';

export const EASTON_REF_FIXES: BioFix[] = [
  // Jacob adopting Ephraim and Manasseh, after a Numbers link.
  { person: ['manasseh_1928', 'manasseh_1930'], text: '(48:1)', book: 'Genesis' },
  // The crowning of Joshua the high priest is Zechariah's vision, not the book of Joshua.
  { person: 'zechariah_3016', text: 'crowning of Joshua (6:9-15)', book: 'Zechariah' },
  // The two halves of Zechariah's own book, after an Ezra link.
  { person: 'zechariah_3016', text: 'chapters 1 to 8', book: 'Zechariah' },
  // Easton's typo for "Judg."
  { person: 'benjamin_463', text: 'Judge. 20:6', book: 'Judges' },
  // Haggai quoted after Ezra links.
  { person: 'haggai_1349', text: '(2:4)', book: 'Haggai' },
  // "Ezekiel speaks" — the book's name isn't right before the bracket.
  { person: 'cush_962', text: 'Ezekiel speaks (29:10', book: 'Ezekiel' },
  // Chapters of Genesis, written as bare numbers.
  { person: 'israel_682', text: 'the Syrian (28)', book: 'Genesis' },
  { person: 'israel_682', text: 'met with Rachel (29)', book: 'Genesis' },
  { person: 'israel_682', text: 'buy corn (42)', book: 'Genesis' },
  { person: 'joseph_1710', text: 'the state prison (39; 40)', book: 'Genesis' },
  // Jeremiah 44, the address to the Jews in Egypt.
  { person: 'jeremiah_853', text: 'so long revolted (44)', book: 'Jeremiah' },
  // Moses blessing the tribes is Deuteronomy 33, not verse 33.
  { person: 'moses_2108', text: 'blessing the tribes (33)', book: 'Deuteronomy' },
  // Kish carried away with Jeconiah, Esther 2:6.
  { person: 'mordecai_2107', text: '(ver. 6)', book: 'Esther', chapter: 2 },
  // "Matt," with a comma, after a Numbers link.
  { person: 'nahshon_2144', text: 'Matt, 1:4', book: 'Matthew' },
  // "Simon, son of Jonas, lovest thou me" — John 21, not Luke 21.
  { person: 'peter_2745', text: 'comp. 21:15-17', book: 'John' },
  // 1 Chronicles with its number dropped.
  { person: 'shuah_2727', text: 'Chr. 1:32', book: '1 Chronicles' },
  // Numbered entries of Easton's own ("the same as Lud (2)"), not verses.
  { person: 'caleb_537', text: 'identical with (2)', book: null },
  { person: 'jeduthun_1224', text: 'same also as (1)', book: null },
  { person: 'ludim_1835', text: 'same as Lud (2)', book: null },
];
