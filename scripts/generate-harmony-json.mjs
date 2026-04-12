/**
 * Robertson-Broadus Gospel Harmony — Data Generator
 * Generates robertson-harmony.json from hardcoded section data.
 *
 * Books in plan: Matthew, Mark, Luke, John, Acts, 1 Corinthians
 * (1 Corinthians included only in §148, §177, §179, §181, §182 where Robertson
 *  uses it as a full parallel text column, not merely a footnote.)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Book name normalizer
// ---------------------------------------------------------------------------
const BOOK_ALIASES = {
  'matt': 'Matthew', 'matthew': 'Matthew', 'mt': 'Matthew',
  'mark': 'Mark', 'mk': 'Mark', 'mr': 'Mark',
  'luke': 'Luke', 'lk': 'Luke', 'lu': 'Luke',
  'john': 'John', 'jn': 'John', 'joh': 'John',
  'acts': 'Acts', 'ac': 'Acts',
  '1cor': '1 Corinthians', '1 cor': '1 Corinthians', '1corinthians': '1 Corinthians',
};

function normalizeBook(raw) {
  const key = raw.trim().toLowerCase().replace(/\.\s*/g, '').replace(/\s+/g, ' ');
  if (BOOK_ALIASES[key]) return BOOK_ALIASES[key];
  // Try prefix match
  for (const [alias, name] of Object.entries(BOOK_ALIASES)) {
    if (key.startsWith(alias)) return name;
  }
  throw new Error(`Unknown book: "${raw}"`);
}

// ---------------------------------------------------------------------------
// Passage parser  "Book ch:v-ch:v; Book ch:v-v; ..."
// Returns: Array<{label, book, startChapter, startVerse, endChapter, endVerse}>
// endVerse may be null (= end of chapter when only a chapter range given)
// ---------------------------------------------------------------------------
function parsePassages(str) {
  if (!str) return [];
  const results = [];

  // Split on semicolons, but be careful with "1 Cor" (no semicolon ambiguity there)
  const segments = str.split(';').map(s => s.trim()).filter(Boolean);

  let lastBook = null;

  for (const seg of segments) {
    // Does it start with a book name?
    // Pattern: optional "1 " prefix + word chars, then maybe space
    const bookMatch = seg.match(/^(1\s+\w+|\w+)\s+(.+)$/i);
    let bookStr, refStr;
    if (bookMatch && BOOK_ALIASES[bookMatch[1].toLowerCase().replace(/\s+/g, '')] ||
        bookMatch && Object.keys(BOOK_ALIASES).some(k => bookMatch[1].toLowerCase().startsWith(k.replace(/\s+/g,'')))) {
      bookStr = bookMatch[1];
      refStr = bookMatch[2];
      try { lastBook = normalizeBook(bookStr); } catch { /* fall through */ }
    } else if (!seg.match(/^\d+:\d+/)) {
      // Could be "Matt 3:1-6" style where the book got absorbed in the previous match
      // Try matching with looser regex capturing everything up to chapter:verse
      const m2 = seg.match(/^(.+?)\s+(\d+[:\-].*)$/);
      if (m2) {
        try {
          lastBook = normalizeBook(m2[1]);
          refStr = m2[2];
          bookStr = m2[1];
        } catch { refStr = seg; }
      } else {
        refStr = seg;
      }
    } else {
      // continuation reference: just chapter:verse, use lastBook
      refStr = seg;
    }

    if (!lastBook) continue;

    // Parse refStr: may be "ch:v-ch:v", "ch:v-v", "ch:v", "ch-ch", "ch"
    const refs = parseRefs(refStr, lastBook);
    for (const r of refs) {
      results.push(r);
    }
  }

  return results;
}

function parseRefs(refStr, book) {
  const results = [];
  // Could be comma-separated sub-ranges within same chapter
  // e.g. "26:57, 26:59-68"
  const parts = refStr.split(',').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Match: ch:v-ch:v  or  ch:v-v  or  ch:v  or  ch-ch  or  ch
    const m = part.match(/^(\d+)(?::(\d+))?(?:\s*[-–]\s*(\d+)(?::(\d+))?)?$/);
    if (!m) continue;

    const startChapter = parseInt(m[1]);
    const startVerse = m[2] ? parseInt(m[2]) : 1;
    let endChapter, endVerse;

    if (m[3] !== undefined) {
      // There's a range
      if (m[4] !== undefined) {
        // ch:v-ch:v style
        endChapter = parseInt(m[3]);
        endVerse = parseInt(m[4]);
      } else {
        // Could be ch:v-v (same chapter) or ch-ch (chapter range)
        if (m[2] !== undefined) {
          // Had startVerse, so this is ch:v-v
          endChapter = startChapter;
          endVerse = parseInt(m[3]);
        } else {
          // ch-ch range, no verse
          endChapter = parseInt(m[3]);
          endVerse = null;
        }
      }
    } else {
      endChapter = startChapter;
      endVerse = m[2] ? startVerse : null; // single verse or whole chapter
    }

    // Build label
    let label = `${bookAbbr(book)} ${startChapter}`;
    if (m[2]) label += `:${startVerse}`;
    if (m[3] !== undefined) {
      label += '-';
      if (endChapter !== startChapter) label += `${endChapter}:`;
      if (endVerse !== null) label += `${endVerse}`;
      else if (endChapter !== startChapter) label = label.replace(/-$/, ''); // ch-ch
    }

    results.push({ label, book, startChapter, startVerse: m[2] ? startVerse : 1, endChapter, endVerse });
  }

  return results;
}

