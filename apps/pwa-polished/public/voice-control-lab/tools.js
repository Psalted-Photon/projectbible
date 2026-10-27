/**
 * Voice Control lab — the actions Needle chooses from, written the way
 * Cactus's guide asks: one tool per action, named as people say it, formats in
 * the descriptions, fixed choices as enums.
 *
 * CORE is always sent. Each extra group is sent only when one of its trigger
 * words is in what was said, because Needle gets less accurate as the list
 * grows. The lab can also send everything at once, to measure that drop.
 */

const WINDOWS = [
  'Bible', 'Harmonies', 'Connections', 'Commentary', 'Encyclopedia', 'People',
  'Topical', 'Strongs', 'Map', 'Timeline', 'Art', 'Family Tree', 'Notes', 'Journal',
];

export const TRANSLATIONS = ['KJV', 'WEB', 'BSB', 'NET', 'LXX', 'Byzantine', 'Textus Receptus'];

export const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple', 'red'];

const str = (description) => ({ type: 'string', description });

export const CORE = [
  {
    name: 'go_to_passage',
    description: 'Go to a Bible passage: a book and chapter, and a verse if one is said.',
    parameters: {
      type: 'object',
      properties: {
        reference: str('The passage exactly as spoken, e.g. "romans 6", "first timothy 2 verse 4", "john 3 16".'),
      },
      required: ['reference'],
    },
  },
  {
    name: 'open_commentary',
    description: 'Open a Bible commentary by its author, on the current passage.',
    parameters: {
      type: 'object',
      properties: {
        author: str('The commentator as spoken, e.g. "matthew henry", "king comments", "calvin".'),
        new_window: { type: 'boolean', description: 'True only when a new window is asked for.' },
      },
      required: ['author'],
    },
  },
  {
    name: 'word_study',
    description: 'Open a word study for an English word: its Greek or Hebrew behind it and where it is used.',
    parameters: {
      type: 'object',
      properties: { word: str('The English word, e.g. "rivers", "grace".') },
      required: ['word'],
    },
  },
  {
    name: 'strongs_lookup',
    description: "Look up a Strong's number, or a Greek or Hebrew word, in the Strong's dictionary.",
    parameters: {
      type: 'object',
      properties: { query: str('A Strong\'s number like "G26" or "H430", or a word like "agape".') },
      required: ['query'],
    },
  },
  {
    name: 'highlight_verses',
    description: 'Highlight verses in the open chapter with a color.',
    parameters: {
      type: 'object',
      properties: {
        verses: str('Verse numbers as spoken, e.g. "16", "16 to 18".'),
        color: { type: 'string', enum: COLORS },
      },
      required: ['verses', 'color'],
    },
  },
  {
    name: 'search_bible',
    description: 'Search the Bible text for words or a phrase.',
    parameters: {
      type: 'object',
      properties: { query: str('The words to search for.') },
      required: ['query'],
    },
  },
  {
    name: 'open_window',
    description: 'Open a window or panel in the app.',
    parameters: {
      type: 'object',
      properties: { window: { type: 'string', enum: WINDOWS } },
      required: ['window'],
    },
  },
  {
    name: 'close_window',
    description: 'Close a window or panel, or all of them.',
    parameters: {
      type: 'object',
      properties: { window: { type: 'string', enum: [...WINDOWS, 'all'] } },
      required: ['window'],
    },
  },
  {
    name: 'read_aloud',
    description: 'Start reading the Bible aloud, from a verse if one is said.',
    parameters: {
      type: 'object',
      properties: { from_verse: { type: 'integer', description: 'The verse to start from.' } },
    },
  },
  {
    name: 'stop_reading',
    description: 'Stop or pause reading aloud.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'switch_translation',
    description: 'Switch the Bible translation being read.',
    parameters: {
      type: 'object',
      properties: {
        translation: {
          type: 'string',
          enum: TRANSLATIONS,
          description: 'KJV is the King James, WEB the World English Bible, BSB the Berean Standard Bible, NET the NET Bible, LXX the Septuagint.',
        },
      },
      required: ['translation'],
    },
  },
];

