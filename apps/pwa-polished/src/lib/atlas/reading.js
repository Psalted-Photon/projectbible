/**
 * The map reading along with you.
 *
 * The reader is usually open on a passage. This turns that passage into a view:
 * the places it names, framed on screen, with the timeline moved to the era
 * those books belong to. Open Acts 17 and Athens, Thessalonica and Berea appear.
 *
 * No new data — the same verse-to-place links that decide which lands appear in
 * each era, read the other way round.
 */

/** Spellings people type, mapped to the OSIS book codes the data uses. */
const BOOK_ALIASES = {
  genesis: 'Gen', gen: 'Gen', ge: 'Gen',
  exodus: 'Exod', exod: 'Exod', ex: 'Exod',
  leviticus: 'Lev', lev: 'Lev', numbers: 'Num', num: 'Num',
  deuteronomy: 'Deut', deut: 'Deut', dt: 'Deut',
  joshua: 'Josh', josh: 'Josh', judges: 'Judg', judg: 'Judg', jdg: 'Judg',
  ruth: 'Ruth',
  '1samuel': '1Sam', '1sam': '1Sam', '1sa': '1Sam',
  '2samuel': '2Sam', '2sam': '2Sam', '2sa': '2Sam',
  '1kings': '1Kgs', '1kgs': '1Kgs', '1ki': '1Kgs',
  '2kings': '2Kgs', '2kgs': '2Kgs', '2ki': '2Kgs',
  '1chronicles': '1Chr', '1chr': '1Chr', '2chronicles': '2Chr', '2chr': '2Chr',
  ezra: 'Ezra', nehemiah: 'Neh', neh: 'Neh', esther: 'Esth', esth: 'Esth',
  job: 'Job', psalm: 'Ps', psalms: 'Ps', ps: 'Ps',
  proverbs: 'Prov', prov: 'Prov', ecclesiastes: 'Eccl', eccl: 'Eccl',
  song: 'Song', songofsongs: 'Song', songofsolomon: 'Song',
  isaiah: 'Isa', isa: 'Isa', jeremiah: 'Jer', jer: 'Jer',
  lamentations: 'Lam', lam: 'Lam', ezekiel: 'Ezek', ezek: 'Ezek',
  daniel: 'Dan', dan: 'Dan', hosea: 'Hos', hos: 'Hos', joel: 'Joel',
  amos: 'Amos', obadiah: 'Obad', obad: 'Obad', jonah: 'Jonah',
  micah: 'Mic', mic: 'Mic', nahum: 'Nah', nah: 'Nah',
  habakkuk: 'Hab', hab: 'Hab', zephaniah: 'Zeph', zeph: 'Zeph',
  haggai: 'Hag', hag: 'Hag', zechariah: 'Zech', zech: 'Zech',
  malachi: 'Mal', mal: 'Mal',
  matthew: 'Matt', matt: 'Matt', mt: 'Matt',
  mark: 'Mark', mk: 'Mark', luke: 'Luke', lk: 'Luke',
  john: 'John', jn: 'John', acts: 'Acts',
  romans: 'Rom', rom: 'Rom',
  '1corinthians': '1Cor', '1cor': '1Cor', '2corinthians': '2Cor', '2cor': '2Cor',
  galatians: 'Gal', gal: 'Gal', ephesians: 'Eph', eph: 'Eph',
  philippians: 'Phil', phil: 'Phil', colossians: 'Col', col: 'Col',
  '1thessalonians': '1Thess', '1thess': '1Thess',
  '2thessalonians': '2Thess', '2thess': '2Thess',
  '1timothy': '1Tim', '1tim': '1Tim', '2timothy': '2Tim', '2tim': '2Tim',
  titus: 'Titus', philemon: 'Phlm', phlm: 'Phlm', hebrews: 'Heb', heb: 'Heb',
  james: 'Jas', jas: 'Jas',
  '1peter': '1Pet', '1pet': '1Pet', '2peter': '2Pet', '2pet': '2Pet',
  '1john': '1John', '2john': '2John', '3john': '3John',
  jude: 'Jude', revelation: 'Rev', rev: 'Rev',
};

/**
 * Read "Acts 17", "1 Kings 6:1" or "acts" into a book and optional chapter.
 * Returns null when nothing recognisable is there.
 */
export function parsePassage(text) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return null;

  // Split the trailing chapter (and verse) off the book name.
  const m = raw.match(/^(.*?)[\s.]*(\d+)?\s*(?::\s*\d+)?\s*$/);
  if (!m) return null;

  const namePart = (m[1] ?? '').replace(/[^a-z0-9]/g, '');
  const chapter = m[2] ? Number(m[2]) : null;
  if (!namePart) return null;

  const book = BOOK_ALIASES[namePart];
  return book ? { book, chapter } : null;
}

/**
 * Places named in a passage.
 *
 * With a chapter, only that chapter counts; without one, the whole book does —
 * which is what someone means when they type just "Acts".
 */
export function placesInPassage(places, { book, chapter }) {
  const hits = [];
  for (const p of places) {
    let count = 0;
    for (const [, osis] of p.v) {
      const [b, c] = osis.split('.');
      if (b !== book) continue;
      if (chapter != null && Number(c) !== chapter) continue;
      count++;
    }
    if (count) hits.push({ place: p, count });
  }
  return hits.sort((a, b) => b.count - a.count);
}

/**
 * Which era a book belongs to.
 *
 * Several eras can name the same book — Kings witnesses both the divided
 * kingdom and the Assyrian ascendancy — so the one that leans on it most wins,
 * measured by how small its book list is.
 */
export function eraForBook(eras, book) {
  let best = null;
  for (const era of eras) {
    let books = [];
    try {
      books = JSON.parse(era.books || '[]');
    } catch {
      books = [];
    }
    if (!books.includes(book)) continue;
    if (!best || books.length < best.size) best = { era, size: books.length };
  }
  return best?.era ?? null;
}
