# ProjectBible — Feature Reference

Exhaustive engineering record of every feature in `apps/pwa-polished`. Same tree as [FEATURES.md](FEATURES.md), but each leaf adds the settings key, default value, shortcut or gesture, and the source file it lives in.

All paths are relative to `apps/pwa-polished/`.

Features are named by **exported symbol and file path**, not by line number. Line numbers were tried and did not survive: they were correct when written and almost entirely wrong three weeks later. A symbol name is one grep away and stays true across refactors.

**Contents**

1. [Reading the Bible](#1-reading-the-bible)
2. [Getting Around](#2-getting-around)
3. [Translations](#3-translations)
4. [Interlinear (Greek & Hebrew)](#4-interlinear-greek--hebrew)
5. [Word Study](#5-word-study)
6. [Bible Encyclopedia](#6-bible-encyclopedia-isbe)
7. [Commentaries](#7-commentaries)
8. [Cross-References](#8-cross-references)
9. [Search](#9-search)
10. [Highlights & Notes](#10-highlights--notes)
11. [Repeated Words](#11-repeated-words)
12. [Journal](#12-journal)
13. [Reading Plans & Progress](#13-reading-plans--progress)
14. [Maps & Places](#14-maps--places)
15. [Art](#15-art)
16. [Read Aloud](#16-read-aloud-tts)
17. [Audio (retired)](#17-audio)
18. [Panes & Windows](#18-panes--windows)
19. [Content Packs](#19-content-packs)
20. [Account & Sync](#20-account--sync)
21. [App Settings & Appearance](#21-app-settings--appearance)
22. [Wake Alarm](#22-wake-alarm)
23. [The Study Library](#23-the-study-library)
24. [Nave's Topical Bible](#24-naves-topical-bible)
25. [People](#25-people)
26. [Notes & Notebooks](#26-notes--notebooks)

---

## 1. Reading the Bible

Primary file: `src/components/BibleReader.svelte` (~5,280 lines — the largest component in the app; it owns the reading surface, verse rendering, selection, highlighting, and infinite scroll).

### 1.1 The reading page

| Feature | Detail |
|---|---|
| Continuous scrolling | Chapters append as you scroll in either direction. The reader holds an array of loaded chapters rather than one chapter at a time. `BibleReader.svelte` |
| Scroll-driven nav sync | Updates book/chapter in the nav store as you scroll, deliberately without setting `scrollTargetVerse` — setting it would trigger an auto-scroll that fights the user. `navigationStore.setScrollPosition()`, `src/stores/navigationStore.ts` |
| Verse layout | Setting `verseLayout`, default `'one-per-line'`. Values: `'one-per-line'`, `'paragraph'`, `'paragraph-no-verse-numbers'`. Applied as CSS classes `.paragraph-layout` / `.nonumber-layout` at `BibleReader.svelte`. Read at `BibleReader.svelte`. |
| Word wrap | Setting `wordWrap`, default `true`. `src/components/panes/SettingsPane.svelte` |
| Position persistence | Translation, book, chapter, and panel toggles persisted to `localStorage` under `projectbible_nav`. `src/stores/navigationStore.ts` |
| First-launch default | `WEB`, John 1. `src/stores/navigationStore.ts` |

### 1.2 What appears in the text

All text rendering runs through `renderVerseHtml()` in `src/lib/verseRendering.ts`.

| Feature | Detail |
|---|---|
| Red-letter | Setting `showRedLetter`, default `true`. Spans loaded lazily from `/red-letter-spans.json`, keyed `{transId: {"BOOK:CH:V": [{s,e}]}}`; network failure degrades silently. Rendered via `\x02`/`\x03` sentinels into `.red-letter`. Theme-specific colors — dark `#FF3F3F`, light `#CC0000`, sepia `#FF2020` — set in `src/App.svelte`, which re-applies the parent invert filter so the light/sepia theme filter doesn't bleach the red. `BibleReader.svelte` |
| Section headings | Setting `showSectionHeadings`, default `true`. Extracted from the leading `+ Heading. ` marker in stored verse text by `extractHeading()`, `verseRendering.ts` — a leading run that *is* `\x01`-terminated is a note, not a heading, and is left alone. Rendered at `BibleReader.svelte`. Level 3 is the Psalm 119 acrostic labels (`\qa` ALEPH, BETH…) from the headings pack. **No UI toggle exists** — see [Known gaps](#known-gaps). |
| Footnotes | Stored as `+ note text` runs terminated by a `\x01` sentinel. Rendered as `<sup class="inline-note inline-footnote">[n]</sup>` in `#6699ff`. `renderTextWithInlineNotes()`, `verseRendering.ts` |
| Cross-reference markers | Same mechanism, rendered grey `#ccc` with class `.inline-xref`. Classified by `isCrossReference()`, `verseRendering.ts` — a note counts as a cross-reference if it contains a `\d+:\d+` token and does *not* begin with a wording-note starter (`Or`, `Lit`, `I.e.`, `That is`, `Some manuscripts`, `Gr.`, `Gk.`, `Heb.`, `Aram.`, `Lat.`). |
| Note-boundary detection | `findNoteEnd()`, `verseRendering.ts` — the `\x01` sentinel *is* the boundary; it is read, never inferred. Shared by the HTML renderer, the preview cleaner and the read-aloud extractor so the three can never disagree. A `+` run with no terminator is rendered verbatim as text: guessing a boundary from prose is what used to swallow scripture, so the fix is in the pack builders, not here. |
| Poetic lines | `\x11` opens a poetic line, `\x12` an indented one, `\x10` a stanza break (verse-initial only). Deliberately not `\x0B`/`\x0C`, which JS treats as whitespace and `trim()` would eat. A marker leading the verse becomes `.poetry-1`/`.poetry-2`/`.stanza-break` on the verse element via `verseStructure()`; mid-verse markers become `<br>` in `renderVerseHtml()`. The joining space is stored *beside* the marker, so stripping the markers reproduces marker-less text exactly and no character offset (highlights, TTS glow, red-letter spans) shifts. Written by `build-bsb-pack.mjs` and `packtools/parsers/usfm-parser.mjs`. |
| Plural "you" | LXX2012 carries a bare `⌃` meaning the preceding "you" is plural. Rendered as `<sup class="plural-marker">[pl]</sup>`; dropped from previews and read-aloud. |
| Bold / italic | `<b>` and `<i>` preserved from pack text via `extractFormattingSpans()`, `verseRendering.ts`, using `\x04`–`\x07` sentinels. All other HTML tags stripped. Coexists with red-letter spans (e.g. NET Matthew 4:4). |
| Art icons | Setting `showArt`, default `true`. Scene map keyed `"book:chapter:verse"`, rebuilt per rendered chapter set. `BibleReader.svelte`; see [15. Art](#15-art). |
| Place-name underlines | Setting `showPlaceMarkers`, default `false`. Requires the ISBE pack. Only multi-word phrases are marked (`is_phrase = 1` rows in `isbe_place_names`) — single words would be noise. `src/lib/placeMarkerRenderer.ts` |
| Repeat/marker coexistence | `placeMarkerRenderer` only wraps runs of pure text and skips nodes already inside a repeat or marker span. Apply order is always repeats first, then markers, so neither system can corrupt the other. `placeMarkerRenderer.ts`, `applyPlaceMarkersToAllSections()` |
| Themed titles | Setting `themedTitles`, default `true`. Category-colored 3D shadow on reader titles/headings. |
| Category mascot colors | Category → color map in `BibleReader.svelte`, kept in sync with the nav dropdown colors in `src/lib/bibleData.ts`. |

### 1.3 Book introductions

`src/components/BookIntroPanel.svelte` (312 lines). Props `open`, `book`.

Navigating away from the panel sets a flag so Back reopens it; a separate flag suppresses auto-reopen when the navigation came from the panel itself. `BibleReader.svelte`.

### 1.4 Book of Enoch

`src/lib/enochBooks.ts`. Two editions, lazily loaded per author id:

- `enoch:charles` — "Robert Henry Charles, 1917 (Book of Enoch)"
- `enoch:laurence` — "Richard Laurence, 1821 (Book of Enoch)"

Chapters carry a printed `label` (e.g. "Chapter 72" / "Chapter LXXII") plus `headings[]`. Helpers: `isEnochAuthor()`, `enochLabelFor()`, `loadEnoch()`.

## 2. Getting Around

Primary files: `src/stores/navigationStore.ts`, `src/components/NavigationBar.svelte` (2,101 lines), `src/lib/bibleData.ts`, `src/lib/parseRefString.ts`.

### 2.1 The book and chapter picker

- 66 books defined in `BIBLE_BOOKS`, `src/lib/bibleData.ts`.
- Ten categories with both colors (`CATEGORY_COLORS`) and display labels (`CATEGORY_LABELS`): `pentateuch` `#a67c52` Pentateuch, `historical` `#6ca0dc` Historical, `wisdom` `#f0c040` Wisdom, `major-prophets` `#5c1e99` Major Prophets, `minor-prophets` `#a45be9` Minor Prophets, `gospels` `#fc345c` Gospels, `acts` `#ff6520` Acts, `pauline` `#6048cc` Pauline Epistles, `general` `#f2893e` General Epistles, `revelation` `#61f1ff` Eschaton.
- `getBookColor()` falls back to neutral grey for unknown books.
- Chapter counts from `getBookChapters()`; the picker renders a chapter grid, `NavigationBar.svelte`.
- Book list filtered by translation scope via `getAvailableBooks()`.

### 2.2 Moving between passages

| Feature | Detail |
|---|---|
| Back | `navigationStore.goBack()`. History is a separate `navigationHistory` writable; `canGoBack` derived store gates the button. Toolbar button at `NavigationBar.svelte`. When the back button is active the navbar is fully hidden in the main reader (`BibleReader.svelte`). |
| Link navigation + mark | `navigationStore.navigateToVerse()` sets `linkHighlight` (book + chapter + verse), and `lib/verseHighlight.ts` paints the target in its book's category color. Fires only once the target chapter is in the DOM, so a cross-book jump marks the new chapter rather than the old one still on screen. Not consumed on use — leaving and returning shows it again. |
| Plain navigation | `navigationStore.navigateTo()` — marks the landing verse by default. Pass `highlight: false` only when the caller paints its own, which the reading plan does. |
| Where the mark goes | Measured from the verse's first line box via `Range.getClientRects()`, re-measured on reflow and after webfonts load, so any typeface, size, spacing or paragraph layout lands correctly. All lookups are scoped to a chapter section — the reader mounts several chapters at once and `data-verse` is only unique within one. |
| Colors | Reading plan keeps green (start) and brown (end of day). Everything else uses the target book's `CATEGORY_COLORS` entry, identical in shape, size and opacity — hue is the only difference. |
| TSK reference parsing | `parseRefString(ref, contextBook, contextChapter)`, `src/lib/parseRefString.ts`. Handles `"Ex 20:21"`, `"Am 5:18-20"` (range → first verse), `"3:14,15"`, `"8:22"`, and bare `"10,31"` relative to context. |
| OSIS reference parsing | `parseOsisRef()`, `parseRefString.ts` — e.g. `"Gen.2.4"`, `"1John.4.9-1John.4.10"`. |
| Abbreviation table | Lower-cased KJV/TSK abbreviation → canonical book name, `parseRefString.ts`. Separate alias table `BOOK_NAME_ALIASES` at `bibleData.ts`, applied by `normalizeBookName()` on every `setBook`/`navigateTo`. |
| Reading session | `src/stores/readingSessionStore.ts`. `src/stores/harmonyNavStore.ts` is a backwards-compatibility re-export only — it exports `readingSessionStore` under the old `harmonyNavStore` name. |
| Chronological mode | `isChronologicalMode` flag on `NavigationState`, with `setChronologicalMode()`; persisted. **No UI control found** — see [Known gaps](#known-gaps). |

## 3. Translations

| Feature | Detail |
|---|---|
| Picker | `NavigationBar.svelte` (button) (`selectTranslation`). Available list in `availableTranslations` writable, `navigationStore.ts`. |
| Translation scope | `TRANSLATION_SCOPES` map, `bibleData.ts`; type `TranslationScope = 'full' \| 'nt-only' \| 'ot-only'`. Resolved by `getTranslationScope()`. |
| Book-availability fallback | `getFirstAvailableBook()`, `bibleData.ts`. On translation switch the reader verifies the current book exists in the new translation and falls back if not — `BibleReader.svelte`. |
| Daily drivers | Six settings keys: `dailyDriverEnglishOT`, `dailyDriverEnglishNT`, `dailyDriverHebrewOT`, `dailyDriverHebrewNT`, `dailyDriverGreekOT`, `dailyDriverGreekNT`. No defaults; `getDailyDriverFor()` falls back to `'kjv'`. |
| Testament resolution | `getDailyDriverFor(book)`, `src/adapters/settings.ts`. OT books listed inline. OT preference order: Hebrew OT → Greek OT → English OT → legacy English → `'kjv'`. NT order: Greek NT → Hebrew NT → English NT → legacy English → `'kjv'`. |
| Primary driver | `getPrimaryDailyDriver()`, `settings.ts`. Prefers an OT-capable English driver because the UI initializes at Genesis. |
| Legacy migration | `normalizeSettings()`, `settings.ts` — migrates the older 3-field model (`dailyDriverEnglish` / `dailyDriverHebrew` / `dailyDriverGreek`) into the OT/NT model on read. English fans out to both OT and NT; Hebrew maps to OT; Greek maps to NT. |

## 4. Interlinear (Greek & Hebrew)

Files: `src/components/InterlinearControls.svelte` (254 lines), settings in `src/adapters/settings.ts`, reader state at `BibleReader.svelte`.

`InterlinearControls` is used in two contexts, driven by two props:

- `showEnableToggle` (default `true`) — shows the master enable checkbox. Set `false` in the navbar popover, where the header button already owns `enabled`; in that case `persist()` strips `enabled` before writing so it can't clobber a fresher value. `InterlinearControls.svelte`
- `showPreview` (default `true`) — on in Settings, off in the compact navbar popover (the live reader text behind it already shows the effect).

Persisting dispatches a `settingsUpdated` window event; the reader re-reads settings and re-renders on it (`BibleReader.svelte`).

### 4.1 Settings keys

Interface `InterlinearSettings`, `settings.ts`. Resolved with defaults by `getInterlinearSettings()`, written by `updateInterlinearSettings()`.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master on/off. Only applies when a Greek/Hebrew translation is open. |
| `preset` | `'minimal'` | `'minimal' \| 'study' \| 'scholar' \| 'custom'` |
| `showGloss` | `true` | English equivalent. Checkbox is rendered `disabled` — always on. `InterlinearControls.svelte` |
| `showTranslit` | `false` | Transliteration / pronunciation |
| `showLemma` | `false` | Dictionary (lexical) form |
| `showStrongs` | `false` | Strong's number |
| `showParsing` | `false` | Morphology / part-of-speech |

### 4.2 Presets

`INTERLINEAR_PRESETS`, `settings.ts`:

| Preset | gloss | translit | lemma | strongs | parsing |
|---|---|---|---|---|---|
| minimal | ✓ | | | | |
| study | ✓ | | | ✓ | |
| scholar | ✓ | ✓ | ✓ | ✓ | ✓ |

`'custom'` is never stored by a preset button — `detectPreset()` (`InterlinearControls.svelte`) compares the current layer combination against all three presets after every manual toggle and falls through to `'custom'`.

### 4.3 Layer styling

Rendered as a vertical `inline-flex` stack per word. Colors: original `#f0f0f0`, gloss `#cfe3ff`, transliteration `#b0b0b0` italic, lemma `#e3cd96`, parsing `#9aa0a6`, Strong's `#93c69a`. `InterlinearControls.svelte`.

The preview block uses fixed `line-height: 1.15` and `font-size: 21px` with `em`-relative layer sizes, deliberately independent of `--base-font-size` / `--line-spacing` so it can't be distorted by the user's reading settings. `InterlinearControls.svelte`. Sample phrase is John 1:1a.

## 5. Word Study

Files: `src/components/LexicalModal.svelte` (2,215 lines), `src/adapters/lexicon-lookup.ts` (1,192 lines), `src/lib/morphologyExpander.ts` (467 lines), `src/adapters/LexiconStore.ts`, `src/stores/lexicalModalStore.ts`.

### 5.1 Modal structure

State `activeTab: "definition" | "occurrences" | "related"`, `LexicalModal.svelte`. Two distinct tab strips are rendered depending on whether the subject is an English word or a Strong's entry:

- **English word** — Definition, Related. No Occurrences tab.
- **Strong's entry** — Definition, Occurrences, Related.

Guard at: `if (isEnglishWord && activeTab === "occurrences") activeTab = "definition"` — prevents a blank body when a leftover Occurrences tab carries into the English-word view. Tab resets to `"definition"` on open.

Lazy loads: occurrences fetched only when the Occurrences tab is first opened, inflection forms only when the Definition tab is opened.

### 5.2 Strong's entry sections

`LexicalModal.svelte` — Entry Information, Short Definition, Full Definition, KJV Usage, Derivation, Inflection Forms, then the Occurrences and Related tabs.

Lookup functions in `src/adapters/lexicon-lookup.ts`:

| Function | Line | Purpose |
|---|---|---|
| `lookupStrongs(strongsId)` | 157 | Single Strong's entry |
| `lookupLemma(lemma)` | 240 | Entry by dictionary form |
| `getStrongsTransliterations(ids)` | 219 | Batch transliteration map |
| `lookupWord(word)` | 71 | All entries matching a surface word |
| `getMorphology(...)` | 1152 | Parsing data for a word occurrence |

### 5.3 English word lookup

`lookupEnglishWord(word)`, `lexicon-lookup.ts`. Returns `EnglishWordEntry` with definitions grouped by part of speech (`Definition`).

`singularCandidates(word)` — folds plurals to singular so "waters" resolves to "water". English definitions are keyed off `word_mapping` rather than raw surface text.

### 5.4 People

| Function | Line | Purpose |
|---|---|---|
| `lookupPerson(word, ref?)` | 662 | Person record, disambiguated by verse reference |
| `isPersonName(word, ref?)` | 762 | Cheap boolean test used to decide the click target |
| `getPersonVerses(personId)` | 802 | Every verse the person appears in |

Types: `PersonRecord`, `PersonLookupResult`, `VerseRef`.

### 5.5 Morphology expansion

`src/lib/morphologyExpander.ts` — three code systems, each with its own expander, all returning the raw code unchanged when unparseable:

| System | Function | Line | Example |
|---|---|---|---|
| Greek RMAC (Robinson's) | `expandRmacCode()` | 134 | `V-PAI-3S` → "Verb, Present, Active, Indicative, Third person, Singular" |
| Hebrew/Aramaic OSHB | `expandOshbCode()` | 326 | `HVqp3ms` → "Hebrew, Verb, Qal, perfect (qatal), third person, masculine, singular". Handles compound `prefix/main-word` codes split on `/`. |
| STEPBible part-of-speech | `expandStepBiblePOS()` | 464 | `G:N-F` → "Greek, Noun, Feminine"; `N:N-M-P` → "Proper name, Noun, Masculine, Person". Handles multiple values separated by ` / `. |

Morphology is displayed under a "Morphology" heading, `LexicalModal.svelte`. Reader-side morphology state and cache at `BibleReader.svelte`.

## 6. Bible Encyclopedia (ISBE)

Files: `src/components/IsbeModal.svelte` (814 lines), `src/stores/isbeModalStore.ts`, ISBE functions in `src/adapters/lexicon-lookup.ts`. Ships as a standalone `isbe.sqlite` pack.

### 6.1 Click resolution

| Function | Line | Purpose |
|---|---|---|
| `resolveIsbeClick(ctx)` | 994 | Full resolution → `IsbeResolution` |
| `classifyIsbeClick(ctx)` | 1068 | Cheap `'place' \| 'entry' \| null` classification, used to decide whether to offer the action |
| `getIsbeEntry(entryId)` | 1085 | Entry by id |
| `getIsbeEntryByName(name)` | 1109 | Entry by primary name — the encyclopedia↔dictionary bridge |
| `getIsbePlace(placeId)` | 1115 | Place record |
| `getIsbePlaceByEntryId(entryId)` | 1120 | Place for an entry |
| `getIsbePlaceVerses(placeId)` | 1137 | Verses mentioning a place |

Types: `IsbeEntryRecord`, `IsbePlaceRecord`, `IsbeResolution`, `IsbeClickContext`.

Store API: `isbeModalStore.open(data)` and `openEntry(entryId, primaryName)`, `src/stores/isbeModalStore.ts`.

### 6.2 Tabs

`activeTab: Tab`, default `"overview"`, reset on open (`IsbeModal.svelte`). Rendered at:

- **Overview** (always) — type, alternate names, summary.
- **Article** (when an entry exists) —
- **Verses** — grouped by book in canonical order, rendered
- **Map** (when coordinates exist) — Leaflet pin bound to a popup with the title, rendered

Title resolution: `place?.primaryName || entry?.primaryName || state.primaryName`. Subtitle assembled from place type via `subtitle()` and `titleCaseType()`.

### 6.3 Article table of contents

`type Section = { title: string; html: string; children: Section[] }`. Two-level tree.

- `headingOf(text)` classifies a heading as level 1 or 2 — level 2 when the heading number starts with a digit.
- Duplicate-heading suppression: `lastAt` map keyed by `normTitle()` records the last index each heading title appears at; only the final occurrence is treated as the real section, so a title repeated in running text doesn't pollute the contents list.
- Section chips are colored inline to match the way the Verses tab colors its chips.

The tab strip is `flex: none` — a tall tab (a 955-verse Verses list) otherwise crushed the strip to zero height under flexbox. Noted at `IsbeModal.svelte`.

### 6.4 Dictionary bridge

`checkDictionary(title)` runs whenever the modal is open, not loading, and has a title, linking encyclopedia entries to matching dictionary entries.

### 6.5 Return-to-article

`src/stores/isbeReturnStore.ts`. Set when a verse is tapped inside the ISBE modal, consumed by the nav back arrow.

`IsbeReturn` carries three things: the `modal` payload to reopen (the same shape `isbeModalStore.open()` takes), `expandedBooks[]` so the Verses tab reopens with the same books expanded, and `at: {book, chapter, verse}` — the verse that was jumped to.

The back arrow only restores the modal if the reader is **still sitting at `at`**. If the user navigated on from there, the context is treated as stale and the modal is not reopened.

## 7. Commentaries

Files: `src/components/CommentaryReader.svelte` (608), `src/components/CommentaryNavigationBar.svelte` (799), `src/components/CommentaryModal.svelte` (456), `src/adapters/CommentaryStore.ts` (308), `src/lib/linkifyCommentaryRefs.ts` (238), `src/lib/annotationConfig.ts`.

### 7.1 Author registry

`COMMENTARY_AUTHORS`, `src/lib/annotationConfig.ts` — 14 authors, each with `color`, `initials`, `fullName`:

| Key | Color | Initials | Display name |
|---|---|---|---|
| `NET Bible Translators` | `#3B82F6` | NT | NET Bible Notes |
| `Adam Clarke` | `#16A34A` | Cl | Adam Clarke |
| `John Wesley` | `#9333EA` | We | John Wesley |
| `John Calvin` | `#DC2626` | Ca | John Calvin |
| `KingComments` | `#0891B2` | KC | KingComments |
| `A.T. Robertson` | `#EA580C` | Ro | A.T. Robertson |
| `Albert Barnes` | `#DB2777` | Ba | Albert Barnes |
| `E.W. Bullinger` | `#4F46E5` | Bu | E.W. Bullinger |
| `Family Bible Notes` | `#65A30D` | Fb | Family Bible Notes |
| `Abbott` | `#475569` | Ab | Abbott |
| `Thomas Aquinas` | `#B45309` | Aq | Thomas Aquinas (Catena Aurea) |
| `Matthew Henry` | `#7C3AED` | Mh | Matthew Henry |
| `Jamieson-Fausset-Brown` | `#0F766E` | Jf | Jamieson-Fausset-Brown |
| `Charles Spurgeon` | `#92400E` | Sp | Charles Spurgeon |

Accessors: `getAuthorConfig()` (null for unknown), `getAuthorColor()` (falls back `#888888`), `getAuthorInitials()` (falls back to first two chars upper-cased). Unknown authors therefore degrade gracefully rather than throwing.

### 7.2 Store API

`IndexedDBCommentaryStore`, `src/adapters/CommentaryStore.ts`:

| Method | Line |
|---|---|
| `getCommentary(reference, author?)` | 33 |
| `getChapterCommentary(book, chapter, author?)` | 97 |
| `getAuthors()` | 144 |
| `getCoverageStats()` | 178 |
| `getAllChapterContent(book, chapter, author?)` | 229 |
| `getAvailableBooks()` | 279 |

Entries typed `CommentaryEntry`. The reader caches all entries for the current chapter and re-filters when the selected author set changes rather than re-querying — `BibleReader.svelte`.

### 7.3 Author filter

State `selectedCommentaryAuthors: string[]` on `NavigationState`, persisted. Setter `navigationStore.setSelectedCommentaryAuthors()`, `src/stores/navigationStore.ts` — note it also sets `showCommentaries` to `selectedCommentaryAuthors.length > 0`, so clearing the filter hides the layer. Toolbar button `NavigationBar.svelte`.

### 7.4 Reference linkification

`linkifyCommentaryRefs(html, contextBook, contextChapter, author?)`, `src/lib/linkifyCommentaryRefs.ts`.

- Only text nodes are processed; HTML tags are left completely intact.
- Matches are wrapped in `<span class="commentary-ref">` with the raw text as both display and `data-ref`.
- A second wrapper handles continuation segments where the displayed token differs from the resolved reference — e.g. displayed "110:4" or "14" carrying an absolute `data-ref` of "Psalms 110:4".
- Theme color applied via a `--ref-color` CSS custom property.
- `author` is accepted so author-specific formatting quirks can be handled.

### 7.5 Anchor sync and checkpoints

State `commentaryAnchored` on `NavigationState`, persisted; setter `navigationStore.setCommentaryAnchored()`. Toolbar control `NavigationBar.svelte`.

Logic in `BibleReader.svelte`:

- **Drift detection** — `commCheckpointDrifted` is true when the anchor is on *and* any open commentary window's `contentState.book`/`.chapter` differs from the nav store's. While drifted, anchor highlights are cleared rather than chased, so the app stops fighting the user.
- **Re-sync** — an edge-triggered block watches `prevCommDrifted && !commCheckpointDrifted`; when drift clears, `lastAnchorVerse` is pushed to every commentary window's `highlightedVerse` so each scrolls to the current Bible verse once its entries have loaded.
- **Checkpoints** — `commCheckpoints` is the de-duplicated union of `contentState.checkpoints` across all open commentary windows. Rendered as amber highlights in the Bible text via `applyAnchorHighlights()` / `clearAnchorHighlights()`, re-evaluated whenever anchor state, drift, or the checkpoint set changes.

## 8. Cross-References

Files: `src/adapters/TskReferenceStore.ts`, `src/adapters/CrossReferenceStore.ts`, `src/lib/parseRefString.ts`, `src/components/AnnotationPanel.svelte`.

| Item | Detail |
|---|---|
| Store | `IndexedDBTskReferenceStore`, `TskReferenceStore.ts`. Methods: `getVerseReferences(book, chapter, verse)`, `getChapterReferences(book, chapter)` → `Map<verseNumber, TskEntry[]>`, `isInstalled()`. Entry type `TskEntry`. |
| Marker color | `TSK_COLOR = '#D97706'` (gold) — one shared constant for all TSK diamonds, `src/lib/annotationConfig.ts`. |
| Toggle | Toolbar button, `NavigationBar.svelte`, tooltip "Show TSK cross-reference markers on verse keywords". Backed by `showReferences` on `NavigationState` (`navigationStore.setShowReferences()`), persisted. |
| Reference resolution | `parseRefString()` — see [2.2](#22-moving-between-passages) for the formats handled. |
| Display | `AnnotationPanel.svelte` (789 lines), `references` tab. |

## 9. Search

Files: `src/lib/services/searchService.ts` (579), `src/components/PowerSearchModal.svelte` (1,370), `src/components/SearchResultsTree.svelte`, `src/lib/searchTree.ts`, `src/adapters/SearchIndex.ts`, `src/stores/searchStore.ts`, `src/components/HelpModal.svelte`.

### 9.1 Unified search service

`UnifiedSearchService`, `searchService.ts` — singleton, exported as `searchService`.

Eight categories (`SearchCategoryKey`): `bible`, `strongs`, `notes`, `journal`, `saved`, `characters`, `encyclopedia`, `commentaries`. Result types (`SearchResult`) mirror these one-to-one.

`SearchCategory` carries `truncated` (the count shown is what's displayed, not what exists). A category with no results is left out.

**Saved Verses** — `searchSaved()`: every verse carrying a verse or word highlight (the same set Profile's Saved Verses lists), one entry per verse, matched against its text in the reader's current translation and listed in Bible order. Tapping one opens the verse in the reader.

**Caps** — deliberately per-category so one huge category can't bury the others:

| Constant | Value |
|---|---|
| `CATEGORY_LIMIT` | 200 |
| `COMMENTARY_SCAN_LIMIT` | 400 |
| `STRONGS_VERSE_LIMIT` | 500 |

`SearchOptions` — `limit` (`-1` loads everything) and `deep`. Commentary search cursors ~89k rows, so it runs only on an explicit Enter/Search press, never on type-ahead.

**Strong's fast path** — `STRONGS_QUERY = /^([GgHh])\s*0*(\d{1,4})$/` detects a Strong's number typed straight into the box. Because the morphology pack is inconsistent about zero-padding (Greek rows store `G976`, Hebrew rows store `H0121`), `strongsVariants()` tries both the bare and 4-padded spellings. This mirrors the same fallback in `adapters/lexicon-lookup.ts`.

**Helpers** — `stripHtml()`, `snippet(text, term, maxLength = 160)` which windows around the first match so long entries stay scannable.

### 9.2 Advanced (power) search

`PowerSearchModal.svelte`. Config options:

| Option | Control | Line |
|---|---|---|
| Match type | select — `contains`, `startsWith`, `endsWith`, `wholeWord`, `wordStartsWith`, `wordEndsWith` | 319-324 |
| Must also contain | text | 337 |
| Must NOT contain | text | 362 |
| Find words near each other | proximity | 395 |
| `caseInsensitive` | checkbox | 285 |
| `includePlurals` | checkbox | 291 |
| `includeSynonyms` | checkbox | 297 |
| `showPronunciation` | checkbox | 303 |

Toolbar entry point `NavigationBar.svelte`, tooltip "Advanced search — regex, proximity, biblical filters".

### 9.3 In-app help

`src/components/HelpModal.svelte` — `helpContent` record, each key giving `{title, description, examples[]}`. Topics: Match Type, Must Contain / Must NOT Contain, Proximity Search, Include Plurals, Case-Insensitive Search, Pattern Complexity. This modal is power-search-specific, not a general app help system.

## 10. Highlights & Notes

Files: `src/components/HighlightModal.svelte` (494), `src/lib/highlightRenderer.ts` (374), `src/components/AnnotationPanel.svelte` (789), `src/components/NotePopup.svelte` (431), `src/components/SavedVersesPanel.svelte` (354), `src/components/SelectionToast.svelte`, `src/adapters/UserDataStore.ts` (390).

### 10.1 Palette and styles

`PALETTE`, `HighlightModal.svelte` — 7 colors: Yellow `#ffff32`, Green `#3aff32`, Orange `#ff9c32`, Red `#ff3232`, Pink `#ff48ec`, Purple `#ba32ff`, Blue `#3273ff`. Default is `PALETTE[0]` with `type: 'background'`.

Three highlight types: `background` (marker), `text-color`, `underline`.

`UNDERLINE_STYLES` — `solid`, `dashed`, `wavy`, `boxed`. Boxed renders as `outline: 2px solid` with `outline-offset: 1px` rather than a text-decoration.

### 10.2 Rendering

`src/lib/highlightRenderer.ts`:

- **Background** — an SVG data URI applied as `background-image` on the inline `.verse-text` span. The SVG uses a **seeded** wavy filled path so the same verse always gets the same organic shape, and `box-decoration-break: clone` gives each wrapped line its own swatch. ViewBox `0 0 100 10`, rendered via `background-size: 100% 100%`.
- **Text color** — a CSS custom property on the verse-text span.
- **Underline** — CSS `text-decoration`.

API: `applyHighlightToElement()` (safe to call repeatedly — removes any previous overlay first), `applyWordHighlightToSpan()`.

`HighlightStyle` is designed to accept a future `animatedEffect` field; `applyHighlightToElement` would handle it as an additional branch without breaking callers.

### 10.3 Persistence

`IndexedDBUserDataStore`, `src/adapters/UserDataStore.ts`. Verse highlights and word highlights are separate record types, so a word can be highlighted inside an already-highlighted verse.

| Group | Methods |
|---|---|
| Notes | `getNotes(reference?)`, `saveNote()`, `updateNote(id, text)`, `deleteNote(id)` |
| Verse highlights | `getHighlights(reference?)`, `getChapterHighlights(book, chapter)`, `saveHighlight()`, `deleteHighlight(id)` |
| Word highlights | `getWordHighlights(reference?, translation?)`, `getChapterWordHighlights()`, `getBookWordHighlights(book)`, `saveWordHighlight()`, `deleteWordHighlight(id)` |
| Bookmarks | `getBookmarks()`, `saveBookmark()`, `deleteBookmark(id)` |

Note that word highlights are translation-scoped (`getWordHighlights` takes a `translation`) while verse highlights are not.

### 10.4 Annotation panel

`AnnotationPanel.svelte`. Props: `open`, `book`, `chapter`, `verse`, `tskEntries`, `commentaryEntries`, `initialTab` (`"references" | "commentary"`), `targetAuthor`. Two tabs, References and Commentary. Keeps its own navigation stack so drilling into an entry and backing out restores the previous tab.

Reopen-after-back-navigation is coordinated through `src/stores/annotationReturnStore.ts`, consumed at `BibleReader.svelte`.

### 10.5 Selecting words

`src/lib/wordSelection.ts` — whole-word selection for the reader: resolve the word under a point, extend a selection from an anchor word to a focus word, and paint it. Dragging across words selects a phrase, and an existing selection can be extended by tapping.

Positions are expressed as **character offsets into a `.verse-text` element's `textContent`, never as live DOM Ranges.** Painting the selection splits text nodes, which would invalidate any Range being held; wrapping never changes `textContent`, so character offsets survive a repaint. They are also exactly what `UserWordHighlight` stores, so saving is a direct translation with no second offset calculation.

API: `getWordBounds()`, `resolveWordAt()`, `comparePos()`, `sameSection()`, `selectionSegments()`, `segmentsText()`, `segmentsWordCount()`, `paintSelection()`, `clearPaintedSelection()`. Painted spans carry `SEL_CLASS`.

### 10.6 The selection menu

Setting `selectionMenu`, default `'radial'`. Two presentations of the same seven actions.

**Radial** — `src/components/RadialSelectionMenu.svelte`, geometry in `src/lib/radialMenu.ts`. A ring around the tapped word, so the word itself stays readable. The shape is a donut with two slices cut out, at 3 o'clock and 9 o'clock; what is left is an arc across the top and another across the bottom, and the two gaps line up with the word's own line of text so the whole line reads straight through the menu. That is also why the ring can slide sideways as far as it likes — near the edge of the screen the word simply ends up in the left or right gap instead of dead centre, and is still fully readable.

The geometry lives outside the component because `BibleReader` has to know the ring's size *before* anything renders: it places the menu synchronously and may have to nudge-scroll the reader to make room. Both sides importing one module is what keeps the placement and the drawing agreed on where the buttons are. `BADGE` is the button diameter (54) and the minimum gap between two of them; `ringRadius()`, `outerRadius()`, `seatAngles()`, `seatOffset()`, `radialItems()`, `radialItemCount()`.

Buttons sweep in one at a time — 25 ms stagger, 120 ms pop. Svelte 5 transitions are local by default, which is why the animation initially never ran.

**Classic** — `src/components/SelectionToast.svelte`, the older popup above or below the word. It is positioned so it never covers the tapped word, and an invisible layer blocks the text behind it so a tap meant for the toast can't fall through to the reader. Tapping away clears the selection and does only that.

Both dispatch an `action` event with the selected text. Seven actions: `dissect`, `search`, `map`, `highlight`, `save`, `notes`, `repeats`. The `map` button is conditional — rendered only when the selection resolves to a place, and it opens the real map window via `src/lib/openMapWindow.ts`. A scope toggle switches between Word and the wider selection.

## 11. Repeated Words

Files: `src/stores/repeatsStore.ts`, `src/lib/repeatColors.ts`, `src/lib/repeatRenderer.ts`, `src/lib/repeatCounts.ts`, `src/stores/repeatCountsStore.ts`, `src/stores/repeatBulkStore.ts`.

### 11.1 Palette and cap

`REPEAT_COLORS`, `src/lib/repeatColors.ts` — exactly 7 entries, and `MAX_REPEAT_GROUPS = REPEAT_COLORS.length` makes the palette length itself the hard cap on simultaneous groups.

| Index | Name | Pill | Pill text | In-text bg | In-text border |
|---|---|---|---|---|---|
| 0 | Amber | `#b8860b` | `#fff8e1` | `rgba(255,193,7,0.30)` | `rgba(255,193,7,0.55)` |
| 1 | Sky | `#2f6f8f` | `#e3f4fb` | `rgba(56,178,232,0.28)` | `rgba(56,178,232,0.55)` |
| 2 | Mint | `#2f7d56` | `#e3f7ec` | `rgba(52,199,124,0.28)` | `rgba(52,199,124,0.55)` |
| 3 | Rose | `#a64263` | `#fbe6ee` | `rgba(244,114,160,0.28)` | `rgba(244,114,160,0.55)` |
| 4 | Violet | `#6c4aa6` | `#efe8fb` | `rgba(167,130,240,0.28)` | `rgba(167,130,240,0.55)` |
| 5 | Coral | `#b35a3a` | `#fceae3` | `rgba(255,138,101,0.28)` | `rgba(255,138,101,0.55)` |
| 6 | Teal | `#2f7d78` | `#e2f6f4` | `rgba(45,212,191,0.28)` | `rgba(45,212,191,0.55)` |

Both the navbar pills and the in-text spans reference colors by index, so a group looks identical in both places. `repeatHlClass(colorIndex)` returns `repeat-hl-{i}`.

The palette is deliberately softer and more translucent than the saved-highlight `PALETTE`, so repeats read as a scratch layer rather than a commitment (`repeatColors.ts`).

### 11.2 Store

`repeatsStore`, `src/stores/repeatsStore.ts`. Persisted to `localStorage`, modeled on `navigationStore`, so tracking survives navigation and restarts.

`RepeatGroup` = `{ word (normalized key), label (original casing, shown on the pill), colorIndex }`.

- `normalizeRepeatWord()` — lowercase, punctuation stripped; mirrors the in-text match logic.
- `nextFreeColorIndex()` — smallest unused index in `[0, MAX)`, so removing a group frees its color for reuse.
- `add()` — no-op if already present or at capacity; returns the new group or `null`.
- `toggle()` — used by the selection toast's Repeats action.
- Load path truncates to `MAX_REPEAT_GROUPS` and validates `label` is a string, so a corrupted localStorage payload can't break startup.

### 11.3 Rendering

`src/lib/repeatRenderer.ts`. Wraps matches in `<span class="repeat-hl repeat-hl-{colorIndex}">`.

Ordering contract: repeats are applied **after** saved highlights and cleared **before** saved highlights are re-applied, so the two layers can never corrupt each other. Place markers are then applied last — see [1.2](#12-what-appears-in-the-text).

API: `clearRepeatsInSection()`, `applyRepeatsToSection()` (idempotent — clears first), `findRepeatOccurrences()`, `applyRepeatsToAllSections()`.

`findRepeatOccurrences` returns char offsets within the `.verse-text` `textContent`, compatible with `injectWordSpan` / `UserWordHighlight`. Each occurrence spans the whole whitespace-delimited token.

### 11.4 Counts

`countWordsInBook()`, `src/lib/repeatCounts.ts` → `Map<word, count>`. Counts against whitespace tokens of the **rendered** verse text using the same normalization as the highlights, so footnote markers and stored-text artifacts aren't counted. Cached per `translation:book`. Surfaced through `src/stores/repeatCountsStore.ts`.

### 11.5 Highlight All

`src/stores/repeatBulkStore.ts` carries a pending bulk request from a repeat pill into `HighlightModal` in bulk mode — `BibleReader.svelte`. A related flag handles opening the normal Highlight modal on a word that is also an active repeat.

## 12. Journal

Files: `src/components/JournalWriter.svelte` (251), `src/components/JournalCalendar.svelte` (396), `src/components/JournalNavigationBar.svelte`, `src/lib/components/LexicalEditor.svelte` (459), `src/adapters/JournalStore.ts` (215), `src/adapters/SyncedJournalStore.ts` (229).

| Item | Detail |
|---|---|
| Store | `IndexedDBJournalStore`, `JournalStore.ts`. Methods: `getEntries(startDate?, endDate?)`, `getEntryByDate(date)`, `saveEntry()`, `updateEntry(id, {title?, text?, textLinkified?})`, `deleteEntry(id)`, `getDateRange()` → `{oldest, newest}`. |
| Entry shape | Keyed by date string. Stores both `text` and `textLinkified` — the raw body and the version with Bible references already wrapped as links, so linkification is done once on save rather than on every render. |
| Editor | `src/lib/components/LexicalEditor.svelte` — rich text. |
| Calendar | `JournalCalendar.svelte`; also `src/components/CalendarView.svelte` (349). |
| Keyboard shortcut | **J** opens today's entry in a right-edge window at 50% width. Suppressed while typing in an `input`, `textarea`, or `contenteditable`, and ignored with Ctrl/Meta/Alt held. `src/App.svelte` |
| Date handling | Uses `localDateStr()` from `src/stores/clockStore.ts`, which respects the `timezone` setting rather than the raw browser timezone. |
| Search | Journal is one of the eight unified-search categories; `searchService` reads it through `syncedJournalStore` (unscrambled text) and returns nothing while the journal is locked. |
| Sync | `SyncedJournalStore.ts` — see [20. Account & Sync](#20-account--sync). |
| Lock | `src/lib/journalLock/`: `crypto.ts` (AES-256-GCM fields tagged `pbj1:`, bound to entry id, date and field), `passkey.ts` (WebAuthn PRF, rp id `hexapla.app`), `recoveryCode.ts` (6×4 base32, PBKDF2), `slotStore.ts` (IndexedDB `journal_lock` / `journal_key_slots`, DB version 35, and Supabase), `lockState.ts` (key in memory, relock timer, `pb_journal_relock_ms`), `sweep.ts` (scramble/unscramble pass after unlock), `actions.ts` (turn on, manage, turn off), `sync.ts` (pull + its own realtime channel). UI: `JournalLockScreen.svelte` (in `WindowContent` and `JournalCalendar`), `JournalLockDialog.svelte`, `JournalLockManage.svelte`, Settings → Privacy. Cloud: `supabase/migrations/011_journal_lock.sql`, including a trigger that refuses readable journal text while the lock is on. |

## 13. Reading Plans & Progress

Files: `src/components/ReadingPlanModal.svelte` (3,144 — second-largest component), `src/stores/ReadingProgressStore.ts` (564), `src/stores/PlanMetadataStore.ts`, `src/adapters/ReadingHistoryStore.ts` (444), `src/adapters/SyncedReadingAdapter.ts` (447), `src/stores/readingPlanModalStore.ts`, `src/stores/readingProgressVersionStore.ts`, `src/components/CalendarView.svelte`.

### 13.1 Preset plans

`ReadingPlanModal.svelte`:

| Value | Label | Ordering |
|---|---|---|
| `""` | Custom… | user-chosen |
| `bible-1-year` | Bible in 1 Year | `canonical` |
| `nt-90-days` | New Testament in 90 Days | `canonical` |
| `gospels-30-days` | Gospels in 30 Days | `canonical` |
| `chronological-1-year` | Chronological Bible in 1 Year | `chronological` |
| `psalms-proverbs` | Psalms & Proverbs | `canonical` |
| `gospel-harmony-30` | Robertson Gospel Harmony — 30 Days | `harmony` |
| `gospel-harmony-60` | Robertson Gospel Harmony — 60 Days | `harmony` |
| `gospel-harmony-90` | Robertson Gospel Harmony — 90 Days | `harmony` |
| `gospel-harmony-184` | Robertson Gospel Harmony — 1 Section/Day (184) | `harmony` |

Custom ordering options: `'canonical' | 'chronological' | 'shuffled'`.

Two plan types are stored: `planType: 'standard'` and `planType: 'harmony'`. Harmony plans track *passages* rather than chapters. Display names are resolved per plan type.

### 13.2 Storage and migration

- Current key: `projectbible_active_reading_plans` (`STORAGE_ACTIVE_PLANS`) — multi-plan array.
- Legacy single-plan key is migrated on load and then removed.
- Signed-out users fall back to `sessionStorage`; signed-in users use `localStorage`.
- Plan IDs are `plan_<epoch-ms>`, used as the canonical creation time.
- Phase-3 migration moves abandoned history items (`completedAt === null`) back into `activePlans`.
- `activePlanViewTab` defaults to `'all'` with 2+ plans, otherwise the selected plan.

### 13.3 Progress store

`ReadingProgressStore`, `src/stores/ReadingProgressStore.ts`, exported as `readingProgressStore`.

Types: `ChapterActionType = "checked" | "unchecked"`, `HarmonyPassageProgress`, `HarmonySectionProgress`, `ChapterAction`, `ChapterProgress`, `CatchUpAdjustment`, `ReadingProgressEntry`.

| Method | Line |
|---|---|
| `getDayProgress(planId, dayNumber)` | 191 |
| `getProgressForPlan(planId)` | 198 |
| `upsertEntries(entries)` | 214 |
| `ensureDayProgress(...)` | 289 |
| `setStartedReadingAt(planId, day, ts)` | 315 |
| `setChapterAction(...)` | 323 |
| `markDayComplete(...)` | 353 |
| `setCatchUpAdjustment(entry)` | 382 |
| `ensureHarmonyDayProgress(...)` | 391 |
| `markPassageComplete(...)` | 417 |
| `togglePassageComplete(...)` | 451 |
| `markHarmonyDayComplete(...)` | 484 |

Also `getLatestChapterState()`.

**Sync hook** — `ProgressSyncHook`, registered via `registerProgressSyncHook()` by `SyncedReadingAdapter`. Fired after every *local* mutation. Deliberately **not** fired by `upsertEntries()`, which is the remote-apply path, so pulled data is never echoed straight back to the server.

**Merge semantics** — designed for multi-device convergence without a server-side resolver:

- `chaptersRead` union-merge: all unique chapter actions from both sides are preserved, deduplicated by `(timestamp, type)`, sorted chronologically.
- `harmonySections` union-merge: a passage marked complete on *either* device stays complete.

### 13.4 Plan metadata

`PlanMetadataStore`, `src/stores/PlanMetadataStore.ts`, exported. `PlanStatus = "active" | "completed" | "archived"`; `PlanMetadata`.

### 13.5 Reading history

`IndexedDBReadingHistoryStore`, `src/adapters/ReadingHistoryStore.ts`:

| Method | Line |
|---|---|
| `recordReading(book, chapter, planId?)` | 21 |
| `getReadingHistory(book?, chapter?)` | 44 |
| `hasRead(book, chapter, planId?)` | 75 |
| `getReadingStreak()` | 94 |
| `getTotalChaptersRead()` | 141 |
| `startReadingPlan(name, config)` | 160 |
| `getActiveReadingPlan()` | 196 |
| `getReadingPlan(planId)` | 213 |
| `getAllReadingPlans()` | 225 |
| `completeReadingPlan(planId)` | 237 |
| `deleteReadingPlan(planId)` | 252 |
| `getDayReading(planId, dayNumber)` | 274 |
| `getAllDayReadings(planId)` | 289 |
| `completeDayReading(planId, dayNumber)` | 304 |
| `getPlanProgress(planId)` | 334 |
| `getTodaysReading()` | 352 |
| `checkAndCompletePlanDay(...)` (private) | 383 |

`getTodaysReading()` tries today first, then the next upcoming day (`ReadingPlanModal.svelte`).

### 13.6 Catch-up

Two strategies, `ReadingPlanModal.svelte`: `spread` (Even spread) and `dedicated` (Dedicated catch-up days). Persisted as `CatchUpAdjustment` via `setCatchUpAdjustment()`.

### 13.7 Sync behavior in the modal

- Re-reads `localStorage` on every open, then kicks off a background sync throttled to once per 30 s. Local progress is loaded first so the UI is never blank while the sync runs.
- Pull happens before re-pushing local plans — the pull refreshes which plans exist.
- Reloads progress whenever a Realtime event or pull writes.
- Note: Svelte doesn't track `dayProgressMap` through `getDayProgress()` calls, so it is reassigned explicitly.
- Two-step delete and inline rename state.

## 14. Maps & Places

Files: `src/components/AtlasPane.svelte`. Uses Leaflet.

### 14.1 Encyclopedia link

The ISBE modal's Map tab renders a Leaflet pin bound to a popup with the entry title (`IsbeModal.svelte`), shown only when coordinates exist. See [6.2](#62-tabs).

## 15. Art

Files: `src/components/ArtPane.svelte` (283), `src/adapters/ArtStore.ts`.

`IndexedDBArtStore`, `ArtStore.ts`:

| Method | Line |
|---|---|
| `getScene(id)` | 19 |
| `getScenesForVerse(reference)` | 30 |
| `getScenesForChapter(book, chapter)` | 47 |
| `getAllScenes()` | 64 |
| `searchScenes(query)` | 86 |
| `getImageUrl(id)` | 120 |

`ArtPane` props: `sceneId`, `book`, `chapter`, `verse` — all optional, so it can open on a specific painting or browse. Falls back to a "Biblical Art" browse view when no scene is selected.

In-text icons: setting `showArt`, default `true`. The reader keeps a scene map keyed `"book:chapter:verse"` for the currently rendered chapters and rebuilds it as chapters come and go (`BibleReader.svelte`). `openArtWindow` docks to whichever edge fits the current orientation.

## 16. Read Aloud (TTS)

Fully on-device: no account, no network, nothing leaves the phone. Two layers, and the split matters — the **engine** owns the reading, the **synthesis layer** owns the voice.

Engine: `src/lib/tts/readingEngine.ts` (904), `src/lib/tts/stitchAudio.ts`, `src/lib/tts/mediaSession.ts`, `src/lib/tts/sleepTimer.ts`.
Synthesis: `src/lib/tts/piperEngine.ts`, `src/lib/tts/ttsWorker.ts`, `src/lib/tts/voices.ts`, `src/lib/tts/vendor/piper-phonemize.js` (vendored), `src/adapters/tts.ts`.
Presentation: `src/components/TtsPlayer.svelte`, `src/lib/ttsGlow.ts`.

### 16.1 The reading engine

`readingEngine.ts` owns the reading position, the text, the rendered speech, and the audio element — and deliberately knows nothing about what is drawn on screen. Read Aloud used to live inside each rendered chapter's control bar, so a chapter could only be read while it happened to be visible. Nothing in the engine depends on components, which is what lets reading continue across a chapter change, a pane closing, or a locked screen.

**Playback is continuous.** Verses are generated one at a time as before, then stitched — with their pauses as real silence — into segments of roughly ninety seconds, and the player is handed those. The reason is not smoothness but throttling: audio is played by the browser's media engine, but *JavaScript* is what gets throttled once the screen goes off. Handing over one verse at a time meant JS had to wake every few seconds, and every new `src` unloaded the current media and rebuilt the phone's media session from scratch. Segments cut those wakeups by roughly twenty times and let the media session live for minutes instead of seconds.

Segment length ramps up — the first segment is a single verse, so the delay between pressing play and hearing the first word is unchanged.

| Dial | Value | Why |
|---|---|---|
| `SEGMENT_SECONDS` | 90 | Target stitched-segment length; long, so JS rarely has to wake |
| `HEAD_START_SECONDS` | 20 | Audio banked before the first word |
| `HEAD_START_MAX_WAIT_MS` | 6000 | Ceiling on that wait, whichever comes first |
| `BUFFER_AHEAD_SECONDS` | 150 | Cushion kept ahead of the play position |
| `BUFFER_MAX_BYTES` | 24 MB | Hard cap on banked audio |
| `GAP_BEFORE` / `GAP_MID` / `GAP_AFTER` | 3 / 1 / 2 s | Silence around a spoken chapter announcement |
| `DEFAULT_SECONDS_PER_CHAR` | 0.067 | Fallback pace before any real audio has been measured |

The head start exists because starting the instant one verse exists means the generator begins the session already behind playback and never catches up within the first chapter — which is what produced a long silence before chapter two. A head start costs a second or two once; the cushion then grows on its own, because generating runs faster than speaking.

**State:** `ReadingState` is `'idle' | 'starting' | 'playing' | 'paused' | 'voice-needed' | 'downloading' | 'error'`. Stores: `readingState`, `readingError`, `readingPosition`, `readingVerseList`, `currentVerseWindow`, `verseCounter`, `chapterProgress`, plus derived `isReadingActive` and `isPreparing`.

**API:** `startReading()`, `pauseReading()`, `resumeReading()`, `togglePlayPause()`, `jumpToVerse()`, `skipChapter(±1)`, `stopReading()`.

An `Utterance` is one thing to speak — a verse or a spoken chapter announcement — carrying its own `gapBefore` rendered as real samples. A `Mark` records where an utterance starts inside its segment, which is what keeps the verse counter and the glow aligned to stitched audio.

### 16.2 Stitching

`stitchAudio.ts`. Everything here is a memory copy: there is no decoding, no re-encoding and no measurable cost, because the generator already emits mono 16-bit PCM at one sample rate. Joining is a matter of dropping each 44-byte header, concatenating the samples, and writing one new header.

`readWav()` reads a generated WAV without decoding it. `silencePcm()` renders a pause as real zero-filled samples, so a gap is audio rather than nothing playing — the distinction that keeps the media session alive through a pause. `joinPcm()` produces one blob from a run of pieces; `pcmSeconds()` measures a run.

### 16.3 Lock-screen controls

`mediaSession.ts`. Two reasons this matters, and the second is the important one:

1. The lock screen shows what is being read, with working controls.
2. It tells the operating system this page is a media player rather than an idle web page. A phone is far less willing to throttle a tab registered as playing media — which is what makes listening with the phone pocketed viable at all.

`initMediaSession()` binds handlers once; `updateMediaSession()` refreshes the metadata. Title stays at chapter level so it never churns; the subtitle carries "Verse *n* of *m*". Skip actions seek inside audio that is already buffered rather than restarting — the restart path reloads from the database and regenerates, which is exactly the work that stalls when the screen is off, and was why "next chapter" used to do nothing until the phone was unlocked. Every call is a no-op on browsers without the API.

### 16.4 Sleep timer

`sleepTimer.ts`. Lives in a module-level store rather than inside `TtsPlayer` because auto-continue destroys and remounts the player on every chapter — a 30-minute timer has to outlive several of those, so component state is the wrong home.

The timer fades over `FADE_SECONDS` (20) and stops; **it never navigates.** Where you fell asleep is where you wake up.

`sleepRemaining` (seconds, for display), `stopAtChapterEnd` (stop instead of advancing), and `sleepStopNonce` — bumped when the timer decides playback should end. `TtsPlayer` watches the nonce and runs its own `stopReading()`, because only the player can tear down its queue, caches and object URLs correctly. The dependency is one-way on purpose: the timer knows nothing about the engine, so the engine listens to it; the reverse would be a circular import.

API: `startSleepTimer(minutes)`, `setStopAtChapterEnd()`, `cancelSleepTimer()`, `sleepTimerArmed()`, `remainingMinutes()`.

### 16.5 Synthesis engine

`piperEngine.ts` — Piper ONNX voice via onnxruntime-web WASM plus the espeak-ng phonemizer WASM. Adapted from `@diffusionstudio/vits-web` 1.0.3 (MIT) with three deliberate changes:

1. Runtime WASM assets load from same-origin `/tts/` instead of CDNs, so the feature keeps working offline (the service worker caches `/tts/`).
2. The ONNX session and voice config are cached between calls. The original recreated them per synthesis — far too slow for per-verse use.
3. Synthesis throws `VOICE_NOT_INSTALLED` rather than silently downloading ~60 MB, so the UI owns when the download happens.

Voice files live in OPFS under `/piper/` (same layout as vits-web). **Runs inside `ttsWorker.ts` — must not be imported from the main thread.**

Engine API: `downloadVoice()`, `installVoiceData()` (raw `.onnx` + `.json` bytes transferred across the worker boundary with no copy — used for user-cloned voices), `removeVoice()`.

### 16.6 Voice catalog

`TTS_VOICES`, `src/lib/tts/voices.ts`:

| id | Label | Quality | Approx size |
|---|---|---|---|
| `en_US-lessac-medium` | Standard (US English) | `standard` | 64 MB |
| `en_US-lessac-low` | Compact (US English) | `compact` | 30 MB |

Remote source base: `https://huggingface.co/rhasspy/piper-voices/resolve/main`. `resolveVoiceSource()` returns `null` for voices that can only arrive via local file install. `voiceModelName()`, `voiceConfigName()`. `TtsVoiceInfo.custom` flags user-added voices.

### 16.7 Adapter

`src/adapters/tts.ts`. `DEFAULT_TTS_VOICE = 'en_US-lessac-medium'`.

Catalog: `getCustomVoices()`, `registerCustomVoice()`, `getAllVoices()`, `getVoiceInfo()`, `voiceIsDownloadable()`, `voiceIdFromFilename()`, `isTtsSupported()`.
Installation: `storedVoices()`, `isVoiceInstalled()`, `downloadVoice()`, `removeVoice()`, `installVoiceFromFiles()`.
Playback: `synthesizeSpeech()`, `getSharedTtsAudio()`, `unlockTtsAudio()`.

`unlockTtsAudio()` must be called from inside a user tap, before any async work — it plays a tiny silent clip to satisfy mobile autoplay policy. `getSharedTtsAudio()` returns one shared `<audio>` element; the engine, the sleep timer's fade, and the media session all act on that same element.

Custom voices are catalogued in `localStorage` on the main thread; the worker receives an explicit `source` for them, while built-ins fall back to the static catalog so internal callers work source-free.

### 16.8 Settings

`TtsSettings`, `src/adapters/settings.ts`. Resolved by `getTtsSettings()`, written by `updateTtsSettings()`.

| Key | Default | Meaning |
|---|---|---|
| `voiceId` | `'en_US-lessac-medium'` | Installed Piper voice id |
| `rate` | `1.0` | Playback speed, range 0.8–1.5 |
| `readHeadings` | `false` | Speak section headings before their verse |
| `highlightVerse` | `true` | Tint the verse being read |
| `glowFollow` | `false` | Soft glow drifting along the words |

`highlightVerse` and `glowFollow` are independent — either, both, or neither.

### 16.9 Player and navbar controls

`TtsPlayer.svelte`. Controls: play/pause, jump to a verse, stop, continuous play toggle, cancel during preparation, dismiss, sleep timer. When reading is active the controls also appear centred in the navbar, so playback is reachable without returning to the chapter that started it.

The app icon spins whenever the engine is generating audio — `BrandSpinner.svelte`, the gem alone without the icon's black tile.

Speech text comes from `extractSpeechText()`, `src/lib/verseRendering.ts` — footnotes and cross-references are dropped entirely rather than read aloud, using the same `findNoteEnd()` boundary logic as the HTML renderer so the two can't disagree. Chapter announcements are built from `spokenBookName()`, `src/lib/bibleData.ts`.

### 16.10 Drifting glow

`src/lib/ttsGlow.ts`. Two design decisions worth preserving:

- **Why soft and wide** — the standard Piper export returns finished audio and keeps its internal per-word durations to itself, so pacing is an estimate. A crisp highlight on the wrong word looks broken; a blurred cloud several words wide is almost always covering the right word somewhere in its span, and reads as atmosphere rather than error. Pacing is driven by the verse's own measured duration (`currentVerseWindow`) rather than by the segment, so stitching did not coarsen it.
- **Why it's anchored to `.text-container`, not the verse** — in paragraph layout a verse is an inline element flowing through the paragraph, and for an inline box spanning several lines the browser's reference for placing an absolutely positioned child is not the box that measuring returns. Anchoring to the verse put the glow in the wrong place and made it drift as text rewrapped. `.text-container` is a block that scrolls with the content and is already the anchor the text-selection drag handles use.

Reader-side wiring at `BibleReader.svelte`, with a ticket guard because an `await` follows and a newer call can overtake an older one.

## 17. Audio

Retired 2026-09-13. The BSB chapter audio packs, `AudioPlayer.svelte` and `adapters/audio.ts` are gone; [16. Read Aloud](#16-read-aloud-tts) reads every chapter instead. The importer refuses `bsb-audio-pt1` / `bsb-audio-pt2` by id before reading any bytes. A device that still has one lists it under Manage Packs → Other installed, and removing it there also deletes its file from OPFS (`audio-packs/`), which clearing IndexedDB alone never touched.

`continuousPlay` in `src/stores/audioStore.ts` stays: it is Read Aloud's auto-advance.

## 18. Panes & Windows

Two independent docking systems.

### 18.1 Windows

`src/lib/stores/windowStore.ts`, `src/components/Window.svelte`, `src/components/WindowContainer.svelte`, `src/components/WindowContentSelector.svelte`, `src/components/WindowContent.svelte`, `src/components/Pane.svelte`.

- `WindowContentType` — `'selector' | 'bible' | 'map' | 'notes' | 'wordstudy' | 'commentaries' | 'journal' | 'art' | 'isbe' | 'person' | 'naves'`
- `WindowEdge` — `'top' | 'left' | 'right' | 'bottom'`
- `MAX_WINDOWS = 6`; `createWindow()` returns `null` at capacity
- `setWindowContent(id, contentType, contentState?)` — each window carries its own `contentState`, so a second Bible window can sit on a different chapter from the main reader
- `getWindowsByEdge(edge)`

`WindowContent.svelte` is the single switch from a `WindowContentType` to the component that renders it — one table rather than a copy inside each container. The picker tiles in `WindowContentSelector.svelte` draw their icons from `src/components/icons/PanelIcon.svelte` and lay out on a grid that responds to the panel's own width, so the tiles stay legible in a narrow docked window.

**Which edge a window opens on** is decided in one place: `src/lib/dockEdge.ts`. The rule is beside the text on a wide screen, under it on a phone — decided by orientation rather than a pixel breakpoint, because what matters is which way there is room to spare, and a portrait tablet wants the same bottom sheet a portrait phone does. `DOCK_SIZE` is 50 (half the screen), which is what every caller has always asked for. This used to be written out at each call site, which is how `App.svelte` ended up hardcoding `'right'` while two other copies drifted into comparing the operands the other way round.

Layout: `App.svelte` sums the sizes of the windows on each edge and insets the main content with `left`/`right`/`top`/`bottom` percentages, transitioned over 0.3 s.

The whole header bar is the resize grip, not a separate handle — a thin hit target on a phone is the kind of thing that only works on a desktop.

### 18.2 Edge gestures

`src/components/EdgeGestureDetector.svelte` (497).

| Constant | Value | Purpose |
|---|---|---|
| `EDGE_ZONE_WIDTH` | 40 px | Width of the grab zone along each edge |
| `OPEN_THRESHOLD` | 0.05 | 5% of screen width/height before a window opens |
| `BOTTOM_DEAD_HALF` | 20 px | Half of a 40 px centre dead zone on the bottom edge, left free for the Android home gesture |

Two-stage commit: touching an edge sets a **pending** edge; the drag only commits once movement direction matches that edge's axis. This is what stops accidental opens.

Touch and mouse paths are separate, with a `usingTouch` flag so mouse events are ignored during touch. Any touch starting in the bottom zone locks reader scroll. `atLimit` (6 windows) switches the bumper's visual class.

### 18.3 Panes

`src/stores/paneStore.ts`. A simpler, app-level docking system.

- `PaneType` — `'settings' | 'map' | 'packs' | 'search' | 'notes' | 'commentaries' | 'wakealarm'`
- Positions: `'left' | 'right' | 'bottom'`
- `openPane(type, position)` — reopens an existing pane of that type rather than duplicating it
- Sizing: left/right panes are 75% wide on a phone (`innerWidth <= 480`) and 40% otherwise; bottom panes are 50% tall
- `zIndex` is assigned as `max(existing) + 1`
- `closePane(id)` sets `isOpen: false` rather than removing the record
- `pendingCloseEdge` is consumed by `EdgeGestureDetector` for close animations

Pane components: `src/components/panes/SettingsPane.svelte`, `PacksPane.svelte`, `WakeAlarmPane.svelte`; container `src/components/PaneContainer.svelte`. The Notes pane is `src/components/NotesPane.svelte` — see [26](#26-notes--notebooks).

While the Settings pane is open the reader stays visible behind it rather than being covered, so a change to font size or theme can be judged against real text.

### 18.4 Orientation

Setting `allowRotation`, default `false` (portrait-locked). `applyOrientationLock()`, `src/App.svelte` — tries `'portrait-primary'` then falls back to `'portrait'`; failures are swallowed since desktop and tablet browsers often don't support the API.

Re-applied on visibility resume to handle tablet app-switching and whenever settings are saved. Deliberately **not** re-applied on orientation change itself — doing so fought the OS on tablet and confused mobile.

`handleOrientationChange()` fades `.app-root` to opacity 0 over 0.25 s and back after 350 ms, so a rotation reads as a transition rather than a snap.

## 19. Content Packs

Files: `src/components/panes/PacksPane.svelte` (1,238), `src/adapters/PackManager.ts`, `src/adapters/pack-import.ts` (2,116), `src/lib/pack-init.ts` (497), `src/lib/pack-triggers.ts`, `src/lib/progressive-init.ts`, `src/components/ProgressModal.svelte`, `src/adapters/db-manager.ts` (339).

### 19.1 Pack manager

`IndexedDBPackManager`, `src/adapters/PackManager.ts`: `listInstalled()`, `install(source: string | File)`, `remove(packId)`, `isInstalled(packId)`.

`install()` accepts either a URL string or a `File`, which is what makes both Quick Install and Advanced Install one code path.

**Packs are identified by checksum, not by id and version.** Identity by id alone meant a rebuilt pack carrying the same id was treated as already installed and silently skipped — the common case during development, and the reason a corrected pack appeared not to take. The checksum makes a rebuild a different pack, so it installs. Removal clears the pack's own stores rather than only its `packs` row, so a delete genuinely frees the space it claimed. `src/adapters/db-manager.ts` holds the store lists per pack type; `packages/core/src/services/PackLoader.ts` carries the matching loader change.

### 19.2 First-run initialization

`src/lib/pack-init.ts`. Bundled packs are extracted to IndexedDB on first run; afterwards packs load from IndexedDB.

`isInitialized()`, `initializePolishedApp()`, `getBundledPacks()`, `resetInitialization()` (development only). Internal helpers for opening, reading, and writing the pack IndexedDB. Type `BundledPack`.

### 19.3 Demand loading

`src/lib/pack-triggers.ts` — loads packs when a user action needs them, without blocking the UI.

- Stores: `currentDownload` (`DownloadProgress | null`), `showProgressModal`. Both consumed by `ProgressModal` in `App.svelte`.
- `triggerPackLoad(...)`, `preloadPacks(packIds)`, `isPackLoaded(packId)`, `getLoadedPacks()`, `clearLoadedPacksCache()`.

### 19.4 Packs pane sections

`PacksPane.svelte`: Database Statistics, Installed Packs, Quick Install, Voices (Read Aloud), Advanced Install, About Packs.

Entry point from Settings: "Manage Packs" button, `SettingsPane.svelte`.

Pack `type` values, from `src/adapters/db.ts`: `text`, `lexicon`, `dictionary`, `places`, `geonames`, `map`, `cross-references`, `morphology`, `audio`, `original-language`, `commentary`, `references`, `headings`, `people`, `isbe`, `encyclotopical`, `art`.

**`encyclotopical`** is the ISBE encyclopedia and Nave's Topical Bible in one pack — it supersedes the standalone `isbe` pack, and its import path fills both the `isbe_*` and `naves_*` stores. `isbe` is still recognised so an already-installed encyclopedia keeps working. See [24](#24-naves-topical-bible).

### 19.5 Configuration

`src/config.ts`. `APP_VERSION = '1.0.0'`.

- `PACK_MANIFEST_URL` — `/api/packs/manifest.json` in production (proxied to GitHub Releases), `/packs/consolidated/manifest.json` in dev.
- `USE_BUNDLED_PACKS` — true in dev, or when `VITE_USE_BUNDLED_PACKS === 'true'`.
- `FEATURES` — `lazyPackLoading`, `packUpdates` (both keyed off `!USE_BUNDLED_PACKS`), `persistentStorage`, and `ttsReadAloud` (a kill switch for Read Aloud).
- `PACK_PRIORITY` — `essential: [bootstrap]`, `high: [translations]`, `medium: [study-tools, lexical]`, `low: [ancient-languages]`.
- `PACK_TRIGGERS` — which user action loads which pack: `translations` on `reader-open`, `ancient-languages` on `hebrew-greek-toggle`, `lexical` on `word-study-open`, `study-tools` on `maps-open`.
- `UI` — `showProgressDuringDownload`, `allowPackRemoval`, `showStorageUsage`, `promptForPersistentStorage`.

### 19.6 Related docs

`docs/PACK-STANDARD-V1.md`, `docs/PACK-MANAGEMENT.md`, `docs/PACK-SYSTEM-IMPLEMENTATION.md`, `docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md`.

## 20. Account & Sync

Files: `src/services/SupabaseAuthService.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/userSettings.ts`, `src/lib/sync/` (`SyncService.ts` 335, `SyncQueueService.ts` 381, `RealtimeService.ts`, `conflictResolver.ts`, `reconcileDeletes.ts`, `settingsSync.ts`, `types.ts`, `index.ts`), `src/adapters/Synced*.ts`, `src/components/ProfileModal.svelte` (1,018), `src/stores/userProfileStore.ts`, `src/stores/profileModalStore.ts`.

### 20.1 Auth

`SupabaseAuthService`, `src/services/SupabaseAuthService.ts`, exported as `supabaseAuthService`:

| Method | Line |
|---|---|
| `signUp(email, password, name)` | 5 |
| `signIn(email, password)` | 17 |
| `signOut()` | 21 |
| `resetPassword(email)` | 25 |
| `updatePassword(newPassword)` | 32 |
| `reauthenticate(email, password)` | 37 |
| `updateProfileName(name)` | 42 |
| `deleteAccount()` | 51 |
| `getSession()` | 56 |

### 20.2 Synced tables

`SyncTable`, `src/lib/sync/types.ts` — seven tables: `user_notes`, `user_highlights`, `user_word_highlights`, `user_bookmarks`, `journal_entries`, `reading_plans`, `reading_progress`.

`SyncOperationType` — `'INSERT' | 'UPDATE' | 'DELETE'`. `SyncStatus` — `'idle' | 'syncing' | 'error' | 'offline'`. `SyncState` carries `status`, `pendingCount`, `lastSyncedAt`, `error`, `isOnline`.

### 20.3 Orchestrator

`SyncService`, `src/lib/sync/SyncService.ts`, exported. Responsibilities: connect/disconnect Realtime on auth changes, process the queue when online, pull initial data on sign-in, expose sync state to the UI.

`init()`, `forceSync(throttleMs = 0)`, `onSignIn(userId)`, `onSignOut()`, `handleOnline`, `pullRemoteData()`, `pullTable(...)`.

`forceSync` is called on tab visibility change, throttled to once per 30 s and guarded by a mutex so it can never pile up or leave the status stuck on "Syncing…" — `App.svelte`.

### 20.4 Offline queue

`SyncQueueService`, `src/lib/sync/SyncQueueService.ts`, exported as `syncQueue`. Writes queue to IndexedDB and drain when online.

Drain behavior: oldest-first, coalescing every queued op for the same row into one equivalent upload, with exponential backoff on failure — 5 s doubling per attempt, capped at 15 minutes.

| Method | Line |
|---|---|
| `enqueue(operation)` | 28 |
| `processQueue()` → `{success, failed}` | 56 |
| `coalesce(key, ops)` (private) | 123 |
| `getPendingCount()` | 164 |
| `resetFailed()` | 184 |
| `clear()` | 226 |
| `getPendingIdsFor(table)` | 245 |
| `getPendingItems()` (private) | 255 |
| `processItem(item)` (private) | 270 |
| `executeOperation(op, userId)` (private) | 317 |
| `notifyListeners()` (private) | 373 |

`getPendingIdsFor(table)` exists so the delete-reconciliation pass can skip rows that have a local write still in flight.

### 20.5 Realtime

`RealtimeService`, `src/lib/sync/RealtimeService.ts`, exported. Subscribes to Postgres changes on all user-data tables and notifies registered handlers. `connect(userId)`, `disconnect()`, `ensureConnected()`, `reconnect()`.

Pull handlers are registered by side-effecting imports in `App.svelte`: `./adapters/SyncedReadingAdapter` (reading plan/progress) and `./adapters/SyncedHighlightAdapter` (verse/word highlights).

### 20.6 Conflict resolution

`src/lib/sync/conflictResolver.ts` — last-write-wins on `updated_at`. `shouldApplyRemoteChange()` returns true only when remote is newer than local; `nowISO()`.

Reading progress is the deliberate exception: it **union-merges** rather than last-write-wins, so concurrent ticks on two devices both survive. See [13.3](#133-progress-store).

`src/lib/sync/reconcileDeletes.ts` handles the case that last-write-wins can't — distinguishing "deleted remotely" from "not yet uploaded".

### 20.7 Settings sync

`src/lib/sync/settingsSync.ts`.

`SYNCED_KEYS` — the subset that travels across devices:

`theme`, `customTheme`, `notesTheme`, `journalTheme`, `timezone`, `dailyDriverEnglishOT`, `dailyDriverEnglishNT`, `dailyDriverHebrewOT`, `dailyDriverHebrewNT`, `dailyDriverGreekOT`, `dailyDriverGreekNT`, `interlinear`, `showRedLetter`, `showSectionHeadings`, `showArt`, `themedTitles`

The three theme keys travel because they are taste, not ergonomics. For `customTheme` the font *id* is what crosses, not the file — every device ships every face, and an id an older deploy doesn't recognise falls back to the per-translation font.

Everything else stays per-device by design — font size, line spacing, verse layout, word wrap, rotation, update checks, `selectionMenu`, and the two editor-toolbar flags (`notesBarHidden`, `journalBarHidden`). A phone and a desktop rarely want the same font size, and whether a toolbar is slid away is the same kind of choice.

- **Push** — debounced `PUSH_DEBOUNCE_MS = 2_000` after any settings write, registered as the settings change hook (`registerSettingsChangeHook()`, `src/adapters/settings.ts`); flushed when the tab hides. `scheduleSettingsPush()`.
- **Pull** — on sign-in and `forceSync`, applied only when the server row is newer than `projectbible_settings_synced_at` (`LAST_SYNCED_KEY`). Never a blind overwrite, so a fresh install can't clobber the account's settings with an empty blob.
- `pickSynced()` omits `undefined` keys rather than writing nulls.

### 20.8 Synced store wrappers

`src/adapters/SyncedUserDataStore.ts` (426), `SyncedJournalStore.ts` (229), `SyncedReadingAdapter.ts` (447), `SyncedHighlightAdapter.ts`. Each wraps the plain IndexedDB store and enqueues a sync operation after local writes.

### 20.9 Profile modal

`ProfileModal.svelte`. Header greets by name when set. Four tabs: Reading Plan, Saved Verses/Notes, Journal, Settings. Auth views: Log in, Create Account, Reset Password. Today's reading with tappable chapter links. Inline settings: Theme, Default OT Translation, Default NT Translation.

### 20.10 Backup file

`src/lib/backup/` — `backupFile.ts` (`prepareBackup`), `restoreFile.ts` (`readBackupFile`, `backupContents`, `restoreBackup`), `saveFile.ts` (`saveFile`); UI in `src/components/YourDataPanel.svelte`, shown in the Profile Settings tab above Delete Account. Signed-in only.

- **Format.** `hexapla-backup-YYYY-MM-DD.json`: `{ app: 'hexapla', kind: 'backup', format: 1, exportedAt, data }`. `data` holds device rows exactly as stored (`user_notes`, `user_highlights`, `user_word_highlights`, `user_bookmarks`, `notebooks`, `notebook_pages`, `plan_metadata`, `reading_progress`), the `projectbible_repeats`, active-plan, plan-history and catch-up-day localStorage values, and `projectbible_settings`. The journal is the exception: read through `syncedJournalStore` so it's readable (a scrambled field only opens under the key it was made with); entries still locked or unreadable are counted and left out. Journal lock keys, window layout and other device-only state are not included. A file with a higher `format` is refused.
- **Saving.** Two taps: `prepareBackup` runs `forceSync` and builds the `File`; the save tap calls `saveFile`, which uses `navigator.share({ files })` on iOS/Android when `canShare` allows it (Android Chrome doesn't share `.json`, so it downloads) and an `<a download>` link otherwise, revoking the URL after 10 s. The share sheet needs a fresh user tap, hence building first.
- **Restore rules.** `forceSync`, restore the ticked parts, `forceSync` again. Nothing is deleted.
  - Notes, notebooks, pages, journal: newer `updatedAt` wins by id. A new id on a verse that already has a note, or a date that already has an entry, is skipped (the reader uses `notes[0]`; `journal_entries.date` is a unique index).
  - Verse highlights, word highlights, bookmarks: added only if the id is missing and the verse (or exact word range) isn't already taken. Repeat groups go through `repeatsStore.add`.
  - Journal: re-sealed with `sealFields` while `scramblesWrites()`; the panel shows `JournalLockScreen` first if the key isn't in memory.
  - Reading plans: added only if the id isn't in the active list or history (plans have no edit date); active plans get an in-progress history shadow; uploads use `planUploadOp` (`SyncedReadingAdapter.ts`, shared with the plan modal's re-upsert) and `forgetRemotePlanStatuses` clears any archived/deleted mark. Catch-up days and `plan_metadata` rows come back for added plans only.
  - Reading progress: every day with real progress for a plan on the device goes through `readingProgressStore.upsertEntries` (union merge); days that changed are queued with `queueProgressEntry`.
  - Settings: `updateSettings`, `applyTheme`, `settingsUpdated` event, `flushSettingsPush()` (`settingsSync.ts`) so the push isn't lost to the reload, then `pushAlarm()` if the file has a wake alarm.
- **Why every row is queued.** Each restored row is written locally and enqueued as a full-row `INSERT` with its original timestamps. A local-only write would be removed by `reconcileDeletedRows` on the next full pull.
- **Done** calls `location.reload()` so every store re-reads.

## 21. App Settings & Appearance

Files: `src/components/panes/SettingsPane.svelte` (860), `src/adapters/settings.ts`, `src/App.svelte`, `src/stores/clockStore.ts`, `src/lib/dailyGreeting.ts`, `src/components/DailyGreetingModal.svelte` (284), `src/components/UpdateNotice.svelte`.

### 21.1 Complete settings table

Stored in `localStorage` under `projectbible_settings` (`settings.ts`). Accessors `getSettings()`, `updateSettings()` (merges), `clearSettings()`.

| Key | Type | Default | UI location | Synced |
|---|---|---|---|---|
| `theme` | `'light' \| 'dark' \| 'auto' \| 'sepia' \| 'custom'` | `'dark'` | Settings pane, Profile | ✓ |
| `customTheme` | `CustomThemeSettings` | `DEFAULT_CUSTOM_THEME` | Settings pane → Appearance | ✓ |
| `notesTheme` | `EditorThemeSettings` | `DEFAULT_EDITOR_THEME` | Notes editor theme panel | ✓ |
| `journalTheme` | `EditorThemeSettings` | `DEFAULT_EDITOR_THEME` | Journal editor theme panel | ✓ |
| `notesBarHidden` | boolean | `false` | Notes toolbar chevron | |
| `journalBarHidden` | boolean | `false` | Journal toolbar chevron | |
| `fontSize` | number | `18` | Settings pane, range 12–32 | |
| `lineSpacing` | number | `1.8` | Settings pane | |
| `verseLayout` | `'one-per-line' \| 'paragraph' \| 'paragraph-no-verse-numbers'` | `'one-per-line'` | Settings pane | |
| `wordWrap` | boolean | `true` | Settings pane | |
| `showSectionHeadings` | boolean | `true` | **none** — see [Known gaps](#known-gaps) | ✓ |
| `showArt` | boolean | `true` | Settings pane | ✓ |
| `showRedLetter` | boolean | `true` | Settings pane | ✓ |
| `showPlaceMarkers` | boolean | `false` | Settings pane | |
| `selectionMenu` | `'classic' \| 'radial'` | `'radial'` | Settings pane → Reader | |
| `themedTitles` | boolean | `true` | Settings pane | ✓ |
| `interlinear` | `InterlinearSettings` | see [4.1](#41-settings-keys) | Navbar popover + Settings pane | ✓ |
| `tts` | `TtsSettings` | see [16.8](#168-settings) | Settings pane | |
| `wakeAlarm` | `WakeAlarmSettings` | unset | Wake Alarm pane | mirrored, see [22](#22-wake-alarm) |
| `allowRotation` | boolean | `false` | Settings pane | |
| `autoCheckUpdates` | boolean | `true` | Settings pane | |
| `timezone` | IANA string | browser-detected | Settings pane | ✓ |
| `dailyDriver*` (6 keys) | string | unset → `'kjv'` fallback | Settings pane, Profile | ✓ |

Legacy keys `dailyDriverEnglish` / `dailyDriverHebrew` / `dailyDriverGreek` are read and migrated by `normalizeSettings()` but never written.

`wakeAlarm` is the one key that does not travel through the settings-sync path — it is mirrored to its own Supabase table instead, because the server has to read it to send the push. See [22.3](#223-mirroring-the-schedule).

Note the defaults are read with three different idioms, which is why they must be read from the call site rather than the interface: `settings.x || fallback` (falsy-coercing — `fontSize`, `lineSpacing`, `verseLayout`), `settings.x !== false` (default-true — `showRedLetter`, `themedTitles`, `showArt`, `autoCheckUpdates`), and `settings.x === true` (default-false — `showPlaceMarkers`).

### 21.2 Themes

`resolveTheme()` `settings.ts` — `'auto'` resolves via `matchMedia('(prefers-color-scheme: dark)')`, falling back to `'dark'` when `matchMedia` is unavailable. `applyTheme()` swaps a single body class: `dark-theme`, `light-theme`, `sepia-theme`, or `custom-theme`.

Light and sepia are implemented as a **filter inversion** on `.themed` rather than a second stylesheet — `filter: invert(1) hue-rotate(180deg)`, plus `sepia(0.5) saturate(0.85)` for sepia (`App.svelte`). Consequences handled explicitly:

- `.emoji` gets the inverse filter re-applied so emoji don't render inverted.
- `.red-letter` likewise re-applies the filter to cancel the parent's, with a more vivid starting color for sepia since it also passes through `sepia(0.5) saturate(0.85)`.

Scrollbars are hidden globally while remaining scrollable — `scrollbar-width: none`, `-ms-overflow-style: none`, and `::-webkit-scrollbar { display: none }`.

### 21.3 The Custom theme

A fifth theme with a free choice of reader typeface, text colour and background. `CustomThemeSettings` in `settings.ts`; `DEFAULT_CUSTOM_THEME` matches the dark theme exactly, so switching to Custom changes nothing until something is edited.

**Scope is deliberately narrow.** Only the Bible reader's text area is affected. App chrome, buttons, book category colours and highlight colours are untouched, and red-letter still overrides the text colour when it is switched on.

| Field | Meaning |
|---|---|
| `fontId` | Font id from `lib/readerFonts.ts`; `''` keeps the per-translation font |
| `textColor` / `bgColor` | Hex |
| `textPresets` / `bgPresets` | Saved swatches, capped at `MAX_COLOR_PRESETS` (10) |

The two preset lists are separate on purpose — the colours that make good text are rarely the ones that make good backgrounds.

**Fonts.** `lib/readerFonts.ts` — twenty faces, self-hosted from `/fonts/` as latin-subset woff2 and declared in `index.html`. Every one is OFL or Apache licensed: the app serves the font file to every user, which counts as redistribution, so "free for personal use" faces can never be added here. Grouped by `READER_FONT_GROUPS`; looked up with `getReaderFont()` and `fontsInGroup()`.

Each `ReaderFont` carries `scale` and `lead` multipliers because x-heights differ enormously across these faces — Tangerine at 19px renders at roughly half the visual size of Bitter at 19px, and Rock Salt's ascenders collide at normal line spacing. The multipliers apply to the user's `--base-font-size` and `--line-spacing` rather than replacing them, so both sliders keep working exactly as before and switching typeface doesn't make the text lurch.

**Derived colours.** `lib/themeColors.ts` — once the user can pick any two colours, several downstream colours can no longer be hardcoded. `redLetterFor(bg)` keeps the red legible against a near-white or near-black background; `dimTowardsBg()` places secondary headings between the text and the background. Supporting maths: `hexToRgb()`, `rgbToHex()`, `isValidHex()`, `hexToHsl()`, `hslToHex()`, `luminance()`, `contrastRatio()`, `mix()`. Keeping the rules here rather than in scattered `color-mix()` calls is the point.

**Pickers.** `ColorField.svelte` and `FontField.svelte` are in-app rather than native controls, so a phone gets the same picker a desktop does.

### 21.4 Writing-surface themes

`EditorThemeSettings` — two more independent themes, for the Notes and Journal editors, so Notes can be blue-on-green while the Journal is red-on-yellow and the reader is something else again. `EditorSurface` is `'notes' | 'journal'`; sticky notes ride on `'notes'`.

`mode: 'default'` keeps the surface exactly as it shipped. The editor's CSS already has a fallback for every variable, so default mode sets *nothing at all* rather than re-stating the same values and risking a drift.

`lib/editorTheme.ts` turns a saved theme into CSS variables: `editorThemeVars()` for the live surface, `editorPreviewStyle()` for the picker's preview. The variables go on the editor's own root element rather than on `:root`, because Notes and the Journal can be open side by side in the window system and must be able to hold different themes at once.

Colour swatches are deliberately *not* stored per surface — both editors share the reader's `textPresets` / `bgPresets`, so a colour saved in one place is available in all three. UI in `EditorThemePanel.svelte`.

### 21.5 Settings pane layout

`SettingsPane.svelte` is five collapsible sections, each showing a live one-line summary of its own contents when closed, so the pane can be scanned without opening anything.

| Section | Summary | Contents |
|---|---|---|
| Appearance | theme · font size | Theme, Typeface, Text colour, Background colour, Preview |
| Reader | layout · red letters | Font Size, Line Spacing, Verse Layout, Word Wrap, Words of Jesus in red letters, Theme colors in reader titles, Show art icons on Bible scenes, Underline multi-word place names, Menu when you tap a word, plus a nested **Interlinear** sub-section |
| Read Aloud (AI voice) | voice · speed | Voice, Reading Speed, Read section headings aloud, Highlight the verse being read, Soft glow drifts along the words, Wake Alarm button |
| General | timezone · rotation | Time Zone, Allow Screen Rotation |
| Storage & Updates | Packs · Cache · Updates | Pack Management, Cache Management, auto-update toggle, manual check |

`SettingsSection.svelte` renders one section; its `sub` prop gives the nested Interlinear panel its inset styling. Open/closed state lives in `openSections`.

**There is no Save button.** Every control writes through `updateSettings()` the moment it changes and dispatches a `settingsUpdated` window event, which `App.svelte`, `BibleReader.svelte`, and the pane's own `refreshExternalSummaries` all listen for. The pane listens to its own event so that a setting changed elsewhere — the interlinear toggle in the navbar, say — updates the collapsed summary here.

### 21.6 Clock and timezone

`src/stores/clockStore.ts` — the single source of truth for "what day is it?" across the app.

Uses `Intl.DateTimeFormat` with the configured IANA timezone, so DST transitions, leap years, and offsets are handled by the platform rather than hand-rolled arithmetic.

- `localDateStr(d)` → `YYYY-MM-DD`. Any "today vs stored date" comparison must use this.
- `sameLocalDay(a, b)`
- `todayStore` — a readable that updates at midnight, so date-dependent UI re-renders without a reload.

### 21.7 Daily greeting and Verse of the Day

`src/lib/dailyGreeting.ts` — `getDailyGreeting(dateStr)`, taking a `YYYY-MM-DD` string from `localDateStr()`.

Floating Christian holidays (Easter, Good Friday, and so on) and Thanksgiving are computed algorithmically per year, so they land on the correct calendar day regardless of timezone or year.

`DailyGreetingModal.svelte` parses a verse-of-the-day reference (single verse or range), loads each verse via `textStore.getVerse()`, renders through `renderVerseHtml()`, and offers `goToVerse()` which navigates to the start verse.

Triggered from `App.svelte`: 800 ms after mount, and again on every `todayStore` change so a midnight rollover with the app open still fires it. Logic in `src/stores/dailyGreetingStore.ts` (`checkAndShowDailyGreeting`). Toolbar entry point `NavigationBar.svelte`.

### 21.8 Auto-update

`App.svelte`, gated on `autoCheckUpdates !== false`.

- Checks for a new service worker on mount and on every visibility resume — an installed PWA usually resumes rather than relaunching, so `onMount` alone would miss most reopens.
- On `controllerchange`, sets `sessionStorage['pb-updated'] = '1'` and reloads once.
- Two guards: `hadController` skips the very first install (no controller yet), and the one-shot `swReloaded` flag prevents reload loops.
- After the reload, `UpdateNotice.svelte` shows "Running Latest Version".
- Manual "Check for Updates" and "Clear cache" (packs, service workers, databases) in `SettingsPane.svelte`.

### 21.9 Global keyboard shortcuts

`App.svelte`. **J** — open today's journal entry in a right-edge window at 50%. Suppressed when the event target is an `input`, `textarea`, or `contenteditable`, and when Ctrl/Meta/Alt is held.

### 21.10 Debug tooling

Eruda is initialized on every mount (`App.svelte`), positioned 60 px from the bottom-right corner. It is a mobile debug console and ships in production on purpose — it is how this app gets debugged on a real phone, so do not gate it behind a flag. It loads *after* `appReady`, because its half-megabyte chunk was the last thing the "Loading App…" screen waited for; the cost is that messages logged during launch predate its console and so are missing from its Console tab.

## 22. Wake Alarm

An alarm that opens the app on a passage at a set time. **A web app cannot schedule itself awake**, so the trigger lives on the server: the phone registers for Web Push, the server sends at the appointed minute, and the notification wakes the device even with the app fully closed. An alarm that exists only in `localStorage` will never fire.

Files: `src/lib/alarm/alarmSchedule.ts`, `alarmSync.ts`, `pushSubscription.ts`, `resolvePassage.ts`; `src/stores/wakeAlarmStore.ts`; `src/lib/supabase/wakeAlarm.ts`; `src/components/panes/WakeAlarmPane.svelte`, `src/components/WakeAlarmStart.svelte`. Server half: `supabase/functions/wake-alarm-send/`. Setup and troubleshooting: `apps/pwa-polished/WAKE-ALARM-SETUP.md`.

### 22.1 The schedule

`WakeAlarmSettings`, `src/adapters/settings.ts`:

| Field | Meaning |
|---|---|
| `enabled` | Armed or not |
| `time` | `'HH:MM'`, 24-hour, in the user's timezone |
| `days` | `0`=Sunday … `6`=Saturday; empty means every day |
| `source` | `'continue'` (pick up where you left off), `'chapter'` (a fixed chapter), or `'plan'` (the reading plan's next day) |
| `book` / `chapter` | Only when `source === 'chapter'` |

### 22.2 Time math

`alarmSchedule.ts` is pure functions. The alarm fires in the user's *chosen* timezone, which is not necessarily the one the device is in. Rather than constructing Dates in a foreign zone — fragile — it asks `Intl` what the wall clock currently reads there and does plain arithmetic on hours and minutes.

`wallClockIn()`, `parseTimeToMinutes()`, `minutesUntilAlarm()`, `formatTime12h()`, `formatCountdown()`, `formatDays()`.

The countdown these produce is a **display label** ("rings in about 8 hr"), not the trigger. The server decides when to actually send.

### 22.3 Mirroring the schedule

`alarmSync.ts`. Unlike settings sync this is not a convenience — the scheduled sender is the only thing that can wake a sleeping phone, so it has to know the schedule.

Saves are pushed **immediately, not debounced**: the user pressed Save on an alarm and expects it to be armed. `pushAlarm()`, `pullAlarmIfUnset()`, `sendTestAlarm()`. Table access in `src/lib/supabase/wakeAlarm.ts` — `upsertWakeAlarm()`, `fetchWakeAlarm()`.

### 22.4 Push subscription

`pushSubscription.ts` — the half of the alarm that lives on the phone. A subscription is a URL at the browser vendor's push service plus two encryption keys; handing that to the server is what lets it wake this phone later.

`isInstalledApp()`, `pushSupport()`, `ensurePushSubscription()`, `notificationPermission()`, `showTestNotification()`.

### 22.5 What it reads

`resolvePassage.ts` — `resolveAlarmPassage()` returns an `AlarmPassage`.

Resolved **on the device at the moment it opens**, rather than baked into the push: a chapter you finished at 11pm, or a plan day you completed last night, is reflected at 6am instead of being frozen at whatever the server knew when it sent.

`WakeAlarmStart.svelte` is the screen shown when the app is opened by the alarm; `App.svelte` listens for a `wake-alarm-opened` service-worker message to trigger it.

### 22.6 The sender

`supabase/functions/wake-alarm-send/index.ts`. `pg_cron` calls it once a minute (migration 009); it finds alarms whose local wall-clock time has just arrived and posts an encrypted Web Push to every device that user has registered.

Two callers, distinguished by the token they present:

- **the admin key** → scheduled sweep, checking every armed alarm.
- **a user's JWT** → immediate test push to that user's own devices only, behind the "Send a real test alarm" button, so the whole path can be verified without waiting for 6am.

Two things reliably go wrong, both documented in `WAKE-ALARM-SETUP.md`:

- **The admin key is compared as a string, not decoded.** On a project using the newer API keys, `SUPABASE_SERVICE_ROLE_KEY` holds the `sb_secret_…` key — not the legacy `service_role` JWT sitting next to it in the dashboard. The cron job must carry that exact value; anything else lands in the user branch and is refused.
- **`last_fired_on` guards against double-sending**, so an alarm that already fired today stays quiet. If cron succeeds but nothing arrives, that column is the first place to look; clearing it re-arms.

### 22.7 Entry point

Settings pane → Read Aloud section → Wake Alarm button, which opens the `wakealarm` pane. The sleep timer is the other half of the same idea and lives with Read Aloud — see [16.4](#164-sleep-timer).

## 23. The Study Library

Four reference works, browsable like books rather than only reachable by tapping a word: **Dictionary**, **Topical**, **Encyclopedia**, and **People**.

Files: `src/lib/openWork.ts`, `src/stores/lookupStore.ts`, `src/components/LookupModal.svelte`, `WorkTabs.svelte`, `src/components/library/` (`AlphabetRail`, `IndexList`, `LibraryNavButtons`, `RefSearchBar`), `src/lib/library/source.ts`, `src/stores/libraryPrefsStore.ts`. Per-work bodies: `LexicalContent.svelte`, `NavesContent.svelte`, `IsbeContent.svelte`, `PersonContent.svelte`.

### 23.1 One card, four works

`lookupStore` holds which work is on top, or `null` when no card is up. **There is one card, not four.** Each work still keeps its own state in its own store; this only says which is in front. That separation is what makes the tabs behave like tabs — switching changes this value, the card itself never unmounts, and the work you left keeps its place for when you come back.

Previously there were four cards and switching meant closing one and opening another, so you watched the card shut and a new one slide up.

### 23.2 The work tabs

`WorkTabs.svelte` — all four tabs across the top of every lookup card, always drawn, always in the same order, at equal widths so a tab is in the same place every time regardless of label length. A tab is greyed when that work has nothing for the subject.

These replaced a row of "bridge pills" that changed depending on which card you were in: the encyclopedia offered Topical and Dictionary, stepping into Topical changed the set, and so there was never a fixed thing to aim at.

Availability comes from `resolveWorks`, which returns **ids rather than booleans** — so a lit tab is one that will definitely open something.

### 23.3 Switching works

`src/lib/openWork.ts` is the single path. `WorkKey` is `'dictionary' | 'topical' | 'encyclopedia' | 'people'`, mapped to window content types `wordstudy`, `naves`, `isbe`, `person`.

This is one path on purpose. The tabs used to call the old "jump to the encyclopedia" buttons, which were built to *replace* the card you were on and only knew how to open a centred card — so inside a docked window they threw a card over the whole app instead of changing the window. Tabs and jump-links wanting different things from the same code is what caused that, so the jump-links are gone and everything comes through here.

`worksInWindow()`, `carriedWorks()`, `clearCarriedWorks()`, `openWorkSubject()`, `openWorkIndex()`.

### 23.4 Browsing a work

`IndexList.svelte` is the contents list — an A–Z rail, one letter's rows at a time, and a small personal shelf of starred and recently-read entries on top. A letter can run past a thousand rows, so rows are added a chunk at a time as you scroll rather than all at once.

**Rows are pinned by id, not by name.** The encyclopedia files "NOAH (1)" and "NOAH (2)" both under the name "Noah", and 166 names collide that way, so a name cannot identify a row.

`AlphabetRail.svelte` shows letters that have entries and how many. Letters with none are **dimmed rather than hidden**, so the strip stays a stable A–Z ruler you can aim at by muscle memory.

`RefSearchBar.svelte` is a per-work collapsing search in the header. Its styling is lifted from `NavigationBar`'s `.pill-search-*` rules on purpose — same height, colors and focus ring — so the library reads as part of the same app rather than a second search box with its own opinions. Unlike the navbar's, it fills whatever width the header leaves it, because a docked window is far narrower than the nav pill.

`LibraryNavButtons.svelte` supplies back and flip controls, which replaced the earlier hamburger.

### 23.5 One shell, three lists

`src/lib/library/source.ts`. `IndexList` doesn't know what an ISBE entry is, or a Nave's topic, or a person — it knows how to draw an alphabet, a letter's worth of rows, and a set of filter chips. Each work supplies a `LibrarySourceAdapter` and gets the whole browsing shell for free, **which is why the three lists come out identical rather than merely similar.**

`isbeSource`, `navesSource`, `peopleSource`. `LibraryBadge` is `'place' | 'bio' | 'entry' | 'topic' | 'dict'`; badges are navigable — tapping one opens the work it marks.

### 23.6 Personal layer

`src/stores/libraryPrefsStore.ts` — which entries you starred, which you read lately, and where you left off in each source, persisted to `localStorage` and keyed by source so the three lists keep their own stars and history rather than sharing one pile.

`LibrarySource` is `'isbe' | 'naves' | 'people'`. `resumeTarget()`, `isStarred()`.

`RESUME_WINDOW_MS` is 30 minutes: reopening a library window inside that window resumes where you were, and after it opens fresh. A window you come back to an hour later is a new session, not an interrupted one.

## 24. Nave's Topical Bible

A classic topical index — a subject, its outline, and the verses under each point. Ships inside the `encyclotopical` pack alongside ISBE; builder `scripts/build-encyclotopical-pack.mjs`.

`src/stores/navesModalStore.ts`, `src/components/NavesContent.svelte`, Nave's functions in `src/adapters/lexicon-lookup.ts`, list behaviour via `navesSource` in [23.5](#235-one-shell-three-lists).

### 24.1 Store

Opened with just an id and a display name; the modal fetches the outline and verse list itself — the same arrangement as `isbeModalStore`, so the two bridge to each other symmetrically. `NavesTab` is `'outline' | 'verses'`; a normal open starts on the outline.

### 24.2 Data

Five object stores, added in migration 33:

| Store | Keyed / indexed by | Holds |
|---|---|---|
| `naves_topics` | `topicId`; index `primaryNameLower` | The topic itself |
| `naves_names` | auto id; indexes `nameLower`, `topicId` | Title and "also called" spellings → topic |
| `naves_points` | auto id; index `[topicId, seq]` | The numbered outline structure |
| `naves_verses` | auto id; indexes `topicId`, `[book, chapter, verse]` | Verse citations |
| `naves_tokens` | auto id; index `token` | Full-text token index for deep search |

`naves_points` is indexed on `(topicId, seq)` rather than `topicId` alone because the outline is read in document order.

### 24.3 Access

`getNavesTopic()`, `getNavesVerses()`, `resolveNavesTopicId()`, `getNavesTopicName()`, `getNavesLetterCounts()`, `getNavesForLetter()`, `getNavesNeighbors()`, `searchNaves()`, `getNavesInChapter()`.

Outline links are coloured by the book they reference, like every other reference in the app, rather than all sharing one colour.

## 25. People

Browsable biographies of the people of the Bible, bridged to the other three works.

`src/stores/personModalStore.ts`, `src/components/PersonContent.svelte`; list behaviour via `peopleSource` in [23.5](#235-one-shell-three-lists).

People used to be the odd one out of the four works: a bio could only reach the screen riding `lexicalModalStore.characterData` — that is, as a word study of a word that happened to be a person — so **nothing could navigate to a bio.** `personModalStore` gives it the same standing as the encyclopedia and topical stores, so all four bridge to each other symmetrically.

Opens either way `PersonContent` accepts: by id from the library and the work tabs, or with a whole resolution when a clicked word matched several people and the homonyms have to be offered. A contents list keeps the last-read name as its title, and opening a specific person — one of the several Herods, say — keeps that person rather than resetting to the first match.

A bio can be **pinned beside the reader** rather than covering it, and links family relationships as navigable references. The "also called" list wraps and reads as a list rather than running off the edge.

## 26. Notes & Notebooks

`src/components/NotesPane.svelte` — the desk, behind a **Local / Shared** toggle. Three things live here, all signed-in only:

1. Every verse note, in the same book dropdown the search results use.
2. Notebooks the user names themselves, each holding free-form pages.
3. Shared notebooks — the same thing kept with other people ([26.7](#267-shared-notebooks) onwards).

Layout is a **drill-down**: list → tap → full-panel editor → ‹ Back. One shape at every panel width, so a 20%-wide sliver and a 50/50 split both work. A shared page opens in a reader rather than an editor ([26.14](#2614-badges-and-the-pill-gutter)), because the default there is reading somebody else's work.

### 26.1 Notebooks

`src/adapters/NotebookStore.ts` — local IndexedDB CRUD. A **notebook** is a named folder; a **page** is one note inside it. Verse-anchored notes are a separate thing entirely and live in `UserDataStore` / `user_notes`.

`SyncedNotebookStore.ts` wraps the local class to add cloud sync — components import that singleton, not the plain store. Stores: `notebooks`, `notebook_pages` (migration 32).

### 26.2 Bible references in the editor

`src/lib/lexical/BibleRefNode.ts` — a reference the editor understands as one thing.

**Why a custom node at all:** the editor rebuilds its HTML from its own node tree on every keystroke. A plain `<span>` injected into stored HTML is stripped on the first edit, and autosave then writes the stripped version back. A reference has to be a node or it cannot survive being typed near.

Collapsed, the node holds one text child — the canonical reference, editable, re-checked after every keystroke. Expanded, it holds a second child with the verse text, and **both** children switch to `'token'` mode: selectable, copyable and deletable as a unit, but impossible to type inside. A verse printed in a note must be the verse.

`$createBibleRefNode()`, `$isBibleRefNode()`, `$getRefDisplayNode()`, `$getRefVerseNode()`, `$fillCollapsed()`.

### 26.3 The two transforms

`src/lib/lexical/bibleRefTransforms.ts` — the two rules that keep references honest:

1. **Plain text becomes a reference** — but only once the reference is followed by a space or punctuation, so "Luke 1" doesn't link and rewrite itself while you're still typing "12".
2. **A reference re-checks itself after every edit.** Correct "Luke 12:1" to "Luke 12:11" and the link follows; break it into something that isn't a reference and it drops quietly back to ordinary text.

Both run inside the same update that produced the keystroke, before the screen repaints — there is no timer and nothing to outrun. `registerBibleRefTransforms()`, `$expandRef()`, `$collapseRef()`, `formatVerseSuffix()`.

Deleting the reference takes the printed verse with it; deleting the verse text collapses the link again. Spaces do not cling to links, and a bad verse number keeps the valid part rather than dropping the whole reference.

`BibleRefPopover.svelte` is the menu a reference opens — navigate, expand, collapse.

### 26.4 What counts as a reference

`src/lib/bibleRefs.ts` — one place that decides. Both reference linkers call it: the commentary linker, which walks stored HTML and allows book-less references because it knows what chapter you are reading, and the notes editor, which **requires a book on every reference** because a note has no such context.

The matching itself was lifted from `linkifyCommentaryRefs` so commentary keeps behaving exactly as it did — only its home changed. Everything is a pure function and the stateful regexes are reset at the top of every call, so a Commentary window and a Notes window can be detecting at the same moment without interfering.

`resolveBook()`, `isValidChapter()`, `isValidVerse()`, `couldBecomeRef()`, `findRefs()`. Types `RefMatch`, `FindRefsOptions`.

### 26.5 The editor shell

`src/lib/components/RefAwareEditor.svelte` wraps `LexicalEditor` with the transforms registered. The formatting toolbar slides away out of the way, tracked per-surface by `notesBarHidden` / `journalBarHidden` — per-device, like font size. Theming is [21.4](#214-writing-surface-themes).

### 26.6 Global handlers and text entry

`src/lib/isTextEntry.ts`. Several handlers listen on `window` or `document` for every press or keystroke — the edge-swipe detector, the reader's click-away, the contents list's type-to-jump — and each has to leave text fields alone. Historically each learned that the hard way: a new input would refuse to accept typing and would get its own hand-rolled `stopPropagation` shield.

That is backwards. **A global handler should excuse text entry itself**, so a new field works the moment it is added rather than after someone remembers to defend it. `isTextEntry()` is the one test they all share, using `closest` rather than a tag check so it also covers a click landing inside a `contenteditable`.

### 26.7 Shared notebooks

A shared notebook is one that several accounts read and write. Same desk, same drill-down, same editor — what changes is that the rows belong to a group rather than to one person, and nearly everything underneath changes with it.

The browse header carries a **Local / Shared** toggle. Local is verse notes and your own notebooks ([26.1](#261-notebooks)); Shared is the ones you keep with other people. Both halves are drawn by one component — `NotebookList.svelte`, which took the notebook and page rows out of `NotesPane.svelte` so the two sides cannot drift into two layouts — handed different accents (`LOCAL_ACCENT` `#667eea`, `SHARED_ACCENT` `#2dd4bf`), different capability flags (`canAddPage`, `canInvite`, `canEditBadge`, `pageDeleteWord="Remove"`) and different rows. Open/closed keys are namespaced by `keyPrefix`, so a row left unfolded on one side does not unfold anything on the other.

Two axes, both the owner's, both switchable afterwards ([26.17](#2617-running-a-notebook)):

| Column | Values |
|---|---|
| `kind` | **group** — everyone who may write, writes. **broadcast** — a handful write, any number read. |
| `visibility` | **private** — signed in and a member, or there is nothing to see at all. **public** — anyone holding the link may read; writing always needs an account. |

Three roles live on the member row — `admin`, `writer`, `reader` — and are shown throughout as **Runs it**, **Writes** and **Reads**. A writer in a Broadcast notebook is drawn as "Reads", because that is what they can do (`roleWord()`, `SharedNotebookAdmin.svelte`).

The feature by file:

| File | What it holds |
|---|---|
| `supabase/migrations/012_shared_notebooks.sql` | three tables, ten policies, the guard, every RPC — [26.8](#268-the-server-migration-012) |
| `src/adapters/SharedNotebookStore.ts` | the store, the pull, and every write — [26.9](#269-sharednotebookstore) |
| `src/lib/shared/sanitizeNoteHtml.ts` | the allowlist every page passes through twice — [26.10](#2610-the-sanitiser) |
| `src/lib/shared/ids.ts`, `joinCode.ts` | UUIDs for shared rows; the code, its link, its QR — [26.11](#2611-ids-and-join-codes) |
| `src/lib/shared/sharedPermissions.ts` | one function per rule, each mirroring a policy — [26.13](#2613-permissions) |
| `src/lib/shared/memberIdentity.ts`, `paragraphStamp.ts` | badges, and who wrote which line — [26.14](#2614-badges-and-the-pill-gutter) |
| `src/lib/shared/sharedRealtime.ts` | the channel, presence and the lock — [26.15](#2615-live-presence-and-the-one-writer-lock) |
| `src/lib/shared/sharedOutbox.ts` | what you wrote with no signal — [26.18](#2618-offline) |
| Components | `SharedNotebookCreate`, `SharedNotebookJoin`, `SharedJoinLayer`, `PublicNotebookReader`, `SharedPageView`, `SharedLiveBar`, `SharedNotebookAdmin`, `MemberPillPicker`, `CopyPageSheet`, `QrCode`, `AuthorPill`, `NotebookList` |

### 26.8 The server: migration 012

`supabase/migrations/012_shared_notebooks.sql` — 819 lines, idempotent, and the only SQL the feature ever needed. Everything from the third phase on was client work against functions already sitting in here.

**Tables.** All three take a `TEXT` primary key holding a UUID the app made ([26.11](#2611-ids-and-join-codes)), and all three have row-level security on.

| Table | Notable columns |
|---|---|
| `shared_notebooks` | `owner_id`, `name`, `kind`, `visibility`, `join_code` (unique), `join_open`, `rev` |
| `shared_notebook_members` | `notebook_id`, `user_id`, `role`, `display_name`, `initials`, `color`; unique on `(notebook_id, user_id)` |
| `shared_notebook_pages` | `notebook_id`, `author_id`, `title`, `text`, `edit_mode`, `pinned`, `sort_order`, `rev`, `deleted_at`, `updated_by` |

Two revision counters, both bumped by `shared_page_bump_rev()` on every page write and every delete. The page's own `rev` is what a conflict is measured against; the notebook's is what a signed-out reader polls, one number instead of a held-open connection. `deleted_at` is a soft delete, so a device that was offline when a page was taken out learns about it on its next pull instead of quietly uploading the page again.

**Membership helpers**, all `SECURITY DEFINER` on purpose: the policies below call them, and a policy on `shared_notebook_members` that read `shared_notebook_members` through RLS would call itself. `is_shared_notebook_member()`, `shared_notebook_role()`, `can_write_shared_notebook()`, `owns_shared_notebook()` — each answers only about the caller, so none can be turned on somebody else's membership.

**Ten policies**, three of which carry the whole shape of the feature: *Writers can add shared pages*; *Authors, and open pages, can be edited*; *Authors and the owner can delete shared pages*. Reading is by membership; changing the notebook itself, and writing anybody's member row, is the owner's.

**`shared_page_guard()`**, a `BEFORE INSERT OR UPDATE` trigger — the cheap second line behind the client sanitiser, refusing the handful of things the editor can never legitimately produce:

- over 200,000 characters (`MAX_PAGE_CHARS` client-side is the same number)
- raw markup — `<script>`, `<iframe>`, `<style>`, `<svg>`, or any `on…=`, `href=`, `src=` attribute. A `<` typed as prose arrives escaped, so a live tag in stored text was never something a person typed.
- more than 1,000 live pages in a notebook, or more than 30 new ones a minute from one author
- `pinned` set by anyone but the notebook's owner: quietly dropped on insert, because an older client could send it meaning nothing by it, and refused outright on update

**The functions the app calls.** Everything that writes goes through one of these rather than through a plain insert:

| Function | Notes |
|---|---|
| `create_shared_notebook(p_id, p_member_id, p_name, p_kind, p_visibility, p_display_name, p_initials, p_color)` | makes the notebook and the owner's member row in one statement |
| `join_shared_notebook(p_code, p_member_id, p_display_name, p_initials, p_color)` | the only function that reads a notebook by code |
| `reset_shared_notebook_code(p_notebook_id)` | owner only; returns the new code |
| `save_shared_page(p_id, p_notebook_id, p_title, p_text, p_base_rev, p_edit_mode, p_pinned, p_created_at)` | returns `JSONB` — `{status, page}` with a status of `saved`, `conflict` or `deleted` |
| `remove_shared_page(p_id)` | sets `deleted_at` and nothing else, so there is no path here by which an owner puts words into somebody else's page |
| `read_public_shared_notebook(p_code)` / `public_shared_notebook_rev(p_code)` | the signed-out pair — [26.12](#2612-joining-inviting-and-reading-signed-out) |
| `new_shared_notebook_code()` | the generator; alphabet without `0 O 1 I L U` |

`delete_account()` is re-created at the end of the migration with the three new tables swept: a notebook the leaver owned goes with them and cascades, and their membership of other people's notebooks — and the pages they wrote there — go too.

The last statement is a self-check. A correct run reports the three tables true, `functions_ready` 12, `policies_ready` 10, `triggers_ready` 3 and `realtime_tables` 3 — the three tables being in the `supabase_realtime` publication is what [26.15](#2615-live-presence-and-the-one-writer-lock) rides on.

### 26.9 SharedNotebookStore

`src/adapters/SharedNotebookStore.ts` (1,530) — deliberately separate plumbing from `SyncedNotebookStore`, and it has to stay that way.

**Why it is not in the sync engine.** The single-user engine injects `user_id` into every write, scopes every pull to the signed-in account, and then has `reconcileDeletedRows` delete any local row that pull did not return. Every one of those is right for a table holding one person's rows and wrong for a table holding everybody's — aimed here, the last would wipe other people's pages off this device the first time it ran. So the shared tables stay out of the `SyncTable` union and out of `RealtimeService`'s list, and get their own pull, their own reconciliation and their own outbox.

**What makes reconciliation safe here** is that the pull is scoped by *membership* rather than authorship. What comes back is exactly the set of rows this account may see, so a row missing from it really is gone.

`pull({force})` in order: `flushOutbox()` first — up before down, or a pull would replace the page written on a train with the older one the server still has; then all three tables at once, with any one of them erroring abandoning the whole reconciliation rather than acting on a half-answer; then `replaceAll` per store. Un-forced pulls are rate-limited to one per 10 seconds, and an offline device returns without trying.

**Two exceptions to "a row missing from the pull is gone".**

1. A whole notebook that stops coming back is kept and stamped `removedAt` (`markMissingNotebooksRemoved()`), and its members and pages are spared with it. Being removed from a study group should not make the evening you spent writing in it vanish off your phone without a word. The copy left behind is inert — see `isReadOnlyCopy()` in [26.13](#2613-permissions) — and `forgetNotebook()` is the one thing its holder can still do. `removedAt` is local only; the server has no such column, so re-joining clears it.
2. A page with writing still in the outbox is left exactly as it is, both ways round: the server's older copy does not replace it, and a page started offline — which the server has never heard of, so it is missing by definition — is not mistaken for one that was removed.

Shapes: `SharedNotebook`, `SharedNotebookMember`, `SharedNotebookPage`, `SharedPageSaveResult`, `PublicSharedNotebook`. `subscribeToSharedNotebookChanges()` fires whenever a pull changed anything, and is what the pane redraws from.

The singleton is `sharedNotebookStore`. Reads: `getNotebooks()`, `getNotebook()`, `getMembers()`, `getAllMembers()`, `getMyMembership()`, `getPages()`, `getAllPages()`, `getPage()`, `pendingPages()`. Writes: `createNotebook()`, `joinByCode()`, `createPage()`, `savePage()`, `removePage()`, `updateMyBadge()`, `updateNotebook()`, `resetJoinCode()`, `setMemberRole()`, `removeMember()`, `leaveNotebook()`, `forgetNotebook()`. Signed-out: `readPublic()`, `publicRev()`. Housekeeping: `pull()`, `flushOutbox()`, `clear()`.

`SharedPageSaveResult.status` is `saved` | `conflict` | `deleted` | `queued` — none of the four is an error, which is why it is a returned value. A *refusal* (a reader writing, a closed page) is a different thing and throws.

### 26.10 The sanitiser

`src/lib/shared/sanitizeNoteHtml.ts`. A local note is HTML this device wrote and only this device reads back. A shared page is HTML somebody else wrote, parsed into the DOM here. So it runs at both ends — before upload, so this device never publishes something odd it picked up from a paste, and again on the way in, because neither side should have to trust the other. A page that was clean when written and one tampered with in between look identical from here.

What survives is exactly what the editor can produce:

| | |
|---|---|
| Tags | `p`, `br`, `span`, `strong`, `b`, `em`, `i`, `u`, `s`, `strike`, `del`, `sub`, `sup` |
| Classes | the seven `editor-*` theme classes, plus `bible-ref`, `is-expanded`, `is-pending` |
| Styles | `font-size` (bounded to 3 digits of px), `text-align`, `white-space`, `--ref-color` — each checked against its own pattern, not just its name |
| Attributes | `class`, `style`, `dir` anywhere; `data-ref`, `data-book`, `data-chapter`, `data-verse`, `data-expanded`, `role` on a verse reference; `data-pid` and `data-pills` on a paragraph |

Everything else goes: every link, image, script, event attribute and id, and every style that could paint or position anything. Colour is the point of the exercise — a shared page carries structure, and how it looks comes from the reader's own settings, exactly as a local note does. Tags in `DROP_ENTIRELY` lose their text with them; everything else unknown is unwrapped instead, because a stray `<div>` round a paragraph is clutter whereas the text inside a `<script>` is the attack.

`sanitizeNoteHtml()` returns `''` for anything that isn't a string, so a malformed row renders as an empty page rather than throwing on the way in. `sharedPagePreviewText()` sanitises before reading text out, so previews and emptiness checks never touch raw markup. `isPageWithinSizeLimit()` checks `MAX_PAGE_CHARS` (200,000) before upload, so the writer is told plainly rather than meeting the database's refusal as a sync failure.

### 26.11 Ids and join codes

`src/lib/shared/ids.ts`. The single-user tables use `generateId()` — the clock plus a short random tail — which is fine when one device is making the row. Two people on two devices inserting into the same table is a different situation, and a collision there does not lose a draft, it overwrites somebody's page. So every shared row gets a real v4 UUID from `sharedId()`, falling back from `crypto.randomUUID()` to `getRandomValues()` for the one case that isn't a secure context: a plain `http://` dev server reached over the LAN.

`paragraphId()` is deliberately *not* a UUID. There is one per paragraph and they are written into the page's own HTML, so a 200-paragraph page would carry 7 KB of ids alone; 11 random characters is far more room than "unique within one page" needs.

`src/lib/shared/joinCode.ts`. A shared notebook is found by its code and by nothing else — only the anon key ever reaches this app and no policy grants a stranger so much as a listing, so you either hold the code or you do not.

`JOIN_CODE_ALPHABET` is `ABCDEFGHJKMNPQRSTVWXYZ23456789` and `JOIN_CODE_LENGTH` is 8 — no `0 O 1 I L U`, so a code survives being read aloud across a room or copied off a screen at arm's length. The alphabet is repeated here rather than imported from the migration, because the two halves are checked in different places and a code this side rejected would never reach the function that made it.

`normalizeJoinCode()` drops case, whitespace and the hyphen; it guesses nothing else. Mapping a typed `O` to `0` is tempting and wrong — the confusable characters are exactly the ones the alphabet leaves out, so there is no correct letter to map them *to*, and silently substituting a plausible one produces a code that is wrong in a way nobody can see. `isJoinCode()` says so instead. `formatJoinCode()` prints `ABCD-EFGH`, presentation only. `buildJoinUrl()` builds from the page's own origin and path, exactly as `buildShareUrl` does and for the same reason: the same build is served from more than one host. `JOIN_PARAM` is `join`.

### 26.12 Joining, inviting, and reading signed out

**`SharedNotebookCreate.svelte`** — a name, and the two choices that are awkward to change later, both in plain words rather than named: "Everyone writes" / "Only you write", private by default, with the warning on the public option because that is the one that cannot be taken back from anybody already holding the link.

**`SharedNotebookJoin.svelte`** — both ends of a code in one sheet. `invite` mode shows the code, the link built from it, and that link as a QR; `join` mode takes a code and puts you in. They are together on purpose: one code read from one side or the other, and keeping them in one file is what stops the two halves disagreeing about what a code looks like. The invite side reuses `canShare`/`copyText`/`shareText` from `src/lib/clipboard.ts` — the same handling behind [the share sheet](#20-account--sync). An NFC tag later needs no work at all: a tag holds a URL, and the link is already the whole of it.

**`QrCode.svelte`** — draws only, never scans; phone cameras open a QR link by themselves, so showing one is the whole feature. `qrcode-generator` is 20 KB and wanted on exactly one sheet, so it is `import()`ed on demand the way Lexical is. Rendered as SVG rather than canvas so it stays sharp and survives the screenshot people inevitably take of it, with the spec's four-module `QUIET` zone — a scanner finds the code by its quiet zone, and one pressed flush to the edge of a dark card is one many phones simply will not see.

**`src/stores/sharedJoinStore.ts`** — `pendingJoinCode`, `requestJoin()`, `clearJoin()`. The app has no router, so `?join=` is read once at launch by `openSharedLink()` in `App.svelte` and stripped from the address bar, exactly as `?ref=` is. A code cannot act on itself — it arrives before anything is on screen, before the session is known, possibly on a device with no account — so it is parked in the store and picked up once there is an app to answer in. The Shared tab's "type a code" route sets the same store, so both ways in land on the same sheet.

**`SharedJoinLayer.svelte`** — what a code turns into, decided by who is holding it: signed in, the join sheet with the code filled in (a link should never silently add you to somebody's notebook, so there is always a confirmation); signed out with a public notebook, the read-only reader; signed out with a private one, a refusal that deliberately does not explain much. It draws nothing at all until a code arrives.

**`PublicNotebookReader.svelte`** — the whole of what a signed-out reader gets, and a deliberate dead end: no editor, no button that writes, no way to reach another notebook from it. It is not a member either — nothing is written to IndexedDB, nothing syncs, and no realtime connection is held. The pages are read once by `readPublic()` and kept in memory, and `publicRev()` — one number — is what says whether to read them again. That is what lets a great many people read one notebook at once without a socket each.

### 26.13 Permissions

`src/lib/shared/sharedPermissions.ts` — one function per rule, each mirroring a policy in 012. The server is the authority and refuses on its own; these exist so the app never offers a button the database is going to turn down, which is a far worse way to find out you are a reader than simply not being shown a pencil. Add to this file rather than inlining a check in a component: the header, the row menu and the save path must not be able to disagree.

| Function | The rule |
|---|---|
| `isReadOnlyCopy()` | a notebook this account has been put out of. **Asked first in every other rule** — the stale member row kept alongside it would otherwise still answer "writer" |
| `canManageNotebook()` | the owner, and nobody else. 012 draws the same line in the UPDATE policy and in `reset_shared_notebook_code()`. An admin may write in a notebook; running it is a different thing |
| `canLeaveNotebook()` | anybody but the owner — every rule that runs a notebook is written as "the owner", so one walking out leaves a notebook nobody can run |
| `canWriteInNotebook()` | what `can_write_shared_notebook()` says: an admin always, a writer in a Group notebook, nobody else. A writer in a Broadcast notebook is deliberately shut out — that is how an owner quietens a notebook without removing anybody |
| `canEditPage()` | the author always, whatever else is true. Anyone else needs both: the author left the page open, and the notebook lets them write |
| `canRemovePage()` | the author, and the notebook's owner over anybody's page — removing is moderation, rewriting is not, which is why these are two questions |
| `canSetEditMode()` | opening and closing a page is its author's, and only its author's — closed means closed, so the switch cannot belong to anyone who could then be talked into opening it |
| `canPinPage()` | both at once: you own the notebook *and* you wrote the page. Owning it makes the top of the list yours to arrange; writing it stops that from being a way to move somebody else's work about. The guard trigger refuses the other combinations, so this is the app agreeing rather than deciding |

Each takes what it needs and nothing more, so they can be asked about a notebook that isn't open and a page that isn't loaded. A missing membership is a "no" rather than a crash.

There is still **no delete-the-whole-notebook**, and an owner cannot leave — the deliberate gap, and the one to close if a way out for an owner is wanted.

### 26.14 Badges and the pill gutter

**`AuthorPill.svelte`** — two letters on a coloured disc. Written three times before it existed once: BibleReader's verse gutter, AnnotationPanel's header, and now a notebook's members. There is no logic in it on purpose — which colour and which letters belong to whom has two different answers (`annotationConfig` for a commentator, the member row for a person) and neither is the component's business. Two shapes, both exactly as they were: `gutter` 20×14 for a margin, `round` 22×22 for a heading. `breathing` is the slow pulse marking the pill whose panel is open; `extraClass` is kept because the tutorial looks for `.anno-icon`.

**`src/lib/shared/memberIdentity.ts`** — the defaults a join can work out without reading a roster it is not yet in. `defaultInitials()` gives initials from two words and the first two letters from one; `defaultMemberColor()` derives from the user id rather than picking at random, so a phone and a laptop agree. `MEMBER_COLORS` is the commentary palette in a fixed order — fixed because a palette that reordered itself would give the same person a different colour on a different device.

A colour is *identity*, not appearance: unlike the typeface and the page colours, which are each reader's own, it is stored on the member row and looks the same to everybody. Deriving it can therefore land on one somebody already wears, which is a collision in a badge and not in data. **`MemberPillPicker.svelte`** is where that is settled — per notebook, because the colour's whole job is telling people apart inside one group, and the same person can be teal in one and amber in another. Colours already taken are marked, not refused.

**`src/lib/shared/paragraphStamp.ts`** — who worked on which line. On every save the stored version and the one being saved are lined up paragraph by paragraph: unchanged text keeps its id and its pills exactly; a rewritten paragraph keeps its id and gains the saver; a new one gets a new id and starts with just them; one that has gone, goes. `MAX_PILLS` is 16, and past it the earliest names are kept — the first author most of all — with the person who just typed taking the last place, because the gutter must not lie about the line in front of them.

**The ids are deliberately not carried through Lexical.** Its `ParagraphNode` has a fixed set of attributes and drops every other one when HTML is parsed in, so a round-tripped `data-pid` comes back missing and every paragraph looks brand-new. Teaching it otherwise means a node replacement inside an editor four other surfaces share, to hold data only this one uses. So the stored page is the only place the ids live, and the lining-up above is what stands in for matching on them: anchoring the unchanged lines first means editing one line in the middle of a page touches exactly one paragraph — the answer an id match would have given. **Do not "fix" this by adding a Lexical node.**

Pills are keyed on **user id**, not member-row id, so leaving and rejoining does not orphan them. `stampParagraphs()`, `splitPageBlocks()`, `stripStamps()`; the type is `PageBlock`.

**The gutter is drawn in `SharedPageView.svelte`**, not in the editor. It renders a shared page block at a time rather than as one lump of HTML, because each paragraph has a gutter of its own carrying the pills of everybody who has written in that line, in the order they first did — the same arrangement several commentators get on one verse in the reader, and the same badge. A page nobody has stamped yet draws no gutter at all and reads exactly as it did before any of this existed. The HTML goes through the allowlist again here even though the store already cleaned it on the way in: the cost is nothing, and it means no path exists by which unchecked markup reaches `innerHTML`.

Verse references keep working in a shared page — they survive as spans carrying the attributes `BibleRefNode` writes, so a tap opens the same menu ([26.2](#262-bible-references-in-the-editor)). Expanding one works **on the screen only** and is gone when the page is reopened: writing it into the page would edit everybody's copy, bump the revision, and count as a save nobody asked to make. In the editor the same gesture goes through `RefAwareEditor` and is saved, which is the right place for it.

**The honest limit:** all of the stamping happens on the writer's device, so it is a record of who worked on a line rather than proof of it. Which account created a page and which saved it last come from the server and can be trusted. Within a study group that is the right trade, and it is worth knowing before it is relied on for anything weightier.

### 26.15 Live: presence and the one-writer lock

`src/lib/shared/sharedRealtime.ts` — one channel named after the notebook, carrying two things:

1. **Postgres changes** on the three shared tables, filtered to that notebook. What arrives is only ever a *nudge*: the payload is thrown away and `SharedNotebookStore.pull({force:true})` fetches the row, so IndexedDB still has exactly one writer and a payload that arrived out of order cannot become the copy this device keeps. This device's own saves are filtered out by `updated_by`. A burst — a save touches the page and the notebook — is debounced into one nudge at `CHANGE_DEBOUNCE_MS` 250 ms.
2. **Presence**, new to this app: each device says which page it has open and whether it is writing in it. That is the whole of the lock, and it is deliberately not a row anybody has to remember to clear — presence disappears by itself when the app closes or the signal goes, so a lock can never get stuck with nobody holding it.

Kept out of `RealtimeService` for the same reason the store is kept out of the sync engine: that channel is filtered to one account's own rows and everything hanging off it assumes so.

**One notebook at a time** — the one whose page is open, or the one last unfolded in the list. A device only ever looks at one, and a socket per notebook somebody happens to be a member of would spend the realtime allowance on notebooks nobody is reading. A **reader of a Broadcast notebook holds no socket at all**: `mode: 'poll'`, the same nudge arriving every `POLL_MS` 45 seconds, and no presence because there is no channel to carry it. That is what makes a public notebook with a thousand readers possible. A notebook kept after removal opens neither.

The store is `sharedLive` (`notebookId`, `mode: 'off' | 'live' | 'poll'`, `connected`, `people: LivePerson[]`). Control: `openSharedLive()`, `closeSharedLive()`, `setLivePage()`, `setLiveWriting()`, `pingLiveTyping()`. Reading the room: `writerOfPage()` takes the earliest claim, breaking a tie on the lower user id so every device sorts the same list the same way without asking the server who was first; `isIdleWriter()` against `WRITER_IDLE_MS` 60 s. Typing re-announces the claim at most once every `TYPING_PING_MS` 15 s — it is a keystroke handler. `liveClock` ticks every 10 s and fetches nothing: "they stopped a minute ago" has to be able to become true on its own, and a writer going quiet is exactly the case where no presence event arrives.

**`SharedLiveBar.svelte`** is the thin strip under the header, in both the reader and the editor, because the answer matters in both: reading, the page may move under you; writing, somebody else is in it and one of you is going to be asked to keep theirs separately. Everybody is drawn as the badge they already wear, so the strip needs no legend; somebody on this very page gets a ring. It draws nothing when there is nobody else about. Once idle, anyone who could edit anyway is offered **Take over**.

In the editor the strip is a warning rather than a lock. The revision check is what actually protects the prose — presence is advisory on top of it.

### 26.16 Across the line

`CopyPageSheet.svelte` — a page of your own sent to a shared notebook, and a page in a shared notebook kept in one of your own. Both directions are a **copy, never a link**: what you send goes on being your page here, what you keep goes on being their page there, and anything written on either side afterwards stays where it was written. The sheet says that in those words rather than leaving it to be discovered by surprise.

One sheet for both, doing the copy itself the way the create and join sheets do, so the busy state and a refusal have somewhere to be shown; `NotesPane` works out the destinations (`CopyDestination`) and leaves off any shared notebook this account may only read, rather than offering it and then being refused.

Sending goes through the ordinary `createPage()`, so the copy is sanitised and stamped on arrival and every paragraph starts out credited to whoever sent it — in that notebook it is their page. Coming the other way, `stripStamps()` takes the pids and pills off, because a paragraph id and its pills only mean anything beside the roster they were stamped against. Keeping a copy asks nothing of the notebook, so it sits on the page menu for everyone, a Broadcast reader included; an account that has never made a notebook of its own gets Quick Notes made for it rather than an empty list.

### 26.17 Running a notebook

`SharedNotebookAdmin.svelte` (862) — one sheet off every shared notebook's row menu, for two quite different readers. Anybody in the notebook sees the roster — each person as the badge they wear, with what they may do and how many pages are theirs — and can leave. Its owner sees the same list with controls on it and the notebook's own settings underneath. Together rather than apart because every one of those decisions is about the same thing, and somebody who has just realised a person should not be writing in their notebook should not have to guess which of two screens to look on.

The owner can move somebody between **Reads / Writes / Runs it**, or take them out — which asks *separately* whether their pages go with them, because a group usually wants to keep the notes and lose the access. Joining can be closed, leaving everyone already in where they are, and a new code issued, which kills every old link, QR and written-down code at once. Group/Broadcast and private/public are switchable here rather than settled at creation.

Nothing on the sheet decides anything the database does not decide again — the owner-only half is the owner-only half of 012. What it adds is that a member who may not do a thing is not shown it.

The third state is the sad one: a notebook this account has been removed from. Its rows are kept rather than deleted ([26.9](#269-sharednotebookstore)), so the evening somebody spent writing in it is still there to read — the row says you are no longer in it, the byline on every page says it too, no channel or presence is opened, and every permission answers no. All the sheet can offer is the plain sentence and `forgetNotebook()`, which takes the copy off this device.

### 26.18 Offline

`src/lib/shared/sharedOutbox.ts` plus the IndexedDB store `shared_outbox` (schema 36 → 37). A page written on a train cannot go to the server, must not be thrown away, and must not be treated as though it had arrived. So it is written into the local copy — which is what the reader draws — and a note of it is put in the outbox. On reconnect it goes through the same `save_shared_page` every online edit goes through, revision check included.

**Keyed on `pageId`**, so one row per page rather than one per autosave: twenty minutes offline means "send what I end up with", not "replay every keystroke on the way there". A later edit folds into the waiting one and keeps its `baseRev` and `createdAt` — the oldest `baseRev` because that is still the newest version of everybody else's work this device has seen, and the original `createdAt` so a page begun offline is still *created* rather than updated.

**Stamped and sanitised when queued, not when sent.** The pills are worked out against the stored page, and while offline the stored page is the only one there is; stamping at the door means the gutter is right on the device straight away and the text that eventually goes up is the text that was on screen. `flushOutbox()` therefore sends it as-is rather than stamping twice.

**The flush runs at the top of `pull()`** — up before down — and on the browser's own `online` event, so coming out of aeroplane mode is enough on its own; a **Try now** button is there for anyone who would rather press something. What the flush finds decides what happens to the item: delivered, and it goes; **refused, and it goes too**, with the database's own sentence shown and the words still in the local copy, because retrying a refusal only produces the refusal again; never arrived — `isOffline(err)`, a `TypeError` from a fetch that never left the building — and it stays.

**A conflict forks.** A page somebody else wrote in meanwhile is not merged and not chosen between: it becomes "… (your version)" in the same notebook, saved through `save()` with `previousText === text` so every paragraph anchors and the stamps cross with it — the fork keeps the record of who wrote which line instead of crediting all of it to whoever was offline. That is the same fork the bar offers when a conflict happens with somebody watching (**Keep mine as a new page**, never a silently chosen winner). Removing a page queues the same way, and a page both created and removed offline simply goes rather than being created a moment before being deleted.

Functions: `queueWrite()`, `pendingWrites()`, `pendingFor()`, `pendingPageIds()`, `dropWrite()`, `markAttempt()`, `dropNotebookWrites()` (leaving a notebook, and throwing away a removed copy — neither should leave a write behind that goes on trying), `clearOutbox()`, `isOffline()`, `subscribeToOutboxChanges()`. The outbox **holds no permission of its own**: what may be written is decided by `sharedPermissions` before anything reaches it and by the policies in 012 when it leaves.

In the pane, a waiting page is marked on its row (`ListPage.waiting`) and gets a quiet strip in both the reader and the editor — *"Saved here. It goes to the notebook when you are back online."* Not a warning and not an error: nothing has gone wrong and nothing needs doing, and it is there so that writing on a train is never mistaken for writing everyone can already see.

Everything else in a shared notebook — joining, the code, roles, badges — asks the server a question it cannot answer offline, so those say so in one sentence through `requireOnline()` rather than pretending.
---

## Appendix A — Data layer

Not user-facing features, but every feature above sits on these.

### A.1 IndexedDB

`src/adapters/db.ts`. Database `projectbible`, **schema version 37** — 32 added the notebook stores, 33 the `naves_*` stores that carry Nave's Topical Bible, 34 the `atlas_*` stores behind the Historical Map pack, 35 `journal_lock` and `journal_key_slots`, 36 the three `shared_notebook_*` stores, and 37 `shared_outbox` ([26.18](#2618-offline)).

Object stores, grouped by what they serve:

| Group | Stores |
|---|---|
| Packs & text | `packs`, `verses`, `art_images` |
| User data | `user_notes`, `user_highlights`, `user_word_highlights`, `user_bookmarks`, `journal_entries`, `journal_lock`, `journal_key_slots`, `notebooks`, `notebook_pages` |
| Shared notebooks | `shared_notebooks`, `shared_notebook_members`, `shared_notebook_pages`, `shared_outbox` |
| Topical | `naves_topics`, `naves_names`, `naves_points`, `naves_verses`, `naves_tokens` |
| Study | `cross_references`, `strongs_entries`, `greek_strongs_entries`, `hebrew_strongs_entries`, `lexicon_entries`, `pronunciations`, `morphology`, `word_occurrences`, `tsk_references`, `commentary_entries` |
| English lexical | `english_words`, `english_synonyms`, `thesaurus_synonyms`, `thesaurus_antonyms`, `english_grammar`, `english_definitions_modern`, `english_definitions_historic`, `english_definitions_wordset`, `word_mapping` |
| Places & maps | `places`, `place_name_links`, `map_tiles`, `historical_layers`, `pleiades_places`, `modern_places` |
| Reading | `reading_history`, `reading_plans`, `reading_plan_days`, `reading_progress`, `plan_metadata`, `chronological_order` |
| Audio | `audio_chapters`, `audio_cache` |
| Sync | `sync_queue`, `sync_operations` — the shared tables are deliberately **not** in this engine ([26.9](#269-sharednotebookstore)) |

`word_mapping` is keyed on `lemma` rather than an id — it is the lookup that makes English definitions resolve off lemma rather than surface text (see [5.3](#53-english-word-lookup)).

Row types are declared as `DB*` interfaces in the same file (`DBVerse`, `DBUserNote`, `DBSectionHeading`, `DBArtScene`, and so on).

`src/adapters/db-manager.ts` (339) handles open/upgrade/reset; `src/adapters/index.ts` and `src/lib/adapters.ts` are the barrel exports.

### A.2 Text access

`IndexedDBTextStore`, `src/adapters/TextStore.ts` — the read path every reader surface goes through.

| Method | Line |
|---|---|
| `getVerse(...)` | 68 |
| `getChapter(...)` | 98 |
| `getTranslations()` → `{id, name}[]` | 158 |
| `getBooks(translation)` | 227 |
| `getChapters(translation, book)` | 268 |
| `getVerses(translation, book, chapter)` | 306 |

`HeadingsStore`, `src/adapters/HeadingsStore.ts` — `getChapterHeadings()`, `isInstalled()`. Supplies the pericope headings described in [1.2](#12-what-appears-in-the-text).

`src/adapters/SearchIndex.ts` (`IndexedDBSearchIndex`) backs the Bible category of unified search.

### A.3 Caching

`src/lib/lru-cache.ts` — `LRUCache<K, V>`, evicting least-recently-accessed on overflow. One shared instance is exported: `dictionaryCache = new LRUCache<string, any>(500)`.

### A.4 Startup

- `src/main.ts` — Svelte mount point. Launch waits on one thing: `hasStarterText()`, a single IndexedDB check. Only a device with no text draws the progress screen and waits for `installStarterText()`; every other launch mounts straight away.
- `src/lib/progressive-init.ts` — the starter-text check and install, `warmPackManifest()` (the pack list, fetched after mount rather than before it), and on-demand pack loading.
- `src/adapters/pack-import.ts` (2,116) — the SQLite → IndexedDB import pipeline; the largest non-component file in the app.

### A.5 Type declarations

`src/sql.js.d.ts` and `src/lib/tts/vendor/piper-phonemize.d.ts` — ambient declarations for the two vendored WASM libraries. No runtime behavior.

---

## Known gaps

Things found during the sweep that are wired but incomplete, or where code and comments disagree. Documented here rather than described as working features.

| Item | Detail |
|---|---|
| `showSectionHeadings` has no UI toggle | The setting is honored by the reader (`BibleReader.svelte`) and is in the synced-settings list (`src/lib/sync/settingsSync.ts`), but no control exists in `SettingsPane.svelte`. It can only change via sync or a manual `localStorage` edit. |
| `fontSize` / `lineSpacing` doc-comment defaults are stale | `src/adapters/settings.ts` documents defaults of `15` and `1.5`. The applied defaults are `18` and `1.8` (`SettingsPane.svelte`). The code is the truth; the comments are wrong. |
| `isChronologicalMode` has no UI control | Flag and setter exist on the nav store (`navigationStore.ts`) and are persisted, but nothing in the navbar or settings sets them. |
