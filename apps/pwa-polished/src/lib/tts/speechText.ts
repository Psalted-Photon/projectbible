/**
 * Pack HTML as paragraphs Read Aloud can speak — commentaries, devotionals.
 *
 * Works from the raw stored text, not the linkified copy on screen: the app's
 * own reference spans are display only. Footnotes are dropped, the way verse
 * footnotes are dropped from scripture, and every block element starts a new
 * paragraph so back and forward step by what the eye sees as one.
 */
import type { CommentaryEntry } from '../../adapters/CommentaryStore';
import { resolveBook } from '../bibleRefs';

/** Elements whose start or end is a paragraph break. */
const BLOCKS = new Set([
  'p', 'div', 'blockquote', 'li', 'item', 'list', 'ul', 'ol', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'table', 'tr', 'row', 'title', 'section', 'article', 'dt',
  'dd', 'figure', 'hr',
]);

/** Elements that are never read: footnotes and anything that is not text. */
const SILENT = new Set(['note', 'script', 'style', 'sup', 'svg', 'img', 'figure', 'template']);

/** Paragraph break marker inside the flattened text; never in pack text. */
const BREAK = String.fromCharCode(0x2029);

export function htmlToSpeechParagraphs(html: string | null | undefined): string[] {
  if (!html) return [];
  // Bullinger's references: "<FU>#Joh 3:16|<Fu>" shows as "#Joh 3:16|", and
  // is said with the book's full name.
  const source = html.replace(
    /#([1-3]?\s?[A-Za-z]{2,}\.?) (\d+:\d+[^|<>#]{0,30})\|/g,
    (_, book: string, rest: string) => `${resolveBook(book) ?? book} ${rest}`,
  );
  // DOMParser builds an inert document: nothing runs and nothing loads.
  const body = new DOMParser().parseFromString(source, 'text/html').body;
  if (!body) return [];

  for (const el of Array.from(body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (SILENT.has(tag)) {
      el.remove();
    } else if (tag === 'br' || tag === 'lb') {
      el.replaceWith(BREAK);
    } else if (tag === 'td' || tag === 'th' || tag === 'cell') {
      el.after(' ');
    } else if (BLOCKS.has(tag)) {
      // OSIS writes its paragraphs as empty start and end markers
      // (<div sID/> … <div eID/>), so both edges have to break.
      el.before(BREAK);
      el.after(BREAK);
    }
  }

  return (body.textContent ?? '')
    .split(BREAK)
    .map(tidy)
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
}

/** What the pack builders left behind when they took references out. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*[;,.\s]*\)/g, '')
    .replace(/(?:\s*[;,]){2,}/g, ';')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:]+/, '')
    .trim();
}

/** "Verse 16", "Verses 16 to 18", or the chapter's own commentary. */
function verseLabel(entry: CommentaryEntry): string {
  if (entry.verseStart === 0) return 'Chapter commentary';
  if (entry.verseEnd && entry.verseEnd !== entry.verseStart) {
    return `Verses ${entry.verseStart} to ${entry.verseEnd}`;
  }
  return `Verse ${entry.verseStart}`;
}

/**
 * Commentary entries as paragraphs, in the order given.
 *
 * Each entry is announced before its body: the verse when it changes, and the
 * commentator when it changes. A commentator's work title is said only the
 * first time they are heard, since every entry carries the same one.
 */
export function commentaryParagraphs(
  entries: CommentaryEntry[],
  opts: { verses?: boolean } = {},
): string[] {
  const out: string[] = [];
  const titled = new Set<string>();
  let lastVerse = '';
  let lastAuthor = '';
  for (const entry of entries) {
    const body = htmlToSpeechParagraphs(entry.text);
    if (body.length === 0) continue;

    const parts: string[] = [];
    const verse = verseLabel(entry);
    if (opts.verses !== false && verse !== lastVerse) parts.push(verse);
    if (entry.author !== lastAuthor) {
      const title = entry.title?.trim();
      parts.push(
        title && !entry.author.includes(title) && !titled.has(entry.author)
          ? `${entry.author}, ${title}`
          : entry.author,
      );
      titled.add(entry.author);
    }
    lastVerse = verse;
    lastAuthor = entry.author;

    if (parts.length) out.push(parts.join('. ') + '.');
    out.push(...body);
  }
  return out;
}
