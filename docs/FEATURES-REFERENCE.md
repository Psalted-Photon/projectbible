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
17. [Audio](#17-audio)
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

Files: `src/lib/services/searchService.ts` (579), `src/components/PowerSearchModal.svelte` (1,370), `src/components/UnifiedSearch.svelte`, `src/components/panes/SearchPane.svelte`, `src/components/SearchResultsTree.svelte`, `src/lib/searchTree.ts`, `src/adapters/SearchIndex.ts`, `src/stores/searchStore.ts`, `src/components/HelpModal.svelte`.

### 9.1 Unified search service

`UnifiedSearchService`, `searchService.ts` — singleton, exported as `searchService`.

Eight categories (`SearchCategoryKey`): `bible`, `strongs`, `notes`, `journal`, `saved`, `characters`, `encyclopedia`, `commentaries`. Result types (`SearchResult`) mirror these one-to-one.

`SearchCategory` carries `alwaysShow` (render the group even at zero results — used by Saved Verses until that ships) and `truncated` (the count shown is what's displayed, not what exists).

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
| Search | Journal is one of the eight unified-search categories; `searchService` reads it via `IndexedDBJournalStore` directly. |
| Sync | `SyncedJournalStore.ts` — see [20. Account & Sync](#20-account--sync). |

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

Files: `src/components/MapPane.svelte` (833), `src/components/panes/MapPane.svelte`, `src/adapters/MapStore.ts`, `src/adapters/PlaceStore.ts` (234). Uses Leaflet.

### 14.1 Map store

`IndexedDBMapStore`, `MapStore.ts`:

| Method | Line |
|---|---|
| `getBaseTiles(zoom, bounds)` | 5 |
| `getTile(zoom, x, y)` | 40 |
| `getHistoricalLayer(layerId)` | 62 |
| `getTimePeriods()` | 78 |
| `getLayersForPeriod(period)` | 105 |
| `getLayersForYear(year)` | 131 |
| `hasOfflineData()` | 145 |

Tiles are stored in IndexedDB, so the map works fully offline. See `docs/OFFLINE-MAP-TILES.md`.

### 14.2 Place store

`IndexedDBPlaceStore`, `PlaceStore.ts`:

| Method | Line |
|---|---|
| `getPlace(placeId)` | 15 |
| `getPlacesForVerse(reference)` | 30 |
| `searchPlaces(query)` | 59 |
| `getPlaceByName(name, period?)` | 108 |
| `getPlacesInBounds(bounds)` | 143 |
| `getPlacesByType(type)` | 167 |
| `getPlaceAppearance(placeId, period)` | 197 |

`getPlaceByName` and `getPlaceAppearance` are period-aware — the same name can resolve to different locations in different eras.

### 14.3 Encyclopedia link

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

Pre-recorded chapter audio, distinct from [16. Read Aloud](#16-read-aloud-tts). Files: `src/components/AudioPlayer.svelte` (261), `src/adapters/audio.ts` (379), `src/stores/audioStore.ts`.

`AudioPlayer` props: `book`, `chapter`. Controls: play/pause, seek slider, stop, continuous-play toggle, dismiss, loading spinner.

`continuousPlay` is a shared store used by both the audio player and the TTS player, so auto-advance behaves the same either way.

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

Pane components: `src/components/panes/SettingsPane.svelte`, `PacksPane.svelte`, `SearchPane.svelte`, `MapPane.svelte`, `WakeAlarmPane.svelte`; container `src/components/PaneContainer.svelte`. The Notes pane is `src/components/NotesPane.svelte` — see [26](#26-notes--notebooks).

While the Settings pane is open the reader stays visible behind it rather than being covered, so a change to font size or theme can be judged against real text.

### 18.4 Orientation

Setting `allowRotation`, default `false` (portrait-locked). `applyOrientationLock()`, `src/App.svelte` — tries `'portrait-primary'` then falls back to `'portrait'`; failures are swallowed since desktop and tablet browsers often don't support the API.

Re-applied on visibility resume to handle tablet app-switching and whenever settings are saved. Deliberately **not** re-applied on orientation change itself — doing so fought the OS on tablet and confused mobile.

`handleOrientationChange()` fades `.app-root` to opacity 0 over 0.25 s and back after 350 ms, so a rotation reads as a transition rather than a snap.

## 19. Content Packs

Files: `src/components/panes/PacksPane.svelte` (1,238), `src/adapters/PackManager.ts`, `src/adapters/pack-import.ts` (2,116), `src/lib/pack-init.ts` (497), `src/lib/pack-triggers.ts`, `src/lib/progressive-init.ts`, `src/lib/bootstrap-loader.ts`, `src/components/ProgressModal.svelte`, `src/adapters/db-manager.ts` (339).

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

### 19.5 English lexical packs

`src/components/EnglishLexicalPacksModal.svelte` (325). A dedicated loader for the English dictionary/thesaurus packs, separate from the general pack flow.

Imports `englishLexicalPackLoader` from `packages/core/src/search/englishLexicalPackLoader` — note this reaches across the monorepo by relative path (`../../../../packages/core/src/...`), so it is one of the places where the app depends on `@projectbible/core` source rather than its built `dist`. Loads from `/packs/polished`, reports per-pack `LoadProgress`, and checks `arePacksLoaded()` on mount so it can show a ready state instead of re-downloading.

### 19.6 Configuration

`src/config.ts`. `APP_VERSION = '1.0.0'`.

- `PACK_MANIFEST_URL` — `/api/packs/manifest.json` in production (proxied to GitHub Releases), `/packs/consolidated/manifest.json` in dev.
- `USE_BUNDLED_PACKS` — true in dev, or when `VITE_USE_BUNDLED_PACKS === 'true'`.
- `BOOTSTRAP_PACK_URL = '/bootstrap.sqlite'` — always bundled with the app.
- `FEATURES` — `lazyPackLoading`, `progressiveStartup`, `packUpdates` (all keyed off `!USE_BUNDLED_PACKS`), `persistentStorage`, and `ttsReadAloud` (a kill switch for Read Aloud).
- `PACK_PRIORITY` — `essential: [bootstrap]`, `high: [translations]`, `medium: [study-tools, lexical]`, `low: [ancient-languages, bsb-audio-pt1, bsb-audio-pt2]`.
- `PACK_TRIGGERS` — which user action loads which pack: `translations` on `reader-open`, `ancient-languages` on `hebrew-greek-toggle`, `lexical` on `word-study-open`, `study-tools` on `maps-open`, both audio packs on `audio-play`.
- `UI` — `showProgressDuringDownload`, `allowPackRemoval`, `showStorageUsage`, `promptForPersistentStorage`.

### 19.7 Related docs

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

Eruda is initialized on every mount (`App.svelte`), positioned 60 px from the bottom-right corner. This is a mobile debug console and ships in the current build — worth removing or gating before a public release.

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

`src/components/NotesPane.svelte` — the desk. Two things live here, both signed-in only:

1. Every verse note, in the same book dropdown the search results use.
2. Notebooks the user names themselves, each holding free-form pages.

Layout is a **drill-down**: list → tap → full-panel editor → ‹ Back. One shape at every panel width, so a 20%-wide sliver and a 50/50 split both work.

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

---

## Appendix A — Data layer

Not user-facing features, but every feature above sits on these.

### A.1 IndexedDB

`src/adapters/db.ts`. Database `projectbible`, **schema version 33** — migration 31 added `art_images` for bundled painting blobs, 32 added the notebook stores, and 33 added the `naves_*` stores that carry Nave's Topical Bible.

Object stores, grouped by what they serve:

| Group | Stores |
|---|---|
| Packs & text | `packs`, `verses`, `art_images` |
| User data | `user_notes`, `user_highlights`, `user_word_highlights`, `user_bookmarks`, `journal_entries`, `notebooks`, `notebook_pages` |
| Topical | `naves_topics`, `naves_names`, `naves_points`, `naves_verses`, `naves_tokens` |
| Study | `cross_references`, `strongs_entries`, `greek_strongs_entries`, `hebrew_strongs_entries`, `lexicon_entries`, `pronunciations`, `morphology`, `word_occurrences`, `tsk_references`, `commentary_entries` |
| English lexical | `english_words`, `english_synonyms`, `thesaurus_synonyms`, `thesaurus_antonyms`, `english_grammar`, `english_definitions_modern`, `english_definitions_historic`, `english_definitions_wordset`, `word_mapping` |
| Places & maps | `places`, `place_name_links`, `map_tiles`, `historical_layers`, `pleiades_places`, `modern_places` |
| Reading | `reading_history`, `reading_plans`, `reading_plan_days`, `reading_progress`, `plan_metadata`, `chronological_order` |
| Audio | `audio_chapters`, `audio_cache` |
| Sync | `sync_queue`, `sync_operations` |

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

- `src/main.ts` — Svelte mount point.
- `src/lib/bootstrap-loader.ts` — loads `bootstrap.sqlite`, the always-bundled minimum pack.
- `src/lib/progressive-init.ts` — staged startup, gated by the `progressiveStartup` feature flag.
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