function bookAbbr(book) {
  const abbrs = {
    'Matthew': 'Matt', 'Mark': 'Mark', 'Luke': 'Luke', 'John': 'John',
    'Acts': 'Acts', '1 Corinthians': '1 Cor',
  };
  return abbrs[book] || book;
}

// ---------------------------------------------------------------------------
// Expand passages to chapter refs (deduplicated)
// ---------------------------------------------------------------------------
function expandToChapterRefs(passages) {
  const seen = new Set();
  const refs = [];
  for (const p of passages) {
    for (let ch = p.startChapter; ch <= p.endChapter; ch++) {
      const key = `${p.book}::${ch}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ book: p.book, chapter: ch });
      }
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Build passage list from individual column strings
// ---------------------------------------------------------------------------
function buildSection(section, part, part_title, title, cols) {
  const passages = [];
  for (const col of cols) {
    if (!col) continue;
    const parsed = parsePassages(col);
    passages.push(...parsed);
  }
  const chapter_refs = expandToChapterRefs(passages);
  return { section, part, part_title, title, passages, chapter_refs };
}

// ---------------------------------------------------------------------------
// All 184 sections
// ---------------------------------------------------------------------------
const PART_I   = 'I';    const PT_I   = 'Introduction to the Fourfold Gospel';
const PART_II  = 'II';   const PT_II  = 'Preexistence and Incarnation of the Logos';
const PART_III = 'III';  const PT_III = 'Birth and Preparation for Public Ministry';
const PART_IV  = 'IV';   const PT_IV  = 'Birth and Childhood of Jesus';
const PART_V   = 'V';    const PT_V   = 'Public Appearance of John the Baptist';
const PART_VI  = 'VI';   const PT_VI  = 'The Baptism and Early Judean Ministry';
const PART_VII = 'VII';  const PT_VII = 'The Great Galilean Ministry';
const PART_VIII= 'VIII'; const PT_VIII= 'Special Training of the Twelve Around Galilee';
const PART_IX  = 'IX';   const PT_IX  = 'Later Judean and Perean Ministry';
const PART_X   = 'X';    const PT_X   = 'Later Perean Ministry';
const PART_XI  = 'XI';   const PT_XI  = 'The Passion Week';
const PART_XII = 'XII';  const PT_XII = 'The Last Supper and Gethsemane';
const PART_XIII= 'XIII'; const PT_XIII= 'Trial, Crucifixion, and Burial';
const PART_XIV = 'XIV';  const PT_XIV = 'Resurrection, Appearances, and Ascension';

// buildSection(sectionId, part, partTitle, sectionTitle, [col1, col2, ...])
// Columns are raw strings exactly as Robertson prints them (book + reference).
// Semicolons separate refs within the same column (same passage).

const SECTIONS = [
  // PART I
  buildSection(1, PART_I, PT_I,
    'Luke\'s Preface',
    ['Luke 1:1-4']),

  // PART II
  buildSection(2, PART_II, PT_II,
    'The Preexistent Logos',
    ['John 1:1-18']),

  // PART III
  buildSection(3, PART_III, PT_III,
    'The Genealogies of Jesus',
    ['Matt 1:1-17', 'Luke 3:23-38']),

  // PART IV
  buildSection(4, PART_IV, PT_IV,
    'The Annunciation of the Birth of John the Baptist',
    ['Luke 1:5-25']),
  buildSection(5, PART_IV, PT_IV,
    'The Annunciation of the Birth of Jesus to Mary',
    ['Luke 1:26-38']),
  buildSection(6, PART_IV, PT_IV,
    'The Visit of Mary to Elizabeth',
    ['Luke 1:39-45']),
  buildSection(7, PART_IV, PT_IV,
    'The Magnificat: Mary\'s Song of Praise',
    ['Luke 1:46-56']),
  buildSection(8, PART_IV, PT_IV,
    'The Birth, Circumcision, and Prophecy Concerning John the Baptist',
    ['Luke 1:57-80']),
  buildSection(9, PART_IV, PT_IV,
    'The Annunciation to Joseph',
    ['Matt 1:18-25']),
  buildSection(10, PART_IV, PT_IV,
    'The Birth of Jesus at Bethlehem',
    ['Luke 2:1-7']),
  buildSection(11, PART_IV, PT_IV,
    'The Adoration of the Shepherds',
    ['Luke 2:8-20']),
  buildSection(12, PART_IV, PT_IV,
    'The Circumcision of Jesus',
    ['Luke 2:21']),
  buildSection(13, PART_IV, PT_IV,
    'The Presentation in the Temple and the Prophecies of Simeon and Anna',
    ['Luke 2:22-38']),
  buildSection(14, PART_IV, PT_IV,
    'The Visit and Gifts of the Magi',
    ['Matt 2:1-12']),
  buildSection(15, PART_IV, PT_IV,
    'The Flight into Egypt and the Massacre of the Innocents',
    ['Matt 2:13-18']),
  buildSection(16, PART_IV, PT_IV,
    'The Return from Egypt and Settlement at Nazareth',
    ['Matt 2:19-23', 'Luke 2:39']),
  buildSection(17, PART_IV, PT_IV,
    'The Childhood of Jesus at Nazareth',
    ['Luke 2:40']),
  buildSection(18, PART_IV, PT_IV,
    'The Visit to Jerusalem When Jesus Was Twelve',
    ['Luke 2:41-50']),
  buildSection(19, PART_IV, PT_IV,
    'The Eighteen Years of Silence at Nazareth',
    ['Luke 2:51']),

  // PART V
  buildSection(20, PART_V, PT_V,
    'The Beginning of John\'s Ministry',
    ['Mark 1:1', 'Luke 3:1-2']),
  buildSection(21, PART_V, PT_V,
    'The Preaching of John',
    ['Mark 1:2-6', 'Matt 3:1-6', 'Luke 3:3-6']),
  buildSection(22, PART_V, PT_V,
    'John\'s Instructions to Various Classes',
    ['Matt 3:7-10', 'Luke 3:7-14']),
  buildSection(23, PART_V, PT_V,
    'John\'s Announcement of the Messiah',
    ['Mark 1:7-8', 'Matt 3:11-12', 'Luke 3:15-18']),

  // PART VI
  buildSection(24, PART_VI, PT_VI,
    'The Baptism of Jesus',
    ['Mark 1:9-11', 'Matt 3:13-17', 'Luke 3:21-23']),
  buildSection(25, PART_VI, PT_VI,
    'The Temptation of Jesus',
    ['Mark 1:12-13', 'Matt 4:1-11', 'Luke 4:1-13']),
  buildSection(26, PART_VI, PT_VI,
    'The Testimony of John the Baptist to the Deputation from Jerusalem',
    ['John 1:19-28']),
  buildSection(27, PART_VI, PT_VI,
    'John\'s Witness to Jesus as the Lamb of God',
    ['John 1:29-34']),
  buildSection(28, PART_VI, PT_VI,
    'The First Disciples of Jesus',
    ['John 1:35-51']),
  buildSection(29, PART_VI, PT_VI,
    'The First Miracle: Water Made Wine at Cana',
    ['John 2:1-11']),
  buildSection(30, PART_VI, PT_VI,
    'The Brief Visit to Capernaum',
    ['John 2:12']),
  buildSection(31, PART_VI, PT_VI,
    'The First Cleansing of the Temple',
    ['John 2:13-22']),
  buildSection(32, PART_VI, PT_VI,
    'Nicodemus Visits Jesus by Night',
    ['John 2:23-3:21']),
  buildSection(33, PART_VI, PT_VI,
    'John the Baptist\'s Final Witness to Jesus',
    ['John 3:22-36']),
  buildSection(34, PART_VI, PT_VI,
    'Jesus Leaves Judea for Galilee',
    ['Mark 1:14', 'Matt 4:12', 'Luke 3:19-20; 4:14', 'John 4:1-4']),
  buildSection(35, PART_VI, PT_VI,
    'Jesus and the Samaritan Woman at Jacob\'s Well',
    ['John 4:5-42']),
  buildSection(36, PART_VI, PT_VI,
    'Jesus Arrives in Galilee and Is Received',
    ['John 4:43-45']),

  // PART VII
  buildSection(37, PART_VII, PT_VII,
    'Jesus Begins His Galilean Ministry',
    ['Mark 1:14-15', 'Matt 4:17', 'Luke 4:14-15']),
  buildSection(38, PART_VII, PT_VII,
    'The Second Miracle: The Nobleman\'s Son Healed',
    ['John 4:46-54']),
  buildSection(39, PART_VII, PT_VII,
    'Jesus Rejected at Nazareth',
    ['Luke 4:16-31']),
  buildSection(40, PART_VII, PT_VII,
    'Jesus Makes Capernaum His Home',
    ['Matt 4:13-16', 'Luke 4:31']),
  buildSection(41, PART_VII, PT_VII,
    'The Call of the Four Fishermen',
    ['Mark 1:16-20', 'Matt 4:18-22', 'Luke 5:1-11']),
  buildSection(42, PART_VII, PT_VII,
    'A Demoniac Healed in the Synagogue at Capernaum',
    ['Mark 1:21-28', 'Luke 4:31-37']),
  buildSection(43, PART_VII, PT_VII,
    'Peter\'s Mother-in-Law and Others Healed',
    ['Mark 1:29-34', 'Matt 8:14-17', 'Luke 4:38-41']),
  buildSection(44, PART_VII, PT_VII,
    'The First Preaching Tour of Galilee',
    ['Mark 1:35-39', 'Matt 4:23-25', 'Luke 4:42-44']),
  buildSection(45, PART_VII, PT_VII,
    'A Leper Healed and the Result',
    ['Mark 1:40-45', 'Matt 8:2-4', 'Luke 5:12-16']),
  buildSection(46, PART_VII, PT_VII,
    'A Paralytic Forgiven and Healed',
    ['Mark 2:1-12', 'Matt 9:1-8', 'Luke 5:17-26']),
  buildSection(47, PART_VII, PT_VII,
    'The Call of Matthew (Levi)',
    ['Mark 2:13-17', 'Matt 9:9-13', 'Luke 5:27-32']),
  buildSection(48, PART_VII, PT_VII,
    'The Question About Fasting',
    ['Mark 2:18-22', 'Matt 9:14-17', 'Luke 5:33-39']),
  buildSection(49, PART_VII, PT_VII,
    'The Healing of the Impotent Man at Bethesda',
    ['John 5:1-47']),
  buildSection(50, PART_VII, PT_VII,
    'Plucking Grain on the Sabbath',
    ['Mark 2:23-28', 'Matt 12:1-8', 'Luke 6:1-5']),
  buildSection(51, PART_VII, PT_VII,
    'The Man With the Withered Hand Healed on the Sabbath',
    ['Mark 3:1-6', 'Matt 12:9-14', 'Luke 6:6-11']),
  buildSection(52, PART_VII, PT_VII,
    'Withdrawal to the Sea and Healings',
    ['Mark 3:7-12', 'Matt 12:15-21']),
  buildSection(53, PART_VII, PT_VII,
    'The Choosing of the Twelve Apostles',
    ['Mark 3:13-19', 'Luke 6:12-16']),
  buildSection(54, PART_VII, PT_VII,
    'The Sermon on the Mount',
    ['Matt 5-7', 'Luke 6:17-49']),
  buildSection(55, PART_VII, PT_VII,
    'The Healing of the Centurion\'s Servant',
    ['Matt 8:5-13', 'Luke 7:1-10']),
  buildSection(56, PART_VII, PT_VII,
    'The Raising of the Widow\'s Son at Nain',
    ['Luke 7:11-17']),
  buildSection(57, PART_VII, PT_VII,
    'John\'s Message From Prison and Jesus\' Answer',
    ['Matt 11:2-19', 'Luke 7:18-35']),
  buildSection(58, PART_VII, PT_VII,
    'The Woes on the Impenitent Cities and the Gracious Invitation',
    ['Matt 11:20-30']),
  buildSection(59, PART_VII, PT_VII,
    'The Sinful Woman in Simon\'s House',
    ['Luke 7:36-50']),
  buildSection(60, PART_VII, PT_VII,
    'The Ministering Women',
    ['Luke 8:1-3']),
  buildSection(61, PART_VII, PT_VII,
    'The Blasphemy of the Pharisees',
    ['Mark 3:19-30', 'Matt 12:22-37']),
  buildSection(62, PART_VII, PT_VII,
    'The Sign of Jonah and the Return of the Unclean Spirit',
    ['Matt 12:38-45']),
  buildSection(63, PART_VII, PT_VII,
    'The Mother and Brothers of Jesus',
    ['Mark 3:31-35', 'Matt 12:46-50', 'Luke 8:19-21']),
  buildSection(64, PART_VII, PT_VII,
    'The Parables by the Sea: the Kingdom of Heaven',
    ['Mark 4:1-34', 'Matt 13:1-53', 'Luke 8:4-18']),
  buildSection(65, PART_VII, PT_VII,
    'The Stilling of the Storm',
    ['Mark 4:35-41', 'Matt 8:18,23-27', 'Luke 8:22-25']),
  buildSection(66, PART_VII, PT_VII,
    'The Gerasene Demoniac Healed',
    ['Mark 5:1-20', 'Matt 8:28-34', 'Luke 8:26-39']),
  buildSection(67, PART_VII, PT_VII,
    'Jairus\'s Daughter Raised and a Woman Healed',
    ['Mark 5:21-43', 'Matt 9:18-26', 'Luke 8:40-56']),
  buildSection(68, PART_VII, PT_VII,
    'Two Blind Men and a Dumb Demoniac Healed',
    ['Matt 9:27-34']),
  buildSection(69, PART_VII, PT_VII,
    'Jesus Again Rejected at Nazareth',
    ['Mark 6:1-6', 'Matt 13:54-58']),
  buildSection(70, PART_VII, PT_VII,
    'The Second Preaching Tour of Galilee and Sending Out the Twelve',
    ['Mark 6:6-13', 'Matt 9:35-11:1', 'Luke 9:1-6']),
  buildSection(71, PART_VII, PT_VII,
    'Herod\'s Guilty Fears: the Death of John the Baptist',
    ['Mark 6:14-29', 'Matt 14:1-12', 'Luke 9:7-9']),

  // PART VIII
  buildSection(72, PART_VIII, PT_VIII,
    'The Twelve Return; Jesus Feeds the Five Thousand',
    ['Mark 6:30-44', 'Matt 14:13-21', 'Luke 9:10-17', 'John 6:1-14']),
  buildSection(73, PART_VIII, PT_VIII,
    'Jesus Withdraws Again to the Mountain',
    ['Mark 6:45-46', 'Matt 14:22-23', 'John 6:14-15']),
  buildSection(74, PART_VIII, PT_VIII,
    'Jesus Walks on the Water',
    ['Mark 6:47-52', 'Matt 14:24-33', 'John 6:16-21']),
  buildSection(75, PART_VIII, PT_VIII,
    'Healings at Gennesaret',
    ['Mark 6:53-56', 'Matt 14:34-36']),
  buildSection(76, PART_VIII, PT_VIII,
    'The Discourse on the Bread of Life',
    ['John 6:22-71']),
  buildSection(77, PART_VIII, PT_VIII,
    'The Tradition of the Elders',
    ['Mark 7:1-23', 'Matt 15:1-20', 'John 7:1']),
  buildSection(78, PART_VIII, PT_VIII,
    'The Syrophoenician Woman\'s Daughter Healed',
    ['Mark 7:24-30', 'Matt 15:21-28']),
  buildSection(79, PART_VIII, PT_VIII,
    'A Deaf-Mute Healed and Four Thousand Fed',
    ['Mark 7:31-8:9', 'Matt 15:29-38']),
  buildSection(80, PART_VIII, PT_VIII,
    'The Pharisees Seek a Sign; the Leaven of the Pharisees',
    ['Mark 8:10-12', 'Matt 15:39-16:4']),
  buildSection(81, PART_VIII, PT_VIII,
    'The Leaven of the Pharisees and a Blind Man Healed',
    ['Mark 8:13-26', 'Matt 16:5-12']),
  buildSection(82, PART_VIII, PT_VIII,
    'Peter\'s Confession at Caesarea Philippi',
    ['Mark 8:27-30', 'Matt 16:13-20', 'Luke 9:18-21']),
  buildSection(83, PART_VIII, PT_VIII,
    'The First Formal Prediction of the Death and Resurrection',
    ['Mark 8:31-37', 'Matt 16:21-26', 'Luke 9:22-25']),
  buildSection(84, PART_VIII, PT_VIII,
    'The Coming of the Kingdom',
    ['Mark 8:38-9:1', 'Matt 16:27-28', 'Luke 9:26-27']),
  buildSection(85, PART_VIII, PT_VIII,
    'The Transfiguration',
    ['Mark 9:2-8', 'Matt 17:1-8', 'Luke 9:28-36']),
  buildSection(86, PART_VIII, PT_VIII,
    'The Coming of Elijah',
    ['Mark 9:9-13', 'Matt 17:9-13', 'Luke 9:36']),
  buildSection(87, PART_VIII, PT_VIII,
    'The Epileptic Boy Healed',
    ['Mark 9:14-29', 'Matt 17:14-20', 'Luke 9:37-43']),
  buildSection(88, PART_VIII, PT_VIII,
    'The Second Prediction of the Death and Resurrection',
    ['Mark 9:30-32', 'Matt 17:22-23', 'Luke 9:43-45']),
  buildSection(89, PART_VIII, PT_VIII,
    'The Temple Tax',
    ['Matt 17:24-27']),
  buildSection(90, PART_VIII, PT_VIII,
    'Who Is the Greatest? A Child Set in the Midst',
    ['Mark 9:33-37', 'Matt 18:1-5', 'Luke 9:46-48']),
  buildSection(91, PART_VIII, PT_VIII,
    'Warning Against Causing Stumbling',
    ['Mark 9:38-50', 'Matt 18:6-14', 'Luke 9:49-50']),
  buildSection(92, PART_VIII, PT_VIII,
    'On Forgiveness Between Brothers',
    ['Matt 18:15-35']),
  buildSection(93, PART_VIII, PT_VIII,
    'Would-Be Followers of Jesus',
    ['Matt 8:19-22', 'Luke 9:57-62']),
  buildSection(94, PART_VIII, PT_VIII,
    'Jesus\' Brothers Urge Him to Go to Jerusalem',
    ['John 7:2-9']),
  buildSection(95, PART_VIII, PT_VIII,
    'The Journey to Jerusalem Through Samaria',
    ['Luke 9:51-56', 'John 7:10']),

  // PART IX
  buildSection(96, PART_IX, PT_IX,
    'Jesus Teaches at the Feast of Tabernacles',
    ['John 7:11-52']),
  buildSection(97, PART_IX, PT_IX,
    'The Woman Taken in Adultery',
    ['John 7:53-8:11']),
  buildSection(98, PART_IX, PT_IX,
    'Jesus the Light of the World',
    ['John 8:12-20']),
  buildSection(99, PART_IX, PT_IX,
    'Debates With the Pharisees: Abraham\'s Seed',
    ['John 8:21-59']),
  buildSection(100, PART_IX, PT_IX,
    'The Man Born Blind Healed',
    ['John 9:1-41']),
  buildSection(101, PART_IX, PT_IX,
    'The Good Shepherd',
    ['John 10:1-21']),
  buildSection(102, PART_IX, PT_IX,
    'The Mission of the Seventy',
    ['Luke 10:1-24']),
  buildSection(103, PART_IX, PT_IX,
    'The Good Samaritan',
    ['Luke 10:25-37']),
  buildSection(104, PART_IX, PT_IX,
    'Mary and Martha',
    ['Luke 10:38-42']),
  buildSection(105, PART_IX, PT_IX,
    'Teaching on Prayer',
    ['Luke 11:1-13']),
  buildSection(106, PART_IX, PT_IX,
    'Blasphemy Against the Holy Spirit',
    ['Luke 11:14-36']),
  buildSection(107, PART_IX, PT_IX,
    'Woes Against the Pharisees and Lawyers',
    ['Luke 11:37-54']),
  buildSection(108, PART_IX, PT_IX,
    'Warnings and Parables on Watchfulness',
    ['Luke 12:1-59']),
  buildSection(109, PART_IX, PT_IX,
    'A Call to Repentance: the Barren Fig Tree',
    ['Luke 13:1-9']),
  buildSection(110, PART_IX, PT_IX,
    'A Woman Healed on the Sabbath; the Mustard Seed and Leaven',
    ['Luke 13:10-21']),
  buildSection(111, PART_IX, PT_IX,
    'At the Feast of Dedication',
    ['John 10:22-39']),

  // PART X
  buildSection(112, PART_X, PT_X,
    'Withdrawal Beyond Jordan',
    ['John 10:40-42']),
  buildSection(113, PART_X, PT_X,
    'The Narrow Gate and the Shut Door; Herod\'s Threat',
    ['Luke 13:22-35']),
  buildSection(114, PART_X, PT_X,
    'At a Pharisee\'s Table; Parables on Humility and the Great Supper',
    ['Luke 14:1-24']),
  buildSection(115, PART_X, PT_X,
    'The Cost of Discipleship',
    ['Luke 14:25-35']),
  buildSection(116, PART_X, PT_X,
    'Parables of the Lost Sheep, Lost Coin, and Lost Son',
    ['Luke 15:1-32']),
  buildSection(117, PART_X, PT_X,
    'Parables and Teaching on Stewardship, Riches, and Duty',
    ['Luke 16:1-17:10']),
  buildSection(118, PART_X, PT_X,
    'The Raising of Lazarus',
    ['John 11:1-44']),
  buildSection(119, PART_X, PT_X,
    'The Plot to Kill Jesus; Withdrawal to Ephraim',
    ['John 11:45-54']),
  buildSection(120, PART_X, PT_X,
    'Healing of Ten Lepers; Coming of the Kingdom',
    ['Luke 17:11-37']),
  buildSection(121, PART_X, PT_X,
    'Parables on Prayer: the Unjust Judge and the Pharisee and Publican',
    ['Luke 18:1-14']),
  buildSection(122, PART_X, PT_X,
    'Teaching on Divorce',
    ['Mark 10:1-12', 'Matt 19:1-12']),
  buildSection(123, PART_X, PT_X,
    'Jesus Blesses Little Children',
    ['Mark 10:13-16', 'Matt 19:13-15', 'Luke 18:15-17']),
  buildSection(124, PART_X, PT_X,
    'The Rich Young Ruler and the Parable of the Laborers',
    ['Mark 10:17-31', 'Matt 19:16-20:16', 'Luke 18:18-30']),
  buildSection(125, PART_X, PT_X,
    'The Third Prediction of the Death and Resurrection',
    ['Mark 10:32-45', 'Matt 20:17-28', 'Luke 18:31-34']),
  buildSection(126, PART_X, PT_X,
    'Blind Bartimaeus Healed Near Jericho',
    ['Mark 10:46-52', 'Matt 20:29-34', 'Luke 18:35-43']),
  buildSection(127, PART_X, PT_X,
    'Zacchaeus; the Parable of the Pounds',
    ['Luke 19:1-28']),

  // PART XI
  buildSection('128a', PART_XI, PT_XI,
    'Arrival at Bethany Six Days Before the Passover',
    ['John 11:55-12:1', 'John 12:9-11']),
  buildSection('128b', PART_XI, PT_XI,
    'The Triumphal Entry into Jerusalem',
    ['Mark 11:1-11', 'Matt 21:1-11,14-17', 'Luke 19:29-44', 'John 12:12-19']),
  buildSection(129, PART_XI, PT_XI,
    'The Cleansing of the Temple; the Cursing of the Fig Tree',
    ['Mark 11:12-18', 'Matt 21:18-19,12-13', 'Luke 19:45-48']),
  buildSection(130, PART_XI, PT_XI,
    'The Coming of the Greeks; the Voice From Heaven',
    ['John 12:20-50']),
  buildSection(131, PART_XI, PT_XI,
    'The Fig Tree Withered; Power of Prayer',
    ['Mark 11:19-25', 'Matt 21:19-22', 'Luke 21:37-38']),
  buildSection(132, PART_XI, PT_XI,
    'Controversies With the Priests, Scribes, and Pharisees',
    ['Mark 11:27-12:12', 'Matt 21:23-22:14', 'Luke 20:1-19']),
  buildSection(133, PART_XI, PT_XI,
    'The Question About Tribute to Caesar',
    ['Mark 12:13-17', 'Matt 22:15-22', 'Luke 20:20-26']),
  buildSection(134, PART_XI, PT_XI,
    'The Question About the Resurrection',
    ['Mark 12:18-27', 'Matt 22:23-33', 'Luke 20:27-40']),
  buildSection(135, PART_XI, PT_XI,
    'The Great Commandment',
    ['Mark 12:28-34', 'Matt 22:34-40']),
  buildSection(136, PART_XI, PT_XI,
    'The Question About David\'s Son',
    ['Mark 12:35-37', 'Matt 22:41-46', 'Luke 20:41-44']),
  buildSection(137, PART_XI, PT_XI,
    'The Woes Against the Scribes and Pharisees',
    ['Mark 12:38-40', 'Matt 23:1-39', 'Luke 20:45-47']),
  buildSection(138, PART_XI, PT_XI,
    'The Widow\'s Mite',
    ['Mark 12:41-44', 'Luke 21:1-4']),

  // PART XII
  buildSection(139, PART_XII, PT_XII,
    'The Olivet Discourse',
    ['Mark 13:1-37', 'Matt 24:1-25:46', 'Luke 21:5-36']),
  buildSection(140, PART_XII, PT_XII,
    'The Plot to Kill Jesus',
    ['Mark 14:1-2', 'Matt 26:1-5', 'Luke 22:1-2']),
  buildSection(141, PART_XII, PT_XII,
    'The Anointing at Bethany',
    ['Mark 14:3-9', 'Matt 26:6-13', 'John 12:2-8']),
  buildSection(142, PART_XII, PT_XII,
    'Judas Bargains With the Priests',
    ['Mark 14:10-11', 'Matt 26:14-16', 'Luke 22:3-6']),
  buildSection(143, PART_XII, PT_XII,
    'Preparation for the Passover',
    ['Mark 14:12-16', 'Matt 26:17-19', 'Luke 22:7-13']),
  buildSection(144, PART_XII, PT_XII,
    'Arrival at the Upper Room; the Dispute About Greatness',
    ['Mark 14:17', 'Matt 26:20', 'Luke 22:14-16,24-30']),
  buildSection(145, PART_XII, PT_XII,
    'The Washing of the Disciples\' Feet',
    ['John 13:1-20']),
  buildSection(146, PART_XII, PT_XII,
    'The Announcement of the Betrayal',
    ['Mark 14:18-21', 'Matt 26:21-25', 'Luke 22:21-23', 'John 13:21-30']),
  buildSection(147, PART_XII, PT_XII,
    'The Prediction of Peter\'s Denial',
    ['Mark 14:27-31', 'Matt 26:31-35', 'Luke 22:31-38', 'John 13:31-38']),
  buildSection(148, PART_XII, PT_XII,
    'The Institution of the Lord\'s Supper',
    ['Mark 14:22-25', 'Matt 26:26-29', 'Luke 22:17-20', '1 Cor 11:23-26']),
  buildSection(149, PART_XII, PT_XII,
    'The Upper Room Discourse: the Way, the Truth, the Life',
    ['John 14:1-31']),
  buildSection(150, PART_XII, PT_XII,
    'The Upper Room Discourse: the Vine and the Branches; the Promise of the Spirit',
    ['John 15:1-16:33']),
  buildSection(151, PART_XII, PT_XII,
    'The High-Priestly Prayer',
    ['John 17:1-26']),
  buildSection(152, PART_XII, PT_XII,
    'Gethsemane',
    ['Mark 14:26,32-42', 'Matt 26:30,36-46', 'Luke 22:39-46', 'John 18:1']),

  // PART XIII
  buildSection(153, PART_XIII, PT_XIII,
    'The Arrest of Jesus',
    ['Mark 14:43-52', 'Matt 26:47-56', 'Luke 22:47-53', 'John 18:2-12']),
  buildSection(154, PART_XIII, PT_XIII,
    'Jesus Before Annas',
    ['John 18:12-14,19-23']),
  buildSection(155, PART_XIII, PT_XIII,
    'The Trial Before Caiaphas and the Sanhedrin',
    ['Mark 14:53,55-65', 'Matt 26:57,59-68', 'Luke 22:54,63-65', 'John 18:24']),
  buildSection(156, PART_XIII, PT_XIII,
    'Peter\'s Triple Denial',
    ['Mark 14:54,66-72', 'Matt 26:58,69-75', 'Luke 22:54-62', 'John 18:15-18,25-27']),
  buildSection(157, PART_XIII, PT_XIII,
    'The Morning Session of the Sanhedrin',
    ['Mark 15:1', 'Matt 27:1', 'Luke 22:66-71']),
  buildSection(158, PART_XIII, PT_XIII,
    'The Remorse and Suicide of Judas',
    ['Matt 27:3-10', 'Acts 1:18-19']),
  buildSection(159, PART_XIII, PT_XIII,
    'The First Examination Before Pilate',
    ['Mark 15:1-5', 'Matt 27:2,11-14', 'Luke 23:1-5', 'John 18:28-38']),
  buildSection(160, PART_XIII, PT_XIII,
    'Jesus Before Herod Antipas',
    ['Luke 23:6-12']),
  buildSection(161, PART_XIII, PT_XIII,
    'The Final Examination Before Pilate; Jesus Condemned',
    ['Mark 15:6-15', 'Matt 27:15-26', 'Luke 23:13-25', 'John 18:39-19:16']),
  buildSection(162, PART_XIII, PT_XIII,
    'The Mocking by the Roman Soldiers',
    ['Mark 15:16-19', 'Matt 27:27-30']),
  buildSection(163, PART_XIII, PT_XIII,
    'The Way to Golgotha',
    ['Mark 15:20-23', 'Matt 27:31-34', 'Luke 23:26-33', 'John 19:16-17']),
  buildSection(164, PART_XIII, PT_XIII,
    'The Crucifixion',
    ['Mark 15:24-32', 'Matt 27:35-44', 'Luke 23:33-43', 'John 19:18-27']),
  buildSection(165, PART_XIII, PT_XIII,
    'The Death of Jesus',
    ['Mark 15:33-37', 'Matt 27:45-50', 'Luke 23:44-46', 'John 19:28-30']),
  buildSection(166, PART_XIII, PT_XIII,
    'Events Following the Death of Jesus',
    ['Mark 15:38-41', 'Matt 27:51-56', 'Luke 23:45,47-49']),
  buildSection(167, PART_XIII, PT_XIII,
    'The Burial of Jesus',
    ['Mark 15:42-46', 'Matt 27:57-60', 'Luke 23:50-54', 'John 19:31-42']),
  buildSection(168, PART_XIII, PT_XIII,
    'The Guard at the Tomb',
    ['Mark 15:47', 'Matt 27:61-66', 'Luke 23:55-56']),

  // PART XIV
  buildSection(169, PART_XIV, PT_XIV,
    'The Women Go to the Tomb',
    ['Mark 16:1', 'Matt 28:1']),
  buildSection(170, PART_XIV, PT_XIV,
    'The Angel Rolls Away the Stone',
    ['Matt 28:2-4']),
  buildSection(171, PART_XIV, PT_XIV,
    'The Women Find the Tomb Empty',
    ['Mark 16:2-8', 'Matt 28:5-8', 'Luke 24:1-8', 'John 20:1']),
  buildSection(172, PART_XIV, PT_XIV,
    'Peter and John Run to the Tomb',
    ['Luke 24:9-12', 'John 20:2-10']),
  buildSection(173, PART_XIV, PT_XIV,
    'Jesus Appears to Mary Magdalene',
    ['Mark 16:9-11', 'John 20:11-18']),
  buildSection(174, PART_XIV, PT_XIV,
    'Jesus Appears to the Other Women',
    ['Matt 28:9-10']),
  buildSection(175, PART_XIV, PT_XIV,
    'The Guards\' Report and the Bribe',
    ['Matt 28:11-15']),
  buildSection(176, PART_XIV, PT_XIV,
    'Jesus Appears to Two Disciples on the Way to Emmaus',
    ['Mark 16:12-13', 'Luke 24:13-32']),
  buildSection(177, PART_XIV, PT_XIV,
    'The Report of the Emmaus Disciples; the Appearance to Simon',
    ['Luke 24:33-35', '1 Cor 15:5']),
  buildSection(178, PART_XIV, PT_XIV,
    'Jesus Appears to the Ten Disciples',
    ['Mark 16:14', 'Luke 24:36-43', 'John 20:19-25']),
  buildSection(179, PART_XIV, PT_XIV,
    'Jesus Appears to the Eleven; Thomas Convinced',
    ['John 20:26-31', '1 Cor 15:5']),
  buildSection(180, PART_XIV, PT_XIV,
    'The Appearance to Seven Disciples by the Sea of Galilee',
    ['John 21:1-25']),
  buildSection(181, PART_XIV, PT_XIV,
    'The Appearance to Above Five Hundred on an Appointed Mountain in Galilee and a Commission Given',
    ['Mark 16:15-18', 'Matt 28:16-20', '1 Cor 15:6']),
  buildSection(182, PART_XIV, PT_XIV,
    'The Appearance to James the Brother of Jesus',
    ['1 Cor 15:7']),
  buildSection(183, PART_XIV, PT_XIV,
    'The Appearance to the Disciples With Another Commission',
    ['Luke 24:44-49', 'Acts 1:3-8']),
  buildSection(184, PART_XIV, PT_XIV,
    'The Last Appearance and the Ascension',
    ['Mark 16:19-20', 'Luke 24:50-53', 'Acts 1:9-12']),
];

// Verify count: 185 objects because Robertson split §128 into §128a and §128b.
// The 184-day reading plan groups them as day 128.
if (SECTIONS.length !== 185) {
  console.error(`ERROR: Expected 185 section objects (§128a+§128b split), got ${SECTIONS.length}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------
const json = JSON.stringify(SECTIONS, null, 2);

const canonicalPath = resolve(ROOT, 'data-sources/gospel-harmony/robertson-harmony.json');
const appPath = resolve(ROOT, 'apps/pwa-polished/src/data/robertson-harmony.json');

for (const p of [canonicalPath, appPath]) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, json, 'utf8');
  console.log(`Wrote ${p}`);
}

// Quick spot-checks
function check(label, condition) {
  if (!condition) console.error(`FAIL: ${label}`);
  else console.log(`OK:   ${label}`);
}

const s54 = SECTIONS.find(s => s.section === 54);
check('§54 has Matthew chapter 5', s54?.chapter_refs.some(r => r.book === 'Matthew' && r.chapter === 5));
check('§54 has Matthew chapter 7', s54?.chapter_refs.some(r => r.book === 'Matthew' && r.chapter === 7));
check('§54 has Luke chapter 6',    s54?.chapter_refs.some(r => r.book === 'Luke' && r.chapter === 6));
check('§54 no Matthew chapter 8',  !s54?.chapter_refs.some(r => r.book === 'Matthew' && r.chapter === 8));

const s32 = SECTIONS.find(s => s.section === 32);
check('§32 endChapter 3', s32?.passages[0]?.endChapter === 3);
check('§32 endVerse 21',  s32?.passages[0]?.endVerse === 21);

const s158 = SECTIONS.find(s => s.section === 158);
check('§158 has Acts', s158?.chapter_refs.some(r => r.book === 'Acts'));
check('§158 has Acts 1', s158?.chapter_refs.some(r => r.book === 'Acts' && r.chapter === 1));

const s182 = SECTIONS.find(s => s.section === 182);
check('§182 has 1 Corinthians', s182?.chapter_refs.some(r => r.book === '1 Corinthians'));
check('§182 passages NOT empty', s182?.passages.length > 0);
check('§182 passage label "1 Cor 15:7"', s182?.passages[0]?.label === '1 Cor 15:7');

const s183 = SECTIONS.find(s => s.section === 183);
check('§183 has Acts 1', s183?.chapter_refs.some(r => r.book === 'Acts' && r.chapter === 1));

const s148 = SECTIONS.find(s => s.section === 148);
check('§148 has 1 Corinthians 11', s148?.chapter_refs.some(r => r.book === '1 Corinthians' && r.chapter === 11));

const s128a = SECTIONS.find(s => s.section === '128a');
const s128b = SECTIONS.find(s => s.section === '128b');
check('§128a exists', !!s128a);
check('§128b exists', !!s128b);
check('§128a has John 11 and 12', s128a?.chapter_refs.some(r => r.book === 'John' && r.chapter === 11) && s128a?.chapter_refs.some(r => r.book === 'John' && r.chapter === 12));

console.log(`\nTotal section objects: ${SECTIONS.length} (185 = §128 split into §128a + §128b; 184-day plan groups them as one day)`);
