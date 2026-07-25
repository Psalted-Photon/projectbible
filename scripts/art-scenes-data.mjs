/**
 * Curated biblical-art scenes for the Art pack.
 *
 * Each scene anchors to a passage (book/chapter/verse) — the in-text art icon
 * appears at that verse in the reader. `works` lists one or more paintings; each
 * `file` is an exact Wikimedia Commons filename (without the "File:" prefix).
 * The build script (build-art-pack.mjs) resolves each file to a verified,
 * high-resolution image URL + source page + license at build time, so broken
 * filenames are caught (and skipped) rather than shipped.
 *
 * All works here are public domain (creator died 70+ years ago) and were
 * confirmed to resolve on Commons. Grow this list toward ~150 marquee scenes.
 */
export const ART_SCENES = [
  {
    id: 'creation-of-adam',
    title: 'The Creation of Adam',
    book: 'Genesis', chapter: 2, verse: 7,
    passageLabel: 'Genesis 1:26–2:7',
    works: [
      { file: 'Michelangelo, Creation of Adam 04.jpg', title: 'The Creation of Adam', artist: 'Michelangelo', year: 'c. 1512' },
    ],
  },
  {
    id: 'fall-of-man',
    title: 'The Fall of Man',
    book: 'Genesis', chapter: 3, verse: 6,
    passageLabel: 'Genesis 3:1–7',
    works: [
      { file: 'Michelangelo, Fall and Expulsion from Garden of Eden 00.jpg', title: 'The Fall and Expulsion from Paradise', artist: 'Michelangelo', year: 'c. 1509–1510' },
    ],
  },
  {
    id: 'the-flood',
    title: 'The Great Flood',
    book: 'Genesis', chapter: 7, verse: 11,
    passageLabel: 'Genesis 7:11–24',
    works: [
      { file: 'Gustave Doré - The Holy Bible - Plate I, The Deluge.jpg', title: 'The Deluge', artist: 'Gustave Doré', year: '1866' },
    ],
  },
  {
    id: 'sacrifice-of-isaac',
    title: 'The Sacrifice of Isaac',
    book: 'Genesis', chapter: 22, verse: 10,
    passageLabel: 'Genesis 22:1–14',
    works: [
      { file: 'Sacrifice of Isaac-Caravaggio (Uffizi).jpg', title: 'The Sacrifice of Isaac', artist: 'Caravaggio', year: 'c. 1603' },
    ],
  },
  {
    id: 'crossing-the-red-sea',
    title: 'Crossing the Red Sea',
    book: 'Exodus', chapter: 14, verse: 21,
    passageLabel: 'Exodus 14:21–31',
    works: [
      { file: 'Nicolas Poussin - Le Passage de la mer Rouge.jpg', title: 'The Crossing of the Red Sea', artist: 'Nicolas Poussin', year: 'c. 1634' },
    ],
  },
  {
    id: 'moses-ten-commandments',
    title: 'Moses and the Ten Commandments',
    book: 'Exodus', chapter: 34, verse: 29,
    passageLabel: 'Exodus 34:29–35',
    works: [
      { file: 'Rembrandt - Moses with the Ten Commandments - Google Art Project.jpg', title: 'Moses with the Ten Commandments', artist: 'Rembrandt', year: '1659' },
    ],
  },
  {
    id: 'david-and-goliath',
    title: 'David and Goliath',
    book: '1 Samuel', chapter: 17, verse: 51,
    passageLabel: '1 Samuel 17:41–51',
    works: [
      { file: 'Caravaggio - David with the Head of Goliath - Vienna.jpg', title: 'David with the Head of Goliath', artist: 'Caravaggio', year: 'c. 1607' },
    ],
  },
  {
    id: 'annunciation',
    title: 'The Annunciation',
    book: 'Luke', chapter: 1, verse: 28,
    passageLabel: 'Luke 1:26–38',
    works: [
      { file: 'Henry Ossawa Tanner - The Annunciation.jpg', title: 'The Annunciation', artist: 'Henry Ossawa Tanner', year: '1898' },
    ],
  },
  {
    id: 'nativity',
    title: 'The Nativity',
    book: 'Luke', chapter: 2, verse: 7,
    passageLabel: 'Luke 2:1–20',
    works: [
      { file: 'Gerard van Honthorst - Adoration of the Shepherds (1622).jpg', title: 'Adoration of the Shepherds', artist: 'Gerrit van Honthorst', year: '1622' },
    ],
  },
  {
    id: 'baptism-of-jesus',
    title: 'The Baptism of Jesus',
    book: 'Matthew', chapter: 3, verse: 16,
    passageLabel: 'Matthew 3:13–17',
    works: [
      { file: 'Piero della Francesca - Battesimo di Cristo (National Gallery, London).jpg', title: 'The Baptism of Christ', artist: 'Piero della Francesca', year: 'c. 1450' },
    ],
  },
  {
    id: 'storm-on-the-sea',
    title: 'Christ Calms the Storm',
    book: 'Mark', chapter: 4, verse: 39,
    passageLabel: 'Mark 4:35–41',
    works: [
      { file: 'Rembrandt Christ in the Storm on the Lake of Galilee.jpg', title: 'Christ in the Storm on the Sea of Galilee', artist: 'Rembrandt', year: '1633' },
    ],
  },
  {
    id: 'good-samaritan',
    title: 'The Good Samaritan',
    book: 'Luke', chapter: 10, verse: 33,
    passageLabel: 'Luke 10:25–37',
    works: [
      { file: 'Vincent van Gogh - The Good Samaritan, 1890 - Google Art Project.jpg', title: 'The Good Samaritan (after Delacroix)', artist: 'Vincent van Gogh', year: '1890' },
    ],
  },
  {
    id: 'return-of-the-prodigal-son',
    title: 'The Return of the Prodigal Son',
    book: 'Luke', chapter: 15, verse: 20,
    passageLabel: 'Luke 15:11–32',
    works: [
      { file: 'Rembrandt Harmensz. van Rijn - The Return of the Prodigal Son.jpg', title: 'The Return of the Prodigal Son', artist: 'Rembrandt', year: 'c. 1668' },
    ],
  },
  {
    id: 'last-supper',
    title: 'The Last Supper',
    book: 'John', chapter: 13, verse: 21,
    passageLabel: 'John 13:21–30',
    works: [
      { file: 'Leonardo da Vinci (1452-1519) - The Last Supper (1495-1498).jpg', title: 'The Last Supper', artist: 'Leonardo da Vinci', year: '1495–1498' },
    ],
  },
  {
    id: 'taking-of-christ',
    title: 'The Arrest of Christ',
    book: 'Matthew', chapter: 26, verse: 48,
    passageLabel: 'Matthew 26:47–56',
    works: [
      { file: 'Caravaggio - Taking of Christ - Dublin.jpg', title: 'The Taking of Christ', artist: 'Caravaggio', year: '1602' },
    ],
  },
  {
    id: 'crucifixion',
    title: 'The Crucifixion',
    book: 'John', chapter: 19, verse: 18,
    passageLabel: 'John 19:16–30',
    works: [
      { file: 'Diego Velázquez 060.jpg', title: 'Christ Crucified', artist: 'Diego Velázquez', year: 'c. 1632' },
      { file: 'Matthias Grünewald - The Crucifixion - WGA10723.jpg', title: 'The Crucifixion (Isenheim Altarpiece)', artist: 'Matthias Grünewald', year: 'c. 1512–1516' },
    ],
  },
  {
    id: 'resurrection',
    title: 'The Resurrection',
    book: 'Matthew', chapter: 28, verse: 6,
    passageLabel: 'Matthew 28:1–10',
    works: [
      { file: 'Piero della Francesca - Resurrection - WGA17609.jpg', title: 'The Resurrection', artist: 'Piero della Francesca', year: 'c. 1463' },
    ],
  },
];
