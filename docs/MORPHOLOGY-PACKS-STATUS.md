# Morphology Packs Status

## Overview
Complete morphology system with 3 packs covering Greek NT, Greek LXX, and Hebrew OT - totaling over 1 million words with full linguistic annotations.

## Pack Details

### 1. Greek New Testament (OpenGNT)
**File**: `packs/opengnt-morphology.sqlite` (135.28 MB)
- **Translation ID**: `OPENGNT`
- **Verses**: 7,941
- **Words**: 138,020
- **Coverage**: 100% complete

**Features**:
- RMAC morphology codes (e.g., V-AAI-3S = Verb-Aorist-Active-Indicative-3rd-Singular)
- Strong's G-numbers for all words
- English glosses from Strong's dictionary
- Transliterations (e.g., Χριστός → Christos)
- Louw-Nida semantic domains
- Greek lemmas (lexical forms)
- **RIID** (Reverse Interlinear IDs) - hover English to see Greek
- English reverse interlinear text

**Metadata**:
```
language: grc (Ancient Greek - Koine)
features: morphology,lemma,strongs,glosses,transliteration,louw-nida,riid,reverse-interlinear
license: CC BY-SA 4.0
attribution: OpenGNT Project (https://github.com/eliranwong/OpenGNT)
```

**Sample** (John 1:1):
```
εν (ἐν) G1722 "in/on/among" - P- [93.169]
αρχη (ἀρχή) G0746 "beginning/ruler" - N-DSF [67.65]
ην (εἰμί) G1510 "to be/exist" - V-IIA-3S [13.1]
ο (ὁ) G3588 "the/this/who" - RA-NSM [92.24]
λογος (λόγος) G3056 "word/matter" - N-NSM [33.98]
```

---

### 2. Greek Septuagint (LXX)
**File**: `packs/lxx-greek.sqlite` (179.37 MB)
- **Translation ID**: `LXX`
- **Verses**: 30,302
- **Words**: 617,508
- **Strong's Coverage**: 86.5% (533,994 words)

**Features**:
- Greek lemmas for all words (100% coverage)
- Strong's G-numbers (86.5% coverage)
  - NT Strong's: G1-G5624
  - LXX Strong's: G6100-G9979 (for words unique to LXX)
- English glosses from Strong's dictionary (7,850 unique entries)
- **RIID** (Reverse Interlinear IDs)
- English reverse interlinear text
- 59 books (full LXX canon including deuterocanonical books)

**Books Included**:
- **Torah**: Genesis, Exodus, Leviticus, Numbers, Deuteronomy
- **Historical**: Joshua (A/B), Judges (A/B), Ruth, 1-2 Samuel, 1-2 Kings, 1-2 Chronicles, 1-2 Esdras, 1-4 Maccabees, Judith, Tobit (BA/S), Esther
- **Wisdom**: Job, Psalms, Psalms of Solomon, Proverbs, Ecclesiastes, Song of Solomon, Wisdom of Solomon, Sirach
- **Prophets**: Isaiah, Jeremiah, Lamentations, Baruch, Epistle of Jeremiah, Ezekiel, Daniel (OG/Th), Hosea, Joel, Amos, Obadiah, Jonah, Micah, Nahum, Habakkuk, Zephaniah, Haggai, Zechariah, Malachi
- **Other**: Odes, Susanna (OG/Th), Bel (OG/Th)

**Metadata**:
```
language: grc (Ancient Greek - Koine)
features: morphology,lemma,strongs,glosses,riid,reverse-interlinear
license: CC BY-SA 4.0
attribution: Open Scriptures Hebrew Bible Project. Greek Septuagint with lemmas.
```

**Coverage Notes**:
- 86.5% Strong's coverage is excellent for the LXX
- Unmapped words (13.5%) are typically:
  - Inflected forms not in STEPBible lexicon
  - Proper nouns (names, places)
  - LXX-specific vocabulary
  - Hebrew transliterations

**Sample** (Genesis 1:1):
```
εν (ἐν) G1722 "in/on/among"
αρχη (ἀρχή) G0746 "beginning"
ποιεω (ποιέω) - "to make/do" [no Strong's - LXX-specific verb form]
ο (ὁ) G3588 "the/this/who"
θεος (θεός) G2316 "God"
ο (ὁ) G3588 "the/this/who"
ουρανος (οὐρανός) G3772 "heaven"
και (καί) G2532 "and"
ο (ὁ) G3588 "the/this/who"
γη (γῆ) - "earth/land" [no Strong's - genitive form]
```

---

### 3. Hebrew Old Testament (OSHB)
**File**: `packs/hebrew-oshb.sqlite` (104.77 MB)
- **Translation ID**: `HEBREW`
- **Verses**: 23,213
- **Words**: 305,028
- **Coverage**: 100% complete

**Features**:
- OSHM (Open Scriptures Hebrew Morphology) codes
- Strong's H-numbers for all words
- English glosses from Strong's dictionary (8,632 unique entries)
- Hebrew lemmas (lexical forms)
- **RIID** (Reverse Interlinear IDs)
- English reverse interlinear text

**Metadata**:
```
language: hbo (Ancient Hebrew - Biblical)
features: morphology,lemma,strongs,glosses,riid,reverse-interlinear
license: CC BY 4.0
attribution: Open Scriptures Hebrew Bible (OSHB). Full morphology.
```

**Sample** (Genesis 1:1):
```
בראשׁית (רֵאשִׁית) H7225 "first: best"
ברא (בָּרָא) H1254 "to fatten"
אלהים (אֱלֹהִים) H0430 "(Gibeath)-elohim"
את (אֵת) H0853 "[Obj.]"
השׁמים (שָׁמַיִם) H8064 "heaven"
ואת (אֵת) H0853 "[Obj.]"
הארץ (אֶרֶץ) H0776 "land: soil"
```

