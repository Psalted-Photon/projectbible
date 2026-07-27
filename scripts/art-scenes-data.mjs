/**
 * Curated biblical-art scenes for the Art pack.
 *
 * Each scene anchors to a passage (book/chapter/verse) — the in-text art icon
 * appears at that verse in the reader. `works` lists one or more paintings.
 *
 * A work identifies its Commons image one of two ways:
 *   - `file`:   exact Wikimedia Commons filename (verified, preferred), OR
 *   - `search`: a query the build script resolves to the best high-res File.
 *
 * The build script (build-art-pack.mjs) resolves each work, DOWNLOADS the image
 * (full + thumbnail) and embeds the bytes in the pack, so the app displays art
 * fully offline. All works are public domain (creator died 70+ years ago).
 */
export const ART_SCENES = [
  // ── Genesis ────────────────────────────────────────────────────────────────
  { id: 'creation-separation-light', title: 'The First Day of Creation', book: 'Genesis', chapter: 1, verse: 3, passageLabel: 'Genesis 1:1–5',
    works: [{ search: 'Michelangelo Separation of Light from Darkness Sistine', title: 'The Separation of Light from Darkness', artist: 'Michelangelo', year: 'c. 1512' }] },
  { id: 'creation-of-adam', title: 'The Creation of Adam', book: 'Genesis', chapter: 2, verse: 7, passageLabel: 'Genesis 1:26–2:7',
    works: [{ file: 'Michelangelo, Creation of Adam 04.jpg', title: 'The Creation of Adam', artist: 'Michelangelo', year: 'c. 1512' }] },
  { id: 'fall-of-man', title: 'The Fall of Man', book: 'Genesis', chapter: 3, verse: 6, passageLabel: 'Genesis 3:1–7',
    works: [{ file: 'Michelangelo, Fall and Expulsion from Garden of Eden 00.jpg', title: 'The Fall and Expulsion from Paradise', artist: 'Michelangelo', year: 'c. 1509–1510' }] },
  { id: 'expulsion-from-eden', title: 'Expulsion from Eden', book: 'Genesis', chapter: 3, verse: 24, passageLabel: 'Genesis 3:22–24',
    works: [{ search: 'Masaccio Expulsion from the Garden of Eden Brancacci', title: 'The Expulsion from the Garden of Eden', artist: 'Masaccio', year: 'c. 1425' }] },
  { id: 'cain-and-abel', title: 'Cain and Abel', book: 'Genesis', chapter: 4, verse: 8, passageLabel: 'Genesis 4:1–16',
    works: [{ search: 'William Blake The Body of Abel Found by Adam and Eve', title: 'The Body of Abel Found by Adam and Eve', artist: 'William Blake', year: 'c. 1826' }] },
  { id: 'the-flood', title: 'The Great Flood', book: 'Genesis', chapter: 7, verse: 11, passageLabel: 'Genesis 7:11–24',
    works: [{ file: 'Gustave Doré - The Holy Bible - Plate I, The Deluge.jpg', title: 'The Deluge', artist: 'Gustave Doré', year: '1866' }] },
  { id: 'tower-of-babel', title: 'The Tower of Babel', book: 'Genesis', chapter: 11, verse: 4, passageLabel: 'Genesis 11:1–9',
    works: [{ search: 'Pieter Bruegel the Elder The Tower of Babel Vienna', title: 'The Tower of Babel', artist: 'Pieter Bruegel the Elder', year: '1563' }] },
  { id: 'abraham-and-the-angels', title: 'Abraham and the Three Visitors', book: 'Genesis', chapter: 18, verse: 2, passageLabel: 'Genesis 18:1–15',
    works: [{ search: 'Andrei Rublev Trinity icon', title: 'The Trinity (Hospitality of Abraham)', artist: 'Andrei Rublev', year: 'c. 1411' }] },
  { id: 'hagar-in-the-wilderness', title: 'Hagar in the Wilderness', book: 'Genesis', chapter: 21, verse: 17, passageLabel: 'Genesis 21:14–19',
    works: [{ search: 'Corot Hagar in the Wilderness Metropolitan', title: 'Hagar in the Wilderness', artist: 'Camille Corot', year: '1835' }] },
  { id: 'sacrifice-of-isaac', title: 'The Sacrifice of Isaac', book: 'Genesis', chapter: 22, verse: 10, passageLabel: 'Genesis 22:1–14',
    works: [{ file: 'Sacrifice of Isaac-Caravaggio (Uffizi).jpg', title: 'The Sacrifice of Isaac', artist: 'Caravaggio', year: 'c. 1603' }] },
  { id: 'jacobs-dream', title: "Jacob's Ladder", book: 'Genesis', chapter: 28, verse: 12, passageLabel: 'Genesis 28:10–17',
    works: [{ search: "William Blake Jacob's Ladder British Museum", title: "Jacob's Ladder", artist: 'William Blake', year: 'c. 1805' }] },
  { id: 'jacob-wrestling-the-angel', title: 'Jacob Wrestling the Angel', book: 'Genesis', chapter: 32, verse: 24, passageLabel: 'Genesis 32:22–32',
    works: [{ search: 'Delacroix Jacob Wrestling with the Angel Saint-Sulpice', title: 'Jacob Wrestling with the Angel', artist: 'Eugène Delacroix', year: 'c. 1855' }] },
  { id: 'josephs-coat', title: "Joseph's Coat Brought to Jacob", book: 'Genesis', chapter: 37, verse: 31, passageLabel: 'Genesis 37:29–35',
    works: [{ search: "Velázquez Joseph's Tunic El Escorial", title: "Joseph's Bloody Coat Brought to Jacob", artist: 'Diego Velázquez', year: '1630' }] },
  { id: 'joseph-and-potiphars-wife', title: "Joseph and Potiphar's Wife", book: 'Genesis', chapter: 39, verse: 12, passageLabel: 'Genesis 39:6–20',
    works: [{ search: "Guido Reni Joseph and Potiphar's Wife", title: "Joseph and Potiphar's Wife", artist: 'Guido Reni', year: 'c. 1630' }] },

  // ── Exodus ─────────────────────────────────────────────────────────────────
  { id: 'finding-of-moses', title: 'The Finding of Moses', book: 'Exodus', chapter: 2, verse: 5, passageLabel: 'Exodus 2:1–10',
    works: [{ search: 'Lawrence Alma-Tadema The Finding of Moses', title: 'The Finding of Moses', artist: 'Sir Lawrence Alma-Tadema', year: '1904' }] },
  { id: 'burning-bush', title: 'The Burning Bush', book: 'Exodus', chapter: 3, verse: 2, passageLabel: 'Exodus 3:1–6',
    works: [{ search: 'Sébastien Bourdon Burning Bush Moses', title: 'Moses and the Burning Bush', artist: 'Sébastien Bourdon', year: 'c. 1643' }] },
  { id: 'crossing-the-red-sea', title: 'Crossing the Red Sea', book: 'Exodus', chapter: 14, verse: 21, passageLabel: 'Exodus 14:21–31',
    works: [{ file: 'Nicolas Poussin - Le Passage de la mer Rouge.jpg', title: 'The Crossing of the Red Sea', artist: 'Nicolas Poussin', year: 'c. 1634' }] },
  { id: 'golden-calf', title: 'The Golden Calf', book: 'Exodus', chapter: 32, verse: 19, passageLabel: 'Exodus 32:1–20',
    works: [{ search: 'Nicolas Poussin The Adoration of the Golden Calf National Gallery', title: 'The Adoration of the Golden Calf', artist: 'Nicolas Poussin', year: 'c. 1634' }] },
  { id: 'moses-ten-commandments', title: 'Moses and the Ten Commandments', book: 'Exodus', chapter: 34, verse: 29, passageLabel: 'Exodus 34:29–35',
    works: [{ file: 'Rembrandt - Moses with the Ten Commandments - Google Art Project.jpg', title: 'Moses with the Ten Commandments', artist: 'Rembrandt', year: '1659' }] },

  // ── Numbers ────────────────────────────────────────────────────────────────
  { id: 'brazen-serpent', title: 'The Bronze Serpent', book: 'Numbers', chapter: 21, verse: 9, passageLabel: 'Numbers 21:4–9',
    works: [{ search: 'Anthony van Dyck The Brazen Serpent Prado', title: 'The Brazen Serpent', artist: 'Anthony van Dyck', year: 'c. 1620' }] },

  // ── Judges ─────────────────────────────────────────────────────────────────
  { id: 'samson-and-delilah', title: 'Samson and Delilah', book: 'Judges', chapter: 16, verse: 19, passageLabel: 'Judges 16:4–22',
    works: [{ search: 'Rubens Samson and Delilah National Gallery', title: 'Samson and Delilah', artist: 'Peter Paul Rubens', year: 'c. 1609' }] },
  { id: 'blinding-of-samson', title: 'The Blinding of Samson', book: 'Judges', chapter: 16, verse: 21, passageLabel: 'Judges 16:21–31',
    works: [{ search: 'Rembrandt The Blinding of Samson Städel', title: 'The Blinding of Samson', artist: 'Rembrandt', year: '1636' }] },

  // ── Ruth ───────────────────────────────────────────────────────────────────
  { id: 'ruth-and-boaz', title: 'Ruth in the Field of Boaz', book: 'Ruth', chapter: 2, verse: 5, passageLabel: 'Ruth 2:1–13',
    works: [{ search: 'Julius Schnorr von Carolsfeld Ruth in Boaz field', title: 'Ruth in the Field of Boaz', artist: 'Julius Schnorr von Carolsfeld', year: '1828' }] },

  // ── 1 Samuel ───────────────────────────────────────────────────────────────
  { id: 'david-and-goliath', title: 'David and Goliath', book: '1 Samuel', chapter: 17, verse: 51, passageLabel: '1 Samuel 17:41–51',
    works: [{ file: 'Caravaggio - David with the Head of Goliath - Vienna.jpg', title: 'David with the Head of Goliath', artist: 'Caravaggio', year: 'c. 1607' }] },

  // ── 2 Samuel ───────────────────────────────────────────────────────────────
  { id: 'david-and-bathsheba', title: 'Bathsheba', book: '2 Samuel', chapter: 11, verse: 2, passageLabel: '2 Samuel 11:1–5',
    works: [{ search: 'Rembrandt Bathsheba at Her Bath Louvre', title: 'Bathsheba at Her Bath', artist: 'Rembrandt', year: '1654' }] },

  // ── 1 Kings ────────────────────────────────────────────────────────────────
  { id: 'judgment-of-solomon', title: 'The Judgment of Solomon', book: '1 Kings', chapter: 3, verse: 25, passageLabel: '1 Kings 3:16–28',
    works: [{ search: 'Nicolas Poussin The Judgment of Solomon Louvre', title: 'The Judgment of Solomon', artist: 'Nicolas Poussin', year: '1649' }] },
  { id: 'queen-of-sheba', title: 'The Queen of Sheba', book: '1 Kings', chapter: 10, verse: 2, passageLabel: '1 Kings 10:1–13',
    works: [{ search: 'Edward Poynter The Visit of the Queen of Sheba to King Solomon', title: 'The Visit of the Queen of Sheba to King Solomon', artist: 'Sir Edward Poynter', year: '1890' }] },

  // ── 2 Kings ────────────────────────────────────────────────────────────────
  { id: 'elijah-chariot-of-fire', title: 'Elijah Taken Up to Heaven', book: '2 Kings', chapter: 2, verse: 11, passageLabel: '2 Kings 2:1–12',
    works: [{ search: 'Giuseppe Angeli Elijah taken up in a chariot of fire', title: 'Elijah Taken Up in a Chariot of Fire', artist: 'Giuseppe Angeli', year: 'c. 1755' }] },

  // ── Job ─────────────────────────────────────────────────────────────────────
  { id: 'job', title: 'Job and His Comforters', book: 'Job', chapter: 2, verse: 13, passageLabel: 'Job 2:11–13',
    works: [{ search: 'William Blake Job Butts Satan Smiting Job with Boils', title: 'Satan Smiting Job with Boils', artist: 'William Blake', year: 'c. 1826' }] },

  // ── Isaiah ─────────────────────────────────────────────────────────────────
  { id: 'isaiah-vision', title: "Isaiah's Vision", book: 'Isaiah', chapter: 6, verse: 1, passageLabel: 'Isaiah 6:1–8',
    works: [{ search: 'Giovanni Battista Tiepolo Prophet Isaiah fresco', title: 'The Prophet Isaiah', artist: 'Giovanni Battista Tiepolo', year: 'c. 1729' }] },

  // ── Daniel ─────────────────────────────────────────────────────────────────
  { id: 'belshazzars-feast', title: "Belshazzar's Feast", book: 'Daniel', chapter: 5, verse: 5, passageLabel: 'Daniel 5:1–31',
    works: [{ search: "Rembrandt Belshazzar's Feast National Gallery", title: "Belshazzar's Feast", artist: 'Rembrandt', year: 'c. 1635' }] },
  { id: 'daniel-in-the-lions-den', title: "Daniel in the Lions' Den", book: 'Daniel', chapter: 6, verse: 16, passageLabel: 'Daniel 6:16–24',
    works: [{ search: "Rubens Daniel in the Lions' Den Washington", title: "Daniel in the Lions' Den", artist: 'Peter Paul Rubens', year: 'c. 1615' }] },

  // ── Jonah ──────────────────────────────────────────────────────────────────
  { id: 'jonah-and-the-fish', title: 'Jonah and the Great Fish', book: 'Jonah', chapter: 1, verse: 17, passageLabel: 'Jonah 1:11–2:10',
    works: [{ search: 'Pieter Lastman Jonah and the Whale', title: 'Jonah and the Whale', artist: 'Pieter Lastman', year: '1621' }] },

  // ── Esther ─────────────────────────────────────────────────────────────────
  { id: 'esther-before-the-king', title: 'Esther Before the King', book: 'Esther', chapter: 5, verse: 2, passageLabel: 'Esther 5:1–8',
    works: [{ search: 'Artemisia Gentileschi Esther before Ahasuerus Metropolitan', title: 'Esther before Ahasuerus', artist: 'Artemisia Gentileschi', year: 'c. 1628' }] },

  // ── Matthew / Luke — Nativity & childhood ──────────────────────────────────
  { id: 'annunciation', title: 'The Annunciation', book: 'Luke', chapter: 1, verse: 28, passageLabel: 'Luke 1:26–38',
    works: [
      { file: 'Henry Ossawa Tanner - The Annunciation.jpg', title: 'The Annunciation', artist: 'Henry Ossawa Tanner', year: '1898' },
      { search: 'Fra Angelico Annunciation Prado', title: 'The Annunciation', artist: 'Fra Angelico', year: 'c. 1426' },
    ] },
  { id: 'visitation', title: 'The Visitation', book: 'Luke', chapter: 1, verse: 41, passageLabel: 'Luke 1:39–56',
    works: [{ search: 'Pontormo Visitation Carmignano', title: 'The Visitation', artist: 'Jacopo Pontormo', year: 'c. 1529' }] },
  { id: 'nativity', title: 'The Nativity', book: 'Luke', chapter: 2, verse: 7, passageLabel: 'Luke 2:1–20',
    works: [{ file: 'Gerard van Honthorst - Adoration of the Shepherds (1622).jpg', title: 'Adoration of the Shepherds', artist: 'Gerrit van Honthorst', year: '1622' }] },
  { id: 'adoration-of-the-magi', title: 'The Adoration of the Magi', book: 'Matthew', chapter: 2, verse: 11, passageLabel: 'Matthew 2:1–12',
    works: [{ search: 'Gentile da Fabriano Adoration of the Magi Uffizi', title: 'Adoration of the Magi', artist: 'Gentile da Fabriano', year: '1423' }] },
  { id: 'flight-into-egypt', title: 'The Flight into Egypt', book: 'Matthew', chapter: 2, verse: 14, passageLabel: 'Matthew 2:13–15',
    works: [{ search: 'Caravaggio Rest on the Flight into Egypt', title: 'Rest on the Flight into Egypt', artist: 'Caravaggio', year: 'c. 1597' }] },
  { id: 'massacre-of-the-innocents', title: 'The Massacre of the Innocents', book: 'Matthew', chapter: 2, verse: 16, passageLabel: 'Matthew 2:16–18',
    works: [{ search: 'Guido Reni Massacre of the Innocents Bologna', title: 'The Massacre of the Innocents', artist: 'Guido Reni', year: '1611' }] },
  { id: 'presentation-in-the-temple', title: 'The Presentation in the Temple', book: 'Luke', chapter: 2, verse: 22, passageLabel: 'Luke 2:22–38',
    works: [{ search: 'Andrea Mantegna Presentation at the Temple Berlin', title: 'Presentation at the Temple', artist: 'Andrea Mantegna', year: 'c. 1455' }] },
  { id: 'christ-among-the-doctors', title: 'The Boy Jesus in the Temple', book: 'Luke', chapter: 2, verse: 46, passageLabel: 'Luke 2:41–52',
    works: [{ search: 'Duccio Christ among the Doctors Maestà', title: 'Christ among the Doctors', artist: 'Duccio di Buoninsegna', year: 'c. 1311' }] },

  // ── Ministry of Jesus ──────────────────────────────────────────────────────
  { id: 'baptism-of-jesus', title: 'The Baptism of Jesus', book: 'Matthew', chapter: 3, verse: 16, passageLabel: 'Matthew 3:13–17',
    works: [
      { file: 'Piero della Francesca - Battesimo di Cristo (National Gallery, London).jpg', title: 'The Baptism of Christ', artist: 'Piero della Francesca', year: 'c. 1450' },
      { search: 'Verrocchio Leonardo Baptism of Christ Uffizi', title: 'The Baptism of Christ', artist: 'Verrocchio & Leonardo', year: 'c. 1475' },
    ] },
  { id: 'temptation-of-christ', title: 'The Temptation of Christ', book: 'Matthew', chapter: 4, verse: 1, passageLabel: 'Matthew 4:1–11',
    works: [{ search: 'Ary Scheffer The Temptation of Christ', title: 'The Temptation of Christ', artist: 'Ary Scheffer', year: '1854' }] },
  { id: 'calling-of-matthew', title: 'The Calling of Matthew', book: 'Matthew', chapter: 9, verse: 9, passageLabel: 'Matthew 9:9–13',
    works: [{ search: 'Caravaggio The Calling of Saint Matthew Contarelli', title: 'The Calling of Saint Matthew', artist: 'Caravaggio', year: '1600' }] },
  { id: 'sermon-on-the-mount', title: 'The Sermon on the Mount', book: 'Matthew', chapter: 5, verse: 1, passageLabel: 'Matthew 5:1–12',
    works: [{ search: 'Carl Bloch Sermon on the Mount', title: 'The Sermon on the Mount', artist: 'Carl Bloch', year: '1877' }] },
  { id: 'wedding-at-cana', title: 'The Wedding at Cana', book: 'John', chapter: 2, verse: 7, passageLabel: 'John 2:1–11',
    works: [{ search: 'Paolo Veronese The Wedding at Cana Louvre', title: 'The Wedding at Cana', artist: 'Paolo Veronese', year: '1563' }] },
  { id: 'woman-at-the-well', title: 'The Woman at the Well', book: 'John', chapter: 4, verse: 7, passageLabel: 'John 4:1–26',
    works: [{ search: 'Guercino Christ and the Woman of Samaria at the well', title: 'Christ and the Woman of Samaria', artist: 'Guercino', year: 'c. 1640' }] },
  { id: 'calming-the-storm', title: 'Christ Calms the Storm', book: 'Mark', chapter: 4, verse: 39, passageLabel: 'Mark 4:35–41',
    works: [{ file: 'Rembrandt Christ in the Storm on the Lake of Galilee.jpg', title: 'Christ in the Storm on the Sea of Galilee', artist: 'Rembrandt', year: '1633' }] },
  { id: 'walking-on-water', title: 'Jesus Walks on Water', book: 'Matthew', chapter: 14, verse: 29, passageLabel: 'Matthew 14:22–33',
    works: [{ search: 'Ivan Aivazovsky Jesus walking on water', title: 'Walking on Water', artist: 'Ivan Aivazovsky', year: '1888' }] },
  { id: 'transfiguration', title: 'The Transfiguration', book: 'Matthew', chapter: 17, verse: 2, passageLabel: 'Matthew 17:1–13',
    works: [{ search: 'Raphael The Transfiguration Vatican', title: 'The Transfiguration', artist: 'Raphael', year: '1520' }] },
  { id: 'good-samaritan', title: 'The Good Samaritan', book: 'Luke', chapter: 10, verse: 33, passageLabel: 'Luke 10:25–37',
    works: [{ file: 'Vincent van Gogh - The Good Samaritan, 1890 - Google Art Project.jpg', title: 'The Good Samaritan (after Delacroix)', artist: 'Vincent van Gogh', year: '1890' }] },
  { id: 'mary-and-martha', title: 'In the House of Martha and Mary', book: 'Luke', chapter: 10, verse: 39, passageLabel: 'Luke 10:38–42',
    works: [{ search: 'Vermeer Christ in the House of Martha and Mary', title: 'Christ in the House of Martha and Mary', artist: 'Johannes Vermeer', year: 'c. 1655' }] },
  { id: 'raising-of-lazarus', title: 'The Raising of Lazarus', book: 'John', chapter: 11, verse: 43, passageLabel: 'John 11:1–44',
    works: [{ search: 'Sebastiano del Piombo The Raising of Lazarus National Gallery', title: 'The Raising of Lazarus', artist: 'Sebastiano del Piombo', year: 'c. 1519' }] },
  { id: 'return-of-the-prodigal-son', title: 'The Return of the Prodigal Son', book: 'Luke', chapter: 15, verse: 20, passageLabel: 'Luke 15:11–32',
    works: [{ file: 'Rembrandt Harmensz. van Rijn - The Return of the Prodigal Son.jpg', title: 'The Return of the Prodigal Son', artist: 'Rembrandt', year: 'c. 1668' }] },
  { id: 'woman-taken-in-adultery', title: 'The Woman Taken in Adultery', book: 'John', chapter: 8, verse: 7, passageLabel: 'John 8:1–11',
    works: [{ search: 'Bruegel Christ and the Woman Taken in Adultery', title: 'Christ and the Woman Taken in Adultery', artist: 'Pieter Bruegel the Elder', year: '1565' }] },

  // ── Passion Week ───────────────────────────────────────────────────────────
  { id: 'entry-into-jerusalem', title: 'The Entry into Jerusalem', book: 'Matthew', chapter: 21, verse: 8, passageLabel: 'Matthew 21:1–11',
    works: [{ search: 'Giotto Entry into Jerusalem Scrovegni', title: 'Entry into Jerusalem', artist: 'Giotto', year: 'c. 1305' }] },
  { id: 'cleansing-the-temple', title: 'Cleansing the Temple', book: 'Matthew', chapter: 21, verse: 12, passageLabel: 'Matthew 21:12–17',
    works: [{ search: 'El Greco Christ Driving the Money Changers from the Temple', title: 'Christ Driving the Money Changers from the Temple', artist: 'El Greco', year: 'c. 1600' }] },
  { id: 'last-supper', title: 'The Last Supper', book: 'John', chapter: 13, verse: 21, passageLabel: 'John 13:21–30',
    works: [{ file: 'Leonardo da Vinci (1452-1519) - The Last Supper (1495-1498).jpg', title: 'The Last Supper', artist: 'Leonardo da Vinci', year: '1495–1498' }] },
  { id: 'washing-of-feet', title: 'Washing the Disciples’ Feet', book: 'John', chapter: 13, verse: 5, passageLabel: 'John 13:1–17',
    works: [{ search: 'Tintoretto Christ Washing the Feet of the Disciples Prado', title: 'Christ Washing the Disciples’ Feet', artist: 'Tintoretto', year: 'c. 1548' }] },
  { id: 'agony-in-the-garden', title: 'The Agony in the Garden', book: 'Matthew', chapter: 26, verse: 39, passageLabel: 'Matthew 26:36–46',
    works: [{ search: 'Andrea Mantegna The Agony in the Garden National Gallery', title: 'The Agony in the Garden', artist: 'Andrea Mantegna', year: 'c. 1460' }] },
  { id: 'taking-of-christ', title: 'The Arrest of Christ', book: 'Matthew', chapter: 26, verse: 48, passageLabel: 'Matthew 26:47–56',
    works: [{ file: 'Caravaggio - Taking of Christ - Dublin.jpg', title: 'The Taking of Christ', artist: 'Caravaggio', year: '1602' }] },
  { id: 'peter-denies-christ', title: 'Peter Denies Christ', book: 'Matthew', chapter: 26, verse: 74, passageLabel: 'Matthew 26:69–75',
    works: [{ search: 'Rembrandt The Denial of Saint Peter Rijksmuseum', title: 'The Denial of Saint Peter', artist: 'Rembrandt', year: '1660' }] },
  { id: 'christ-before-pilate', title: 'Christ Before Pilate', book: 'John', chapter: 18, verse: 37, passageLabel: 'John 18:28–40',
    works: [{ search: 'Munkácsy Christ before Pilate', title: 'Christ before Pilate', artist: 'Mihály Munkácsy', year: '1881' }] },
  { id: 'ecce-homo', title: 'Ecce Homo', book: 'John', chapter: 19, verse: 5, passageLabel: 'John 19:1–7',
    works: [{ search: 'Antonio Ciseri Ecce Homo', title: 'Ecce Homo', artist: 'Antonio Ciseri', year: 'c. 1871' }] },
  { id: 'crown-of-thorns', title: 'The Crowning with Thorns', book: 'Matthew', chapter: 27, verse: 29, passageLabel: 'Matthew 27:27–31',
    works: [{ search: 'Caravaggio Crowning with Thorns Vienna', title: 'The Crowning with Thorns', artist: 'Caravaggio', year: 'c. 1603' }] },
  { id: 'carrying-the-cross', title: 'Christ Carrying the Cross', book: 'John', chapter: 19, verse: 17, passageLabel: 'John 19:16–17',
    works: [{ search: 'El Greco Christ Carrying the Cross Metropolitan', title: 'Christ Carrying the Cross', artist: 'El Greco', year: 'c. 1580' }] },
  { id: 'crucifixion', title: 'The Crucifixion', book: 'John', chapter: 19, verse: 18, passageLabel: 'John 19:16–30',
    works: [
      { file: 'Diego Velázquez 060.jpg', title: 'Christ Crucified', artist: 'Diego Velázquez', year: 'c. 1632' },
      { file: 'Matthias Grünewald - The Crucifixion - WGA10723.jpg', title: 'The Crucifixion (Isenheim Altarpiece)', artist: 'Matthias Grünewald', year: 'c. 1512–1516' },
    ] },
  { id: 'descent-from-the-cross', title: 'The Descent from the Cross', book: 'John', chapter: 19, verse: 40, passageLabel: 'John 19:38–42',
    works: [{ search: 'Rogier van der Weyden Descent from the Cross Prado', title: 'The Descent from the Cross', artist: 'Rogier van der Weyden', year: 'c. 1435' }] },
  { id: 'lamentation', title: 'The Lamentation', book: 'Matthew', chapter: 27, verse: 59, passageLabel: 'Matthew 27:57–61',
    works: [{ search: 'Andrea Mantegna Lamentation over the Dead Christ Brera', title: 'The Lamentation over the Dead Christ', artist: 'Andrea Mantegna', year: 'c. 1480' }] },
  { id: 'entombment', title: 'The Entombment', book: 'Mark', chapter: 15, verse: 46, passageLabel: 'Mark 15:42–47',
    works: [{ search: 'Caravaggio The Entombment of Christ Vatican', title: 'The Entombment of Christ', artist: 'Caravaggio', year: 'c. 1603' }] },

  // ── Resurrection & after ───────────────────────────────────────────────────
  { id: 'resurrection', title: 'The Resurrection', book: 'Matthew', chapter: 28, verse: 6, passageLabel: 'Matthew 28:1–10',
    works: [{ file: 'Piero della Francesca - Resurrection - WGA17609.jpg', title: 'The Resurrection', artist: 'Piero della Francesca', year: 'c. 1463' }] },
  { id: 'noli-me-tangere', title: 'Noli Me Tangere', book: 'John', chapter: 20, verse: 17, passageLabel: 'John 20:11–18',
    works: [{ search: 'Titian Noli me Tangere National Gallery', title: 'Noli me Tangere', artist: 'Titian', year: 'c. 1514' }] },
  { id: 'road-to-emmaus', title: 'The Supper at Emmaus', book: 'Luke', chapter: 24, verse: 30, passageLabel: 'Luke 24:13–35',
    works: [{ search: 'Caravaggio Supper at Emmaus National Gallery London', title: 'The Supper at Emmaus', artist: 'Caravaggio', year: '1601' }] },
  { id: 'doubting-thomas', title: 'The Incredulity of Thomas', book: 'John', chapter: 20, verse: 27, passageLabel: 'John 20:24–29',
    works: [{ search: 'Caravaggio The Incredulity of Saint Thomas', title: 'The Incredulity of Saint Thomas', artist: 'Caravaggio', year: 'c. 1602' }] },
  { id: 'ascension', title: 'The Ascension', book: 'Acts', chapter: 1, verse: 9, passageLabel: 'Acts 1:6–11',
    works: [{ search: 'Rembrandt The Ascension of Christ Munich', title: 'The Ascension of Christ', artist: 'Rembrandt', year: '1636' }] },
  { id: 'pentecost', title: 'Pentecost', book: 'Acts', chapter: 2, verse: 3, passageLabel: 'Acts 2:1–13',
    works: [{ search: 'El Greco Pentecost Prado', title: 'Pentecost', artist: 'El Greco', year: 'c. 1600' }] },
  { id: 'conversion-of-paul', title: 'The Conversion of Paul', book: 'Acts', chapter: 9, verse: 4, passageLabel: 'Acts 9:1–19',
    works: [{ search: 'Caravaggio Conversion on the Way to Damascus Cerasi', title: 'The Conversion on the Way to Damascus', artist: 'Caravaggio', year: '1601' }] },

  // ── Revelation ─────────────────────────────────────────────────────────────
  { id: 'four-horsemen', title: 'The Four Horsemen', book: 'Revelation', chapter: 6, verse: 2, passageLabel: 'Revelation 6:1–8',
    works: [{ search: 'Albrecht Dürer The Four Horsemen of the Apocalypse woodcut', title: 'The Four Horsemen of the Apocalypse', artist: 'Albrecht Dürer', year: '1498' }] },
  { id: 'st-michael-and-the-dragon', title: 'War in Heaven', book: 'Revelation', chapter: 12, verse: 7, passageLabel: 'Revelation 12:7–9',
    works: [{ search: 'Dürer Saint Michael Fighting the Dragon Apocalypse', title: 'Saint Michael Fighting the Dragon', artist: 'Albrecht Dürer', year: '1498' }] },
];