export const GROUPS = [
  {
    key: 'map',
    triggers: /\b(maps?|where (is|was))\b/,
    tools: [
      {
        name: 'show_on_map',
        description: 'Show a Bible place on the map, at a year if one is said.',
        parameters: {
          type: 'object',
          properties: {
            place: str('The place, e.g. "jericho", "the sea of galilee".'),
            year: str('A year as spoken, e.g. "1000 bc".'),
          },
          required: ['place'],
        },
      },
    ],
  },
  {
    key: 'connections',
    triggers: /\b(connections?|cross ?references?|arcs?)\b/,
    tools: [
      {
        name: 'show_connections',
        description: 'Show the cross-reference connections for a passage.',
        parameters: {
          type: 'object',
          properties: { reference: str('The passage as spoken; the current one if none is said.') },
        },
      },
    ],
  },
  {
    key: 'tree',
    triggers: /\b(tree|family|genealog\w*|ancestors?|descendants?)\b/,
    tools: [
      {
        name: 'family_tree',
        description: 'Open the family tree on a person.',
        parameters: {
          type: 'object',
          properties: { person: str('The person, e.g. "david", "mephibosheth".') },
          required: ['person'],
        },
      },
    ],
  },
  {
    key: 'people',
    triggers: /\b(bio|biography|who (is|was)|person|people)\b/,
    tools: [
      {
        name: 'person_bio',
        description: 'Open the biography of a Bible person.',
        parameters: {
          type: 'object',
          properties: { person: str('The person, e.g. "ruth", "barnabas".') },
          required: ['person'],
        },
      },
    ],
  },
  {
    key: 'encyclopedia',
    triggers: /\b(encyclopedia|isbe|article)\b/,
    tools: [
      {
        name: 'encyclopedia',
        description: 'Open the encyclopedia article on a subject.',
        parameters: {
          type: 'object',
          properties: { topic: str('The subject, e.g. "tabernacle".') },
          required: ['topic'],
        },
      },
    ],
  },
  {
    key: 'topical',
    triggers: /\b(topics?|topical|naves?)\b/,
    tools: [
      {
        name: 'topical',
        description: "Open Nave's topical index on a subject.",
        parameters: {
          type: 'object',
          properties: { topic: str('The subject, e.g. "forgiveness".') },
          required: ['topic'],
        },
      },
    ],
  },
  {
    key: 'timeline',
    triggers: /\b(timeline|when (did|was))\b/,
    tools: [
      {
        name: 'timeline',
        description: 'Open the timeline on an event, person or era.',
        parameters: {
          type: 'object',
          properties: { event: str('The event, e.g. "the exodus", "the exile".') },
          required: ['event'],
        },
      },
    ],
  },
];

/** The tools to send for what was said. */
export function toolsFor(text, everything = false) {
  const t = text.toLowerCase();
  const groups = GROUPS.filter((g) => everything || g.triggers.test(t));
  return { tools: [...CORE, ...groups.flatMap((g) => g.tools)], groups: groups.map((g) => g.key) };
}

/** The commentaries the app ships, for the "not installed" reply. */
export const COMMENTARY_AUTHORS = [
  'A.T. Robertson', 'Abbott', 'Adam Clarke', 'Albert Barnes', 'Charles Spurgeon',
  'E.W. Bullinger', 'Family Bible Notes', 'Jamieson-Fausset-Brown', 'John Calvin',
  'John Lightfoot', 'John Wesley', 'KingComments', 'Martin Luther', 'Matthew Henry',
  'Thomas Aquinas (Catena Aurea)', 'Treasury of Scripture Knowledge',
];

const squash = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

/** The installed commentary a spoken name means, or null. */
export function findCommentary(spoken) {
  const s = squash(spoken);
  if (!s) return null;
  for (const a of COMMENTARY_AUTHORS) {
    const full = squash(a);
    if (full.includes(s) || s.includes(full)) return a;
    // Any one name of the author on its own ("henry", "calvin", "jfb").
    const words = a.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    if (words.some((w) => s === w || s.endsWith(w))) return a;
  }
  if (s === 'jfb') return 'Jamieson-Fausset-Brown';
  if (s === 'tsk') return 'Treasury of Scripture Knowledge';
  return null;
}

const BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

/** Names Whistle is told to favor: one per line, as people say them. */
export const APP_KEYWORDS = [
  ...new Set(BOOKS.map((b) => b.replace(/^\d /, ''))),
  'Matthew Henry', 'Adam Clarke', 'Albert Barnes', 'John Calvin', 'John Wesley',
  'Jamieson Fausset Brown', 'Robertson', 'King Comments', 'Bullinger', 'Spurgeon',
  'Lightfoot', 'Luther', 'Aquinas', 'Treasury of Scripture Knowledge',
  'Connections', 'Encyclopedia', 'Topical', "Strong's", 'Timeline', 'Family Tree',
  'Harmonies', 'King James', 'World English Bible', 'Berean', 'NET Bible', 'Septuagint',
].join('\n');

/** Names that are hard to hear right, for the names test. */
export const HARD_NAMES = [
  'Mephibosheth', 'Chedorlaomer', 'Nebuchadnezzar', 'Melchizedek', 'Zerubbabel',
  'Tiglath-pileser', 'Jehoshaphat', 'Ahasuerus', 'Abednego', 'Habakkuk', 'Zephaniah',
  'Maher-shalal-hash-baz', 'Bartholomew', 'Thessalonians', 'Ecclesiastes', 'Philemon',
];