---

## Technical Implementation

### Database Schema
Each pack contains:
- **metadata** table: Pack metadata (translation_id, name, features, license)
- **verses** table: Verse text by book/chapter/verse
- **words** table: Individual words with morphology
  - `id, book, chapter, verse, word_order`
  - `text` (original Greek/Hebrew)
  - `lemma` (lexical form)
  - `strongs` (Strong's number: G#### or H####)
  - `morph_code` (morphology code: RMAC for Greek, OSHM for Hebrew)
  - `gloss_en` (English gloss from Strong's dictionary)
  - `transliteration` (Greek NT only)
  - `louwNida` (Greek NT only - semantic domain)
- **english_verses** table: English reverse interlinear text
- **riid_map** table: Maps English word positions to original word order
  - Enables hover-to-see-original functionality

### Reverse Interlinear IDs (RIID)
The RIID system allows mapping English translations back to original language words:

1. **english_verses** table contains English text built from glosses:
   ```
   Genesis 1:1 → "first: best to fatten (Gibeath)-elohim [Obj.] heaven [Obj.] land: soil"
   ```

2. **riid_map** table links positions:
   ```
   english_word_pos=1 ("first:") → original_word_order=1 (בראשׁית)
   english_word_pos=2 ("best") → original_word_order=1 (בראשׁית)
   english_word_pos=3 ("to") → original_word_order=2 (ברא)
   ```

3. **Hover functionality**: When user hovers over English word, lookup `riid_map` to find original word, then display full morphology details.

### Build Process
All packs built using custom scripts:
1. **build-morphology-packs.mjs** - Greek NT from OpenGNT CSV
2. **build-lxx-morphology.mjs** - Greek LXX from Open Scriptures lemmas
3. **build-hebrew-morphology.mjs** - Hebrew OT from OSHB XML
4. **map-lxx-strongs.mjs** - Map LXX lemmas to Strong's G-numbers
5. **add-strongs-glosses.mjs** - Add English glosses from STEPBible lexicons
6. **add-reverse-interlinear.mjs** - Generate RIID mappings

### Strong's Dictionary Integration
Using STEPBible lexicons:
- **TBESG** (Translators Brief Extended Strong's for Greek): 11,849 entries
  - G1-G5624: Original Strong's for NT
  - G6100-G9979: Extended numbers for LXX words not in NT
- **TBESH** (Translators Brief Extended Strong's for Hebrew): 10,930 entries
  - H0001-H8674: Original Strong's for Hebrew
  - Extended for names and variants

### License Summary
All packs use open Creative Commons licenses:
- **Greek NT**: CC BY-SA 4.0 (OpenGNT)
- **Greek LXX**: CC BY-SA 4.0 (Open Scriptures)
- **Hebrew OT**: CC BY 4.0 (OSHB)
- **Strong's Lexicons**: CC BY 4.0 (STEPBible)

---

## Statistics Summary

| Pack | Translation ID | Words | Verses | Books | Strong's Coverage | File Size |
|------|---------------|-------|--------|-------|------------------|-----------|
| Greek NT | OPENGNT | 138,020 | 7,941 | 27 | 100% | 135.28 MB |
| Greek LXX | LXX | 617,508 | 30,302 | 59 | 86.5% | 179.37 MB |
| Hebrew OT | HEBREW | 305,028 | 23,213 | 39 | 100% | 104.77 MB |
| **TOTAL** | - | **1,060,556** | **61,456** | **125** | **94.1%** | **419.42 MB** |

---

## Future Enhancements

### Potential Additions
- [ ] Morphology parsing codes (full textual descriptions)
- [ ] Part-of-speech tagging (standardized)
- [ ] Syntactic tree relationships (clause structure)
- [ ] Hebrew vowel points and accents
- [ ] Greek accent marks preservation
- [ ] Cross-references to BDAG/LSJ lexicons
- [ ] Semantic role labeling
- [ ] Discourse markers

### UI Implementation Needed
- [ ] Morphology hover tooltip component
- [ ] Reverse interlinear hover (English → Original)
- [ ] Strong's dictionary popup
- [ ] Morphology code explanations
- [ ] Word frequency charts
- [ ] Lemma search across translations
- [ ] Advanced morphological filtering

---

## Resources

### Source Data
- **OpenGNT**: https://github.com/eliranwong/OpenGNT
- **Open Scriptures LXX**: https://github.com/openscriptures/GreekResources
- **OSHB**: https://github.com/openscriptures/morphhb
- **STEPBible**: https://github.com/STEPBible/STEPBible-Data

### Documentation
- **RMAC Morphology**: Robinson's Morphological Analysis Codes
- **Louw-Nida**: Greek-English Lexicon of the NT Based on Semantic Domains
- **Strong's Concordance**: Numeric index to original language words
- **OSHB Morphology**: Open Scriptures Hebrew Bible morphology codes

### Related Projects
- **unfoldingWord Hebrew Grammar**: https://git.door43.org/unfoldingWord/en_uhg
- **CATSS**: Computer Assisted Tools for Septuagint Studies
- **MorphGNT**: Morphologically analyzed Greek New Testament
- **Apostolic Bible Polyglot**: LXX with Strong's numbers

---

## Credits

Built for **ProjectBible** by combining:
1. OpenGNT (Eliran Wong) - Greek NT with full morphology
2. Open Scriptures (Robert Rouse) - LXX lemmas and Hebrew morphology
3. STEPBible (Tim Cartwright) - Strong's dictionary glosses
4. Custom integration scripts - RIID system and pack building

**Last Updated**: 2026-01-06
**Pack Version**: 1.0
**Total Development Time**: ~8 hours
