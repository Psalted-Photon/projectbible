/**
 * The eras the timeline moves through.
 *
 * `confidence` is the honest part. "attested" means the shapes come from the
 * Barrington Atlas — surveyed, scholarly, the reference classicists cite.
 * "approximate" means no one knows where the borders ran, so the map shows the
 * *lands Scripture names in that period* rather than inventing a frontier.
 *
 * `books` drives the approximate eras: a land appears on an era's map when the
 * biblical books covering that period name it. That is a claim the text can
 * support, unlike a border.
 *
 * `territory` names AWMC political layers, used where they exist.
 */

export const ERAS = [
  {
    id: 'patriarchs',
    title: 'Age of the Patriarchs',
    subtitle: 'Abraham, Isaac and Jacob',
    yearStart: -2000, yearEnd: -1700,
    datingNote: 'Dates for the patriarchs are inferred from genealogies and vary by centuries between scholars.',
    confidence: 'approximate',
    blurb: 'Abraham leaves Ur for Canaan. The land is a scatter of city-states between the great powers of Egypt and Mesopotamia.',
    books: ['Gen'],
  },
  {
    id: 'exodus',
    title: 'Exodus and Wilderness',
    subtitle: 'Egypt to Sinai',
    yearStart: -1450, yearEnd: -1400,
    datingNote: 'Follows the early date, reading 1 Kings 6:1 literally. Many scholars place the Exodus nearer 1250 BC.',
    confidence: 'approximate',
    blurb: 'Israel leaves Egypt and spends a generation in the wilderness south and east of Canaan.',
    books: ['Exod', 'Lev', 'Num', 'Deut'],
  },
  {
    id: 'conquest',
    title: 'Conquest and Judges',
    subtitle: 'Settling the land',
    yearStart: -1400, yearEnd: -1050,
    datingNote: 'Tied to the Exodus date above; a late Exodus shifts this era roughly two centuries later.',
    confidence: 'approximate',
    blurb: 'Israel settles among Canaanites, Philistines and the peoples east of the Jordan. No central authority; leadership rises and falls locally.',
    books: ['Josh', 'Judg', 'Ruth'],
  },
  {
    id: 'united-kingdom',
    title: 'The United Kingdom',
    subtitle: 'Saul, David and Solomon',
    yearStart: -1050, yearEnd: -930,
    confidence: 'approximate',
    blurb: 'A single kingdom under three kings, reaching its widest influence under David and Solomon.',
    books: ['1Sam', '2Sam', '1Chr', 'Ps', 'Prov', 'Eccl', 'Song'],
  },
  {
    id: 'divided-kingdom',
    title: 'The Divided Kingdom',
    subtitle: 'Israel and Judah',
    yearStart: -930, yearEnd: -722,
    confidence: 'approximate',
    blurb: 'The kingdom splits after Solomon. Israel in the north and Judah in the south run as rival states for two centuries.',
    books: ['1Kgs', '2Kgs', '2Chr', 'Amos', 'Hos', 'Mic', 'Jonah', 'Joel'],
  },
  {
    id: 'assyria',
    title: 'Assyrian Ascendancy',
    subtitle: 'The fall of the northern kingdom',
    yearStart: -745, yearEnd: -612,
    confidence: 'approximate',
    blurb: 'Assyria dominates the Near East and destroys Samaria in 722 BC. Judah survives as a tributary.',
    books: ['2Kgs', 'Isa', 'Nah', 'Zeph'],
  },
  {
    id: 'babylon',
    title: 'Babylon and the Exile',
    subtitle: 'Jerusalem falls',
    yearStart: -605, yearEnd: -539,
    confidence: 'approximate',
    blurb: 'Babylon replaces Assyria, destroys Jerusalem in 586 BC and carries Judah into exile.',
    books: ['Jer', 'Lam', 'Ezek', 'Dan', 'Hab', 'Obad'],
  },
  {
    id: 'persia',
    title: 'The Persian Empire',
    subtitle: 'Return from exile',
    yearStart: -539, yearEnd: -332,
    confidence: 'attested',
    blurb: 'Cyrus takes Babylon and lets the exiles return. Judah becomes a small province in the largest empire the world had yet seen.',
    books: ['Ezra', 'Neh', 'Esth', 'Hag', 'Zech', 'Mal'],
    territory: ['extent_of_the_persian_empire'],
  },
  {
    id: 'alexander',
    title: "Alexander's Empire",
    subtitle: 'The Greek conquest',
    yearStart: -336, yearEnd: -323,
    confidence: 'attested',
    blurb: 'Alexander takes the whole Persian world in a decade, spreading Greek language and culture across it.',
    books: [],
    territory: ['alexanders_empire'],
  },
  {
    id: 'hasmonean',
    title: 'The Hasmonean Kingdom',
    subtitle: 'Jewish independence',
    yearStart: -140, yearEnd: -37,
    confidence: 'attested',
    blurb: 'The Maccabean revolt wins a century of Jewish self-rule before Rome arrives.',
    books: [],
    territory: ['hasmonean_kingdom'],
  },
  {
    id: 'roman-republic',
    title: 'Rome Arrives',
    subtitle: 'The late Republic',
    yearStart: -63, yearEnd: -31,
    confidence: 'attested',
    blurb: 'Pompey takes Jerusalem in 63 BC. The eastern Mediterranean passes to Rome.',
    books: [],
    territory: ['roman_empire_bce_60'],
  },
  {
    id: 'herod',
    title: "Herod's Kingdom",
    subtitle: 'The birth of Jesus',
    yearStart: -37, yearEnd: -4,
    confidence: 'attested',
    blurb: 'Herod the Great rules Judea as a client king of Rome. Jesus is born near the end of his reign.',
    books: ['Matt', 'Luke'],
    territory: ['herods_kingdom'],
  },
  {
    id: 'apostolic',
    title: 'The Apostolic Age',
    subtitle: 'The church spreads',
    yearStart: 30, yearEnd: 100,
    confidence: 'attested',
    blurb: 'The gospel moves out from Jerusalem through the provinces of the empire, along Roman roads and shipping lanes.',
    books: ['Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev', 'Mark', 'John'],
    territory: ['roman_senatorial_provinces'],
  },
  {
    id: 'rome-peak',
    title: 'Rome at its Height',
    subtitle: 'The empire at full extent',
    yearStart: 98, yearEnd: 117,
    confidence: 'attested',
    blurb: 'Under Trajan the empire reaches its greatest extent, from Britain to the Persian Gulf.',
    books: [],
    territory: ['roman_empire_ce_117_extent'],
  },
  {
    id: 'rome-provinces',
    title: 'The Provinces of Rome',
    subtitle: 'The empire organised',
    yearStart: 180, yearEnd: 220,
    confidence: 'attested',
    blurb: 'The mature provincial system that the early church grew up inside.',
    books: [],
    territory: ['roman_empire_ce_200_extent'],
    // The Barrington province shapes carry no names at all — the columns exist
    // and every row holds a zero — so an era of eighty-one provinces read as one
    // undifferentiated Rome. These come from the Digital Atlas of the Roman
    // Empire instead, which is built on the same Barrington base and names them.
    namedProvinces: 'dare-ad200',
  },
  {
    id: 'later-empire',
    title: 'The Later Empire',
    subtitle: "Diocletian's reorganisation",
    yearStart: 284, yearEnd: 400,
    confidence: 'attested',
    blurb: 'The empire is redivided into many smaller provinces, the shape it carried into the Christian centuries.',
    books: [],
    territory: ['roman_empire_provinces post_diocletian'],
  },
];
