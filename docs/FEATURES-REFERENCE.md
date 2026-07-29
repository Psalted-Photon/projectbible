# ProjectBible — Feature Reference

Exhaustive engineering record of every feature in `apps/pwa-polished`. Same tree as [FEATURES.md](FEATURES.md), but each leaf adds the settings key, default value, shortcut or gesture, and the source file it lives in.

All paths are relative to `apps/pwa-polished/`.

**Contents**

1. [Reading the Bible](#1-reading-the-bible)
2. [Getting Around](#2-getting-around)
3. [Translations](#3-translations)
4. [Interlinear (Greek & Hebrew)](#4-interlinear-greek--hebrew)
5. [Word Study](#5-word-study)
6. [Bible Encyclopedia](#6-bible-encyclopedia)
7. [Commentaries](#7-commentaries)
8. [Cross-References](#8-cross-references)
9. [Search](#9-search)
10. [Highlights & Notes](#10-highlights--notes)
11. [Repeated Words](#11-repeated-words)
12. [Journal](#12-journal)
13. [Reading Plans & Progress](#13-reading-plans--progress)
14. [Maps & Places](#14-maps--places)
15. [Art](#15-art)
16. [Read Aloud](#16-read-aloud)
17. [Audio](#17-audio)
18. [Panes & Windows](#18-panes--windows)
19. [Content Packs](#19-content-packs)
20. [Account & Sync](#20-account--sync)
21. [App Settings & Appearance](#21-app-settings--appearance)

---

## 1. Reading the Bible

Primary file: `src/components/BibleReader.svelte` (~5,280 lines — the largest component in the app; it owns the reading surface, verse rendering, selection, highlighting, and infinite scroll).

### 1.1 The reading page

| Feature | Detail |
|---|---|
| Continuous scrolling | Chapters append as you scroll in either direction. The reader holds an array of loaded chapters rather than one chapter at a time. `BibleReader.svelte` |
| Scroll-driven nav sync | Updates book/chapter in the nav store as you scroll, deliberately without setting `scrollTargetVerse` — setting it would trigger an auto-scroll that fights the user. `navigationStore.setScrollPosition()`, `src/stores/navigationStore.ts:161` |
| Verse layout | Setting `verseLayout`, default `'one-per-line'`. Values: `'one-per-line'`, `'paragraph'`, `'paragraph-no-verse-numbers'`. Applied as CSS classes `.paragraph-layout` / `.nonumber-layout` at `BibleReader.svelte:4192`. Read at `BibleReader.svelte:550`. |
| Word wrap | Setting `wordWrap`, default `true`. `src/components/panes/SettingsPane.svelte:58` |
| Position persistence | Translation, book, chapter, and panel toggles persisted to `localStorage` under `projectbible_nav`. `src/stores/navigationStore.ts:49` |
| First-launch default | `WEB`, John 1. `src/stores/navigationStore.ts:26` |

### 1.2 What appears in the text

All text rendering runs through `renderVerseHtml()` in `src/lib/verseRendering.ts:249`.

| Feature | Detail |
|---|---|
| Red-letter | Setting `showRedLetter`, default `true`. Spans loaded lazily from `/red-letter-spans.json`, keyed `{transId: {"BOOK:CH:V": [{s,e}]}}`; network failure degrades silently. Rendered via `\x02`/`\x03` sentinels into `.red-letter`. Theme-specific colors — dark `#FF3F3F`, light `#CC0000`, sepia `#FF2020` — set in `src/App.svelte:300-309`, which re-applies the parent invert filter so the light/sepia theme filter doesn't bleach the red. `BibleReader.svelte:196` |
| Section headings | Setting `showSectionHeadings`, default `true`. Extracted from the leading `+ Heading. ` marker in stored verse text by `extractHeading()`, `verseRendering.ts:296` — a leading run that *is* `\x01`-terminated is a note, not a heading, and is left alone. Rendered at `BibleReader.svelte:4205`. Level 3 is the Psalm 119 acrostic labels (`\qa` ALEPH, BETH…) from the headings pack. **No UI toggle exists** — see [Known gaps](#known-gaps). |
| Footnotes | Stored as `+ note text` runs terminated by a `\x01` sentinel. Rendered as `<sup class="inline-note inline-footnote">[n]</sup>` in `#6699ff`. `renderTextWithInlineNotes()`, `verseRendering.ts:94` |
| Cross-reference markers | Same mechanism, rendered grey `#ccc` with class `.inline-xref`. Classified by `isCrossReference()`, `verseRendering.ts:19` — a note counts as a cross-reference if it contains a `\d+:\d+` token and does *not* begin with a wording-note starter (`Or`, `Lit`, `I.e.`, `That is`, `Some manuscripts`, `Gr.`, `Gk.`, `Heb.`, `Aram.`, `Lat.`). |
| Note-boundary detection | `findNoteEnd()`, `verseRendering.ts:48` — the `\x01` sentinel *is* the boundary; it is read, never inferred. Shared by the HTML renderer, the preview cleaner and the read-aloud extractor so the three can never disagree. A `+` run with no terminator is rendered verbatim as text: guessing a boundary from prose is what used to swallow scripture, so the fix is in the pack builders, not here. |
| Poetic lines | `\x11` opens a poetic line, `\x12` an indented one, `\x10` a stanza break (verse-initial only). Deliberately not `\x0B`/`\x0C`, which JS treats as whitespace and `trim()` would eat. A marker leading the verse becomes `.poetry-1`/`.poetry-2`/`.stanza-break` on the verse element via `verseStructure()`; mid-verse markers become `<br>` in `renderVerseHtml()`. The joining space is stored *beside* the marker, so stripping the markers reproduces marker-less text exactly and no character offset (highlights, TTS glow, red-letter spans) shifts. Written by `build-bsb-pack.mjs` and `packtools/parsers/usfm-parser.mjs`. |
| Plural "you" | LXX2012 carries a bare `⌃` meaning the preceding "you" is plural. Rendered as `<sup class="plural-marker">[pl]</sup>`; dropped from previews and read-aloud. |
| Bold / italic | `<b>` and `<i>` preserved from pack text via `extractFormattingSpans()`, `verseRendering.ts:209`, using `\x04`–`\x07` sentinels. All other HTML tags stripped. Coexists with red-letter spans (e.g. NET Matthew 4:4). |
| Art icons | Setting `showArt`, default `true`. Scene map keyed `"book:chapter:verse"`, rebuilt per rendered chapter set. `BibleReader.svelte:311-338`; see [15. Art](#15-art). |
| Place-name underlines | Setting `showPlaceMarkers`, default `false`. Requires the ISBE pack. Only multi-word phrases are marked (`is_phrase = 1` rows in `isbe_place_names`) — single words would be noise. `src/lib/placeMarkerRenderer.ts` |
| Repeat/marker coexistence | `placeMarkerRenderer` only wraps runs of pure text and skips nodes already inside a repeat or marker span. Apply order is always repeats first, then markers, so neither system can corrupt the other. `placeMarkerRenderer.ts:12-14`, `applyPlaceMarkersToAllSections()` at `:150` |
| Themed titles | Setting `themedTitles`, default `true`. Category-colored 3D shadow on reader titles/headings. |
| Category mascot colors | Category → color map in `BibleReader.svelte:166`, kept in sync with the nav dropdown colors in `src/lib/bibleData.ts:128`. |

### 1.3 Book introductions

`src/components/BookIntroPanel.svelte` (312 lines). Props `open`, `book`.

Navigating away from the panel sets a flag so Back reopens it; a separate flag suppresses auto-reopen when the navigation came from the panel itself. `BibleReader.svelte:354-380`.

### 1.4 Book of Enoch

`src/lib/enochBooks.ts`. Two editions, lazily loaded per author id:

- `enoch:charles` — "Robert Henry Charles, 1917 (Book of Enoch)"
- `enoch:laurence` — "Richard Laurence, 1821 (Book of Enoch)"

Chapters carry a printed `label` (e.g. "Chapter 72" / "Chapter LXXII") plus `headings[]`. Helpers: `isEnochAuthor()`, `enochLabelFor()`, `loadEnoch()`.

## 2. Getting Around

Primary files: `src/stores/navigationStore.ts`, `src/components/NavigationBar.svelte` (2,101 lines), `src/lib/bibleData.ts`, `src/lib/parseRefString.ts`.

### 2.1 The book and chapter picker

- 66 books defined in `BIBLE_BOOKS`, `src/lib/bibleData.ts:12`.
- Ten categories with both colors (`CATEGORY_COLORS`, `:128`) and display labels (`CATEGORY_LABELS`, `:142`): `pentateuch` `#a67c52` Pentateuch, `historical` `#6ca0dc` Historical, `wisdom` `#f0c040` Wisdom, `major-prophets` `#5c1e99` Major Prophets, `minor-prophets` `#a45be9` Minor Prophets, `gospels` `#fc345c` Gospels, `acts` `#ff6520` Acts, `pauline` `#6048cc` Pauline Epistles, `general` `#f2893e` General Epistles, `revelation` `#61f1ff` Eschaton.
- `getBookColor()` `:156` falls back to neutral grey for unknown books.
- Chapter counts from `getBookChapters()` `:161`; the picker renders a chapter grid, `NavigationBar.svelte:1121`.
- Book list filtered by translation scope via `getAvailableBooks()` `:225`.

### 2.2 Moving between passages

| Feature | Detail |
|---|---|
| Back | `navigationStore.goBack()`, `:172`. History is a separate `navigationHistory` writable; `canGoBack` derived store `:192` gates the button. Toolbar button at `NavigationBar.svelte:774`. When the back button is active the navbar is fully hidden in the main reader (`BibleReader.svelte:409`). |
| Link navigation + flash | `navigationStore.navigateToVerse()` `:127` sets `linkHighlightVerse`, which flashes the target verse in its book's category color, then clears via `clearLinkHighlight()` `:142`. Handles same-chapter and cross-book cases; fires only once the target chapter is in the DOM (`BibleReader.svelte:689`). |
| Plain navigation | `navigationStore.navigateTo()` `:114` — sets `scrollTargetVerse` without the flash. |
| TSK reference parsing | `parseRefString(ref, contextBook, contextChapter)`, `src/lib/parseRefString.ts:226`. Handles `"Ex 20:21"`, `"Am 5:18-20"` (range → first verse), `"3:14,15"`, `"8:22"`, and bare `"10,31"` relative to context. |
| OSIS reference parsing | `parseOsisRef()`, `parseRefString.ts:262` — e.g. `"Gen.2.4"`, `"1John.4.9-1John.4.10"`. |
| Abbreviation table | Lower-cased KJV/TSK abbreviation → canonical book name, `parseRefString.ts:21`. Separate alias table `BOOK_NAME_ALIASES` at `bibleData.ts:93`, applied by `normalizeBookName()` `:120` on every `setBook`/`navigateTo`. |
| Reading session | `src/stores/readingSessionStore.ts`. `src/stores/harmonyNavStore.ts` is a backwards-compatibility re-export only — it exports `readingSessionStore` under the old `harmonyNavStore` name. |
| Chronological mode | `isChronologicalMode` flag on `NavigationState`, with `setChronologicalMode()` `:86`; persisted. **No UI control found** — see [Known gaps](#known-gaps). |

## 3. Translations

| Feature | Detail |
|---|---|
| Picker | `NavigationBar.svelte:790` (button), `:1078` (`selectTranslation`). Available list in `availableTranslations` writable, `navigationStore.ts:21`. |
| Translation scope | `TRANSLATION_SCOPES` map, `bibleData.ts:174`; type `TranslationScope = 'full' \| 'nt-only' \| 'ot-only'`, `:171`. Resolved by `getTranslationScope()` `:197`. |
| Book-availability fallback | `getFirstAvailableBook()`, `bibleData.ts:242`. On translation switch the reader verifies the current book exists in the new translation and falls back if not — `BibleReader.svelte:849`. |
| Daily drivers | Six settings keys: `dailyDriverEnglishOT`, `dailyDriverEnglishNT`, `dailyDriverHebrewOT`, `dailyDriverHebrewNT`, `dailyDriverGreekOT`, `dailyDriverGreekNT`. No defaults; `getDailyDriverFor()` falls back to `'kjv'`. |
| Testament resolution | `getDailyDriverFor(book)`, `src/adapters/settings.ts:153`. OT books listed inline `:157`. OT preference order: Hebrew OT → Greek OT → English OT → legacy English → `'kjv'`. NT order: Greek NT → Hebrew NT → English NT → legacy English → `'kjv'`. |
| Primary driver | `getPrimaryDailyDriver()`, `settings.ts:178`. Prefers an OT-capable English driver because the UI initializes at Genesis. |
| Legacy migration | `normalizeSettings()`, `settings.ts:74` — migrates the older 3-field model (`dailyDriverEnglish` / `dailyDriverHebrew` / `dailyDriverGreek`) into the OT/NT model on read. English fans out to both OT and NT; Hebrew maps to OT; Greek maps to NT. |

## 4. Interlinear (Greek & Hebrew)

Files: `src/components/InterlinearControls.svelte` (254 lines), settings in `src/adapters/settings.ts:15-23`, reader state at `BibleReader.svelte:535`.

`InterlinearControls` is used in two contexts, driven by two props:

- `showEnableToggle` (default `true`) — shows the master enable checkbox. Set `false` in the navbar popover, where the header button already owns `enabled`; in that case `persist()` strips `enabled` before writing so it can't clobber a fresher value. `InterlinearControls.svelte:49-54`
- `showPreview` (default `true`) — on in Settings, off in the compact navbar popover (the live reader text behind it already shows the effect).

Persisting dispatches a `settingsUpdated` window event; the reader re-reads settings and re-renders on it (`BibleReader.svelte:623`).

### 4.1 Settings keys

Interface `InterlinearSettings`, `settings.ts:15`. Resolved with defaults by `getInterlinearSettings()` `:208`, written by `updateInterlinearSettings()` `:222`.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master on/off. Only applies when a Greek/Hebrew translation is open. |
| `preset` | `'minimal'` | `'minimal' \| 'study' \| 'scholar' \| 'custom'` |
| `showGloss` | `true` | English equivalent. Checkbox is rendered `disabled` — always on. `InterlinearControls.svelte:118` |
| `showTranslit` | `false` | Transliteration / pronunciation |
| `showLemma` | `false` | Dictionary (lexical) form |
| `showStrongs` | `false` | Strong's number |
| `showParsing` | `false` | Morphology / part-of-speech |

### 4.2 Presets

`INTERLINEAR_PRESETS`, `settings.ts:195`:

| Preset | gloss | translit | lemma | strongs | parsing |
|---|---|---|---|---|---|
| minimal | ✓ | | | | |
| study | ✓ | | | ✓ | |
| scholar | ✓ | ✓ | ✓ | ✓ | ✓ |

`'custom'` is never stored by a preset button — `detectPreset()` (`InterlinearControls.svelte:60`) compares the current layer combination against all three presets after every manual toggle and falls through to `'custom'`.

### 4.3 Layer styling

Rendered as a vertical `inline-flex` stack per word. Colors: original `#f0f0f0`, gloss `#cfe3ff`, transliteration `#b0b0b0` italic, lemma `#e3cd96`, parsing `#9aa0a6`, Strong's `#93c69a`. `InterlinearControls.svelte:248-253`.

The preview block uses fixed `line-height: 1.15` and `font-size: 21px` with `em`-relative layer sizes, deliberately independent of `--base-font-size` / `--line-spacing` so it can't be distorted by the user's reading settings. `InterlinearControls.svelte:227-241`. Sample phrase is John 1:1a, `:23`.

## 5. Word Study

Files: `src/components/LexicalModal.svelte` (2,215 lines), `src/adapters/lexicon-lookup.ts` (1,192 lines), `src/lib/morphologyExpander.ts` (467 lines), `src/adapters/LexiconStore.ts`, `src/stores/lexicalModalStore.ts`.

### 5.1 Modal structure

State `activeTab: "definition" | "occurrences" | "related"`, `LexicalModal.svelte:152`. Two distinct tab strips are rendered depending on whether the subject is an English word or a Strong's entry:

- **English word** — Definition, Related (`:959`, `:966`). No Occurrences tab.
- **Strong's entry** — Definition, Occurrences, Related (`:1150`, `:1157`, `:1164`).

Guard at `:158`: `if (isEnglishWord && activeTab === "occurrences") activeTab = "definition"` — prevents a blank body when a leftover Occurrences tab carries into the English-word view. Tab resets to `"definition"` on open, `:249`.

Lazy loads: occurrences fetched only when the Occurrences tab is first opened (`:544`), inflection forms only when the Definition tab is opened (`:549`).

### 5.2 Strong's entry sections

`LexicalModal.svelte:1172-1290` — Entry Information, Short Definition, Full Definition, KJV Usage, Derivation, Inflection Forms, then the Occurrences and Related tabs.

Lookup functions in `src/adapters/lexicon-lookup.ts`:

| Function | Line | Purpose |
|---|---|---|
| `lookupStrongs(strongsId)` | 157 | Single Strong's entry |
| `lookupLemma(lemma)` | 240 | Entry by dictionary form |
| `getStrongsTransliterations(ids)` | 219 | Batch transliteration map |
| `lookupWord(word)` | 71 | All entries matching a surface word |
| `getMorphology(...)` | 1152 | Parsing data for a word occurrence |

### 5.3 English word lookup

`lookupEnglishWord(word)`, `lexicon-lookup.ts:320`. Returns `EnglishWordEntry` (`:25`) with definitions grouped by part of speech (`Definition`, `:9`).

`singularCandidates(word)`, `:297` — folds plurals to singular so "waters" resolves to "water". English definitions are keyed off `word_mapping` rather than raw surface text.

### 5.4 People

| Function | Line | Purpose |
|---|---|---|
| `lookupPerson(word, ref?)` | 662 | Person record, disambiguated by verse reference |
| `isPersonName(word, ref?)` | 762 | Cheap boolean test used to decide the click target |
| `getPersonVerses(personId)` | 802 | Every verse the person appears in |

Types: `PersonRecord` `:585`, `PersonLookupResult` `:607`, `VerseRef` `:615`.

### 5.5 Morphology expansion

`src/lib/morphologyExpander.ts` — three code systems, each with its own expander, all returning the raw code unchanged when unparseable:

| System | Function | Line | Example |
|---|---|---|---|
| Greek RMAC (Robinson's) | `expandRmacCode()` | 134 | `V-PAI-3S` → "Verb, Present, Active, Indicative, Third person, Singular" |
| Hebrew/Aramaic OSHB | `expandOshbCode()` | 326 | `HVqp3ms` → "Hebrew, Verb, Qal, perfect (qatal), third person, masculine, singular". Handles compound `prefix/main-word` codes split on `/`. |
| STEPBible part-of-speech | `expandStepBiblePOS()` | 464 | `G:N-F` → "Greek, Noun, Feminine"; `N:N-M-P` → "Proper name, Noun, Masculine, Person". Handles multiple values separated by ` / `. |

Morphology is displayed under a "Morphology" heading, `LexicalModal.svelte:853`. Reader-side morphology state and cache at `BibleReader.svelte:528-531`.

## 6. Bible Encyclopedia (ISBE)

Files: `src/components/IsbeModal.svelte` (814 lines), `src/stores/isbeModalStore.ts`, ISBE functions in `src/adapters/lexicon-lookup.ts:830-1152`. Ships as a standalone `isbe.sqlite` pack.

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

Types: `IsbeEntryRecord` `:830`, `IsbePlaceRecord` `:841`, `IsbeResolution` `:854`, `IsbeClickContext` `:864`.

Store API: `isbeModalStore.open(data)` and `openEntry(entryId, primaryName)`, `src/stores/isbeModalStore.ts:29-31`.

### 6.2 Tabs

`activeTab: Tab`, default `"overview"`, reset on open (`IsbeModal.svelte:25`, `:55`). Rendered at `:456-464`:

- **Overview** (always) — type, alternate names, summary. `:471`
- **Article** (when an entry exists) — `:488`
- **Verses** — grouped by book in canonical order, `:121`, rendered `:539`
- **Map** (when coordinates exist) — Leaflet pin bound to a popup with the title, `:183`, rendered `:558`

Title resolution: `place?.primaryName || entry?.primaryName || state.primaryName`, `:74`. Subtitle assembled from place type via `subtitle()` `:137` and `titleCaseType()` `:146`.

### 6.3 Article table of contents

`type Section = { title: string; html: string; children: Section[] }`, `:251`. Two-level tree.

- `headingOf(text)` `:271` classifies a heading as level 1 or 2 — level 2 when the heading number starts with a digit.
- Duplicate-heading suppression: `lastAt` map keyed by `normTitle()` records the last index each heading title appears at; only the final occurrence is treated as the real section, so a title repeated in running text doesn't pollute the contents list. `:319-328`
- Section chips are colored inline to match the way the Verses tab colors its chips. `:287`

The tab strip is `flex: none` — a tall tab (a 955-verse Verses list) otherwise crushed the strip to zero height under flexbox. Noted at `IsbeModal.svelte:655`.

### 6.4 Dictionary bridge

`checkDictionary(title)` runs whenever the modal is open, not loading, and has a title (`:103`), linking encyclopedia entries to matching dictionary entries.

### 6.5 Return-to-article

`src/stores/isbeReturnStore.ts`. Set when a verse is tapped inside the ISBE modal, consumed by the nav back arrow.

`IsbeReturn` carries three things: the `modal` payload to reopen (the same shape `isbeModalStore.open()` takes), `expandedBooks[]` so the Verses tab reopens with the same books expanded, and `at: {book, chapter, verse}` — the verse that was jumped to.

The back arrow only restores the modal if the reader is **still sitting at `at`**. If the user navigated on from there, the context is treated as stale and the modal is not reopened.

## 7. Commentaries

Files: `src/components/CommentaryReader.svelte` (608), `src/components/CommentaryNavigationBar.svelte` (799), `src/components/CommentaryModal.svelte` (456), `src/adapters/CommentaryStore.ts` (308), `src/lib/linkifyCommentaryRefs.ts` (238), `src/lib/annotationConfig.ts`.

### 7.1 Author registry

`COMMENTARY_AUTHORS`, `src/lib/annotationConfig.ts:12` — 14 authors, each with `color`, `initials`, `fullName`:

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

`IndexedDBCommentaryStore`, `src/adapters/CommentaryStore.ts:26`:

| Method | Line |
|---|---|
| `getCommentary(reference, author?)` | 33 |
| `getChapterCommentary(book, chapter, author?)` | 97 |
| `getAuthors()` | 144 |
| `getCoverageStats()` | 178 |
| `getAllChapterContent(book, chapter, author?)` | 229 |
| `getAvailableBooks()` | 279 |

Entries typed `CommentaryEntry`, `:8`. The reader caches all entries for the current chapter and re-filters when the selected author set changes rather than re-querying — `BibleReader.svelte:462-465`.

### 7.3 Author filter

State `selectedCommentaryAuthors: string[]` on `NavigationState`, persisted. Setter `navigationStore.setSelectedCommentaryAuthors()`, `src/stores/navigationStore.ts:107` — note it also sets `showCommentaries` to `selectedCommentaryAuthors.length > 0`, so clearing the filter hides the layer. Toolbar button `NavigationBar.svelte:848`.

### 7.4 Reference linkification

`linkifyCommentaryRefs(html, contextBook, contextChapter, author?)`, `src/lib/linkifyCommentaryRefs.ts:218`.

- Only text nodes are processed; HTML tags are left completely intact (`:5`).
- Matches are wrapped in `<span class="commentary-ref">` with the raw text as both display and `data-ref` (`:89`).
- A second wrapper (`:99`) handles continuation segments where the displayed token differs from the resolved reference — e.g. displayed "110:4" or "14" carrying an absolute `data-ref` of "Psalms 110:4".
- Theme color applied via a `--ref-color` CSS custom property (`:91`).
- `author` is accepted so author-specific formatting quirks can be handled.

### 7.5 Anchor sync and checkpoints

State `commentaryAnchored` on `NavigationState`, persisted; setter `navigationStore.setCommentaryAnchored()` `:151`. Toolbar control `NavigationBar.svelte:874`.

Logic in `BibleReader.svelte:875-905`:

- **Drift detection** — `commCheckpointDrifted` is true when the anchor is on *and* any open commentary window's `contentState.book`/`.chapter` differs from the nav store's. While drifted, anchor highlights are cleared rather than chased, so the app stops fighting the user.
- **Re-sync** — an edge-triggered block watches `prevCommDrifted && !commCheckpointDrifted`; when drift clears, `lastAnchorVerse` is pushed to every commentary window's `highlightedVerse` so each scrolls to the current Bible verse once its entries have loaded.
- **Checkpoints** — `commCheckpoints` is the de-duplicated union of `contentState.checkpoints` across all open commentary windows. Rendered as amber highlights in the Bible text via `applyAnchorHighlights()` / `clearAnchorHighlights()`, re-evaluated whenever anchor state, drift, or the checkpoint set changes.

## 8. Cross-References

Files: `src/adapters/TskReferenceStore.ts`, `src/adapters/CrossReferenceStore.ts`, `src/lib/parseRefString.ts`, `src/components/AnnotationPanel.svelte`.

| Item | Detail |
|---|---|
| Store | `IndexedDBTskReferenceStore`, `TskReferenceStore.ts:33`. Methods: `getVerseReferences(book, chapter, verse)` `:37`, `getChapterReferences(book, chapter)` → `Map<verseNumber, TskEntry[]>` `:69`, `isInstalled()` `:104`. Entry type `TskEntry` `:20`. |
| Marker color | `TSK_COLOR = '#D97706'` (gold) — one shared constant for all TSK diamonds, `src/lib/annotationConfig.ts:29`. |
| Toggle | Toolbar button, `NavigationBar.svelte:824`, tooltip "Show TSK cross-reference markers on verse keywords". Backed by `showReferences` on `NavigationState` (`navigationStore.setShowReferences()` `:93`), persisted. |
| Reference resolution | `parseRefString()` — see [2.2](#22-moving-between-passages) for the formats handled. |
| Display | `AnnotationPanel.svelte` (789 lines), `references` tab. |

## 9. Search

Files: `src/lib/services/searchService.ts` (579), `src/components/PowerSearchModal.svelte` (1,370), `src/components/UnifiedSearch.svelte`, `src/components/panes/SearchPane.svelte`, `src/components/SearchResultsTree.svelte`, `src/lib/searchTree.ts`, `src/adapters/SearchIndex.ts`, `src/stores/searchStore.ts`, `src/components/HelpModal.svelte`.

### 9.1 Unified search service

`UnifiedSearchService`, `searchService.ts:97` — singleton, exported as `searchService` `:579`.

Eight categories (`SearchCategoryKey`, `:7`): `bible`, `strongs`, `notes`, `journal`, `saved`, `characters`, `encyclopedia`, `commentaries`. Result types (`SearchResult`, `:17`) mirror these one-to-one.

`SearchCategory` `:28` carries `alwaysShow` (render the group even at zero results — used by Saved Verses until that ships) and `truncated` (the count shown is what's displayed, not what exists).

**Caps** (`:49-51`) — deliberately per-category so one huge category can't bury the others:

| Constant | Value |
|---|---|
| `CATEGORY_LIMIT` | 200 |
| `COMMENTARY_SCAN_LIMIT` | 400 |
| `STRONGS_VERSE_LIMIT` | 500 |

`SearchOptions` `:39` — `limit` (`-1` loads everything) and `deep`. Commentary search cursors ~89k rows, so it runs only on an explicit Enter/Search press, never on type-ahead.

**Strong's fast path** — `STRONGS_QUERY = /^([GgHh])\s*0*(\d{1,4})$/` `:54` detects a Strong's number typed straight into the box. Because the morphology pack is inconsistent about zero-padding (Greek rows store `G976`, Hebrew rows store `H0121`), `strongsVariants()` `:64` tries both the bare and 4-padded spellings. This mirrors the same fallback in `adapters/lexicon-lookup.ts`.

**Helpers** — `stripHtml()` `:69`, `snippet(text, term, maxLength = 160)` `:80` which windows around the first match so long entries stay scannable.

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

Toolbar entry point `NavigationBar.svelte:982`, tooltip "Advanced search — regex, proximity, biblical filters".

### 9.3 In-app help

`src/components/HelpModal.svelte` — `helpContent` record at `:5`, each key giving `{title, description, examples[]}`. Topics: Match Type, Must Contain / Must NOT Contain, Proximity Search, Include Plurals, Case-Insensitive Search, Pattern Complexity. This modal is power-search-specific, not a general app help system.

## 10. Highlights & Notes

Files: `src/components/HighlightModal.svelte` (494), `src/lib/highlightRenderer.ts` (374), `src/components/AnnotationPanel.svelte` (789), `src/components/NotePopup.svelte` (431), `src/components/SavedVersesPanel.svelte` (354), `src/components/SelectionToast.svelte`, `src/adapters/UserDataStore.ts` (390).

### 10.1 Palette and styles

`PALETTE`, `HighlightModal.svelte:24` — 7 colors: Yellow `#ffff32`, Green `#3aff32`, Orange `#ff9c32`, Red `#ff3232`, Pink `#ff48ec`, Purple `#ba32ff`, Blue `#3273ff`. Default is `PALETTE[0]` with `type: 'background'` (`:46`).

Three highlight types: `background` (marker), `text-color`, `underline`.

`UNDERLINE_STYLES`, `:34` — `solid`, `dashed`, `wavy`, `boxed`. Boxed renders as `outline: 2px solid` with `outline-offset: 1px` rather than a text-decoration (`:206`).

### 10.2 Rendering

`src/lib/highlightRenderer.ts`:

- **Background** — an SVG data URI applied as `background-image` on the inline `.verse-text` span. The SVG uses a **seeded** wavy filled path so the same verse always gets the same organic shape, and `box-decoration-break: clone` gives each wrapped line its own swatch. ViewBox `0 0 100 10`, rendered via `background-size: 100% 100%`. `:7-10`, `:44-46`
- **Text color** — a CSS custom property on the verse-text span.
- **Underline** — CSS `text-decoration`.

API: `applyHighlightToElement()` `:96` (safe to call repeatedly — removes any previous overlay first), `applyWordHighlightToSpan()` `:139`.

`HighlightStyle` is designed to accept a future `animatedEffect` field; `applyHighlightToElement` would handle it as an additional branch without breaking callers (`:14`).

### 10.3 Persistence

`IndexedDBUserDataStore`, `src/adapters/UserDataStore.ts:25`. Verse highlights and word highlights are separate record types, so a word can be highlighted inside an already-highlighted verse.

| Group | Methods |
|---|---|
| Notes | `getNotes(reference?)` `:28`, `saveNote()` `:73`, `updateNote(id, text)` `:98`, `deleteNote(id)` `:133` |
| Verse highlights | `getHighlights(reference?)` `:139`, `getChapterHighlights(book, chapter)` `:169`, `saveHighlight()` `:196`, `deleteHighlight(id)` `:218` |
| Word highlights | `getWordHighlights(reference?, translation?)` `:224`, `getChapterWordHighlights()` `:259`, `getBookWordHighlights(book)` `:287`, `saveWordHighlight()` `:315`, `deleteWordHighlight(id)` `:333` |
| Bookmarks | `getBookmarks()` `:339`, `saveBookmark()` `:364`, `deleteBookmark(id)` `:387` |

Note that word highlights are translation-scoped (`getWordHighlights` takes a `translation`) while verse highlights are not.

### 10.4 Annotation panel

`AnnotationPanel.svelte`. Props: `open`, `book`, `chapter`, `verse`, `tskEntries`, `commentaryEntries`, `initialTab` (`"references" | "commentary"`), `targetAuthor`. Two tabs at `:259`. Keeps its own navigation stack (`:47`, `:151`, `:175`) so drilling into an entry and backing out restores the previous tab.

Reopen-after-back-navigation is coordinated through `src/stores/annotationReturnStore.ts`, consumed at `BibleReader.svelte:373-406`.

### 10.5 Selection toast

`src/components/SelectionToast.svelte`. Dispatches an `action` event with the selected text. Seven actions (`:44-70`): `dissect`, `search`, `map`, `highlight`, `save`, `notes`, `repeats`. The `map` button is conditional — rendered only when the selection resolves to a place (`:53`).

## 11. Repeated Words

Files: `src/stores/repeatsStore.ts`, `src/lib/repeatColors.ts`, `src/lib/repeatRenderer.ts`, `src/lib/repeatCounts.ts`, `src/stores/repeatCountsStore.ts`, `src/stores/repeatBulkStore.ts`.

### 11.1 Palette and cap

`REPEAT_COLORS`, `src/lib/repeatColors.ts:29` — exactly 7 entries, and `MAX_REPEAT_GROUPS = REPEAT_COLORS.length` `:39` makes the palette length itself the hard cap on simultaneous groups.

| Index | Name | Pill | Pill text | In-text bg | In-text border |
|---|---|---|---|---|---|
| 0 | Amber | `#b8860b` | `#fff8e1` | `rgba(255,193,7,0.30)` | `rgba(255,193,7,0.55)` |
| 1 | Sky | `#2f6f8f` | `#e3f4fb` | `rgba(56,178,232,0.28)` | `rgba(56,178,232,0.55)` |
| 2 | Mint | `#2f7d56` | `#e3f7ec` | `rgba(52,199,124,0.28)` | `rgba(52,199,124,0.55)` |
| 3 | Rose | `#a64263` | `#fbe6ee` | `rgba(244,114,160,0.28)` | `rgba(244,114,160,0.55)` |
| 4 | Violet | `#6c4aa6` | `#efe8fb` | `rgba(167,130,240,0.28)` | `rgba(167,130,240,0.55)` |
| 5 | Coral | `#b35a3a` | `#fceae3` | `rgba(255,138,101,0.28)` | `rgba(255,138,101,0.55)` |
| 6 | Teal | `#2f7d78` | `#e2f6f4` | `rgba(45,212,191,0.28)` | `rgba(45,212,191,0.55)` |

Both the navbar pills and the in-text spans reference colors by index, so a group looks identical in both places. `repeatHlClass(colorIndex)` `:42` returns `repeat-hl-{i}`.

The palette is deliberately softer and more translucent than the saved-highlight `PALETTE`, so repeats read as a scratch layer rather than a commitment (`repeatColors.ts:4-7`).

### 11.2 Store

`repeatsStore`, `src/stores/repeatsStore.ts:128`. Persisted to `localStorage`, modeled on `navigationStore`, so tracking survives navigation and restarts.

`RepeatGroup` `:13` = `{ word (normalized key), label (original casing, shown on the pill), colorIndex }`.

- `normalizeRepeatWord()` `:25` — lowercase, punctuation stripped; mirrors the in-text match logic.
- `nextFreeColorIndex()` `:63` — smallest unused index in `[0, MAX)`, so removing a group frees its color for reuse.
- `add()` `:78` — no-op if already present or at capacity; returns the new group or `null`.
- `toggle()` `:94` — used by the selection toast's Repeats action.
- Load path truncates to `MAX_REPEAT_GROUPS` (`:46`) and validates `label` is a string (`:43`), so a corrupted localStorage payload can't break startup.

### 11.3 Rendering

`src/lib/repeatRenderer.ts`. Wraps matches in `<span class="repeat-hl repeat-hl-{colorIndex}">`.

Ordering contract (`:9-11`): repeats are applied **after** saved highlights and cleared **before** saved highlights are re-applied, so the two layers can never corrupt each other. Place markers are then applied last — see [1.2](#12-what-appears-in-the-text).

API: `clearRepeatsInSection()` `:20`, `applyRepeatsToSection()` `:34` (idempotent — clears first), `findRepeatOccurrences()` `:91`, `applyRepeatsToAllSections()` `:108`.

`findRepeatOccurrences` returns char offsets within the `.verse-text` `textContent`, compatible with `injectWordSpan` / `UserWordHighlight`. Each occurrence spans the whole whitespace-delimited token.

### 11.4 Counts

`countWordsInBook()`, `src/lib/repeatCounts.ts:64` → `Map<word, count>`. Counts against whitespace tokens of the **rendered** verse text using the same normalization as the highlights, so footnote markers and stored-text artifacts aren't counted. Cached per `translation:book`. Surfaced through `src/stores/repeatCountsStore.ts`.

### 11.5 Highlight All

`src/stores/repeatBulkStore.ts` carries a pending bulk request from a repeat pill into `HighlightModal` in bulk mode — `BibleReader.svelte:519`. A related flag at `:521` handles opening the normal Highlight modal on a word that is also an active repeat.

## 12. Journal

Files: `src/components/JournalWriter.svelte` (251), `src/components/JournalCalendar.svelte` (396), `src/components/JournalNavigationBar.svelte`, `src/lib/components/LexicalEditor.svelte` (459), `src/adapters/JournalStore.ts` (215), `src/adapters/SyncedJournalStore.ts` (229).

| Item | Detail |
|---|---|
| Store | `IndexedDBJournalStore`, `JournalStore.ts:5`. Methods: `getEntries(startDate?, endDate?)` `:8`, `getEntryByDate(date)` `:58`, `saveEntry()` `:96`, `updateEntry(id, {title?, text?, textLinkified?})` `:123`, `deleteEntry(id)` `:169`, `getDateRange()` → `{oldest, newest}` `:173`. |
| Entry shape | Keyed by date string. Stores both `text` and `textLinkified` — the raw body and the version with Bible references already wrapped as links, so linkification is done once on save rather than on every render. |
| Editor | `src/lib/components/LexicalEditor.svelte` — rich text. |
| Calendar | `JournalCalendar.svelte`; also `src/components/CalendarView.svelte` (349). |
| Keyboard shortcut | **J** opens today's entry in a right-edge window at 50% width. Suppressed while typing in an `input`, `textarea`, or `contenteditable`, and ignored with Ctrl/Meta/Alt held. `src/App.svelte:111-128` |
| Date handling | Uses `localDateStr()` from `src/stores/clockStore.ts`, which respects the `timezone` setting rather than the raw browser timezone. |
| Search | Journal is one of the eight unified-search categories; `searchService` reads it via `IndexedDBJournalStore` directly. |
| Sync | `SyncedJournalStore.ts` — see [20. Account & Sync](#20-account--sync). |

## 13. Reading Plans & Progress

Files: `src/components/ReadingPlanModal.svelte` (3,144 — second-largest component), `src/stores/ReadingProgressStore.ts` (564), `src/stores/PlanMetadataStore.ts`, `src/adapters/ReadingHistoryStore.ts` (444), `src/adapters/SyncedReadingAdapter.ts` (447), `src/stores/readingPlanModalStore.ts`, `src/stores/readingProgressVersionStore.ts`, `src/components/CalendarView.svelte`.

### 13.1 Preset plans

`ReadingPlanModal.svelte:1353-1363`:

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

Custom ordering options: `'canonical' | 'chronological' | 'shuffled'`, `:49`.

Two plan types are stored: `planType: 'standard'` (`:580`) and `planType: 'harmony'` (`:651`). Harmony plans track *passages* rather than chapters. Display-name resolution at `:864-865`.

### 13.2 Storage and migration

- Current key: `projectbible_active_reading_plans` (`STORAGE_ACTIVE_PLANS`, `:39`) — multi-plan array.
- Legacy single-plan key is migrated on load and then removed (`:180-191`).
- Signed-out users fall back to `sessionStorage`; signed-in users use `localStorage` (`:163`).
- Plan IDs are `plan_<epoch-ms>`, used as the canonical creation time (`:412`).
- Phase-3 migration at `:230` moves abandoned history items (`completedAt === null`) back into `activePlans`.
- `activePlanViewTab` defaults to `'all'` with 2+ plans, otherwise the selected plan (`:200`).

### 13.3 Progress store

`ReadingProgressStore`, `src/stores/ReadingProgressStore.ts:190`, exported as `readingProgressStore` `:551`.

Types: `ChapterActionType = "checked" | "unchecked"` `:3`, `HarmonyPassageProgress` `:9`, `HarmonySectionProgress` `:20`, `ChapterAction` `:28`, `ChapterProgress` `:33`, `CatchUpAdjustment` `:39`, `ReadingProgressEntry` `:44`.

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

Also `getLatestChapterState()` `:553`.

**Sync hook** — `ProgressSyncHook` `:64`, registered via `registerProgressSyncHook()` `:66` by `SyncedReadingAdapter`. Fired after every *local* mutation. Deliberately **not** fired by `upsertEntries()`, which is the remote-apply path, so pulled data is never echoed straight back to the server (`:59-63`).

**Merge semantics** — designed for multi-device convergence without a server-side resolver:

- `chaptersRead` union-merge (`:92-94`): all unique chapter actions from both sides are preserved, deduplicated by `(timestamp, type)`, sorted chronologically.
- `harmonySections` union-merge (`:123-124`): a passage marked complete on *either* device stays complete.

### 13.4 Plan metadata

`PlanMetadataStore`, `src/stores/PlanMetadataStore.ts:17`, exported `:103`. `PlanStatus = "active" | "completed" | "archived"` `:3`; `PlanMetadata` `:5`.

### 13.5 Reading history

`IndexedDBReadingHistoryStore`, `src/adapters/ReadingHistoryStore.ts:14`:

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

`getTodaysReading()` tries today first, then the next upcoming day (`ReadingPlanModal.svelte:871-874`).

### 13.6 Catch-up

Two strategies, `ReadingPlanModal.svelte:1791-1792`: `spread` (Even spread) and `dedicated` (Dedicated catch-up days). Persisted as `CatchUpAdjustment` via `setCatchUpAdjustment()`.

### 13.7 Sync behavior in the modal

- Re-reads `localStorage` on every open, then kicks off a background sync throttled to once per 30 s (`:124-137`). Local progress is loaded first so the UI is never blank while the sync runs.
- Pull happens before re-pushing local plans — the pull refreshes which plans exist (`:137`).
- Reloads progress whenever a Realtime event or pull writes (`:144`).
- Note `:450`: Svelte doesn't track `dayProgressMap` through `getDayProgress()` calls, so it is reassigned explicitly.
- Two-step delete and inline rename state at `:78`.

## 14. Maps & Places

Files: `src/components/MapPane.svelte` (833), `src/components/panes/MapPane.svelte`, `src/adapters/MapStore.ts`, `src/adapters/PlaceStore.ts` (234). Uses Leaflet.

### 14.1 Map store

`IndexedDBMapStore`, `MapStore.ts:4`:

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

`IndexedDBPlaceStore`, `PlaceStore.ts:9`:

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

The ISBE modal's Map tab renders a Leaflet pin bound to a popup with the entry title (`IsbeModal.svelte:183`), shown only when coordinates exist. See [6.2](#62-tabs).

## 15. Art

Files: `src/components/ArtPane.svelte` (283), `src/adapters/ArtStore.ts`.

`IndexedDBArtStore`, `ArtStore.ts:17`:

| Method | Line |
|---|---|
| `getScene(id)` | 19 |
| `getScenesForVerse(reference)` | 30 |
| `getScenesForChapter(book, chapter)` | 47 |
| `getAllScenes()` | 64 |
| `searchScenes(query)` | 86 |
| `getImageUrl(id)` | 120 |

`ArtPane` props: `sceneId`, `book`, `chapter`, `verse` — all optional, so it can open on a specific painting or browse. Falls back to a "Biblical Art" browse view (`:129`) when no scene is selected.

In-text icons: setting `showArt`, default `true`. The reader keeps a scene map keyed `"book:chapter:verse"` for the currently rendered chapters and rebuilds it as chapters come and go (`BibleReader.svelte:311-318`). `openArtWindow` docks to whichever edge fits the current orientation (`:338`).

## 16. Read Aloud (TTS)

Fully on-device. Files: `src/lib/tts/piperEngine.ts` (276), `src/lib/tts/ttsWorker.ts`, `src/lib/tts/voices.ts`, `src/lib/tts/vendor/piper-phonemize.js` (2,878, vendored), `src/adapters/tts.ts` (287), `src/lib/ttsGlow.ts` (294), `src/components/TtsPlayer.svelte` (430).

### 16.1 Engine

`piperEngine.ts` — Piper ONNX voice via onnxruntime-web WASM plus the espeak-ng phonemizer WASM. Adapted from `@diffusionstudio/vits-web` 1.0.3 (MIT) with three deliberate changes (`:5-11`):

1. Runtime WASM assets load from same-origin `/tts/` instead of CDNs, so the feature keeps working offline (the service worker caches `/tts/`).
2. The ONNX session and voice config are cached between calls. The original recreated them per synthesis — far too slow for per-verse use.
3. Synthesis throws `VOICE_NOT_INSTALLED` rather than silently downloading ~60 MB, so the UI owns when the download happens.

Voice files live in OPFS under `/piper/` (same layout as vits-web). **Runs inside `ttsWorker.ts` — must not be imported from the main thread** (`:14`).

Engine API: `downloadVoice()` `:100`, `installVoiceData()` `:118` (raw `.onnx` + `.json` bytes transferred across the worker boundary with no copy — used for user-cloned voices), `removeVoice()` `:134`.

### 16.2 Voice catalog

`TTS_VOICES`, `src/lib/tts/voices.ts:25`:

| id | Label | Quality | Approx size |
|---|---|---|---|
| `en_US-lessac-medium` | Standard (US English) | `standard` | 64 MB |
| `en_US-lessac-low` | Compact (US English) | `compact` | 30 MB |

Remote source base: `https://huggingface.co/rhasspy/piper-voices/resolve/main` (`:43`). `resolveVoiceSource()` `:48` returns `null` for voices that can only arrive via local file install. `voiceModelName()` `:61`, `voiceConfigName()` `:64`. `TtsVoiceInfo.custom` flags user-added voices.

### 16.3 Adapter

`src/adapters/tts.ts`. `DEFAULT_TTS_VOICE = 'en_US-lessac-medium'` `:22`.

| Function | Line |
|---|---|
| `getCustomVoices()` | 31 |
| `registerCustomVoice(info)` | 46 |
| `getAllVoices()` | 57 |
| `getVoiceInfo(id)` | 61 |
| `voiceIsDownloadable(info)` | 66 |
| `voiceIdFromFilename(filename)` | 71 |
| `isTtsSupported()` | 92 |
| `storedVoices()` | 155 |
| `isVoiceInstalled(voiceId)` | 159 |
| `downloadVoice(...)` | 163 |
| `removeVoice(voiceId)` | 172 |
| `installVoiceFromFiles(...)` | 181 |
| `synthesizeSpeech(text, voiceId)` | 200 |
| `getSharedTtsAudio()` | 213 |
| `unlockTtsAudio()` | 226 |

`unlockTtsAudio()` must be called from inside a user tap, before any async work — it plays a tiny silent clip to satisfy mobile autoplay policy (`:222-226`).

Custom voices are catalogued in `localStorage` on the main thread; the worker receives an explicit `source` for them, while built-ins fall back to the static catalog so internal callers work source-free (`piperEngine.ts:88-90`).

### 16.4 Settings

`TtsSettings`, `src/adapters/settings.ts:29`. Resolved by `getTtsSettings()` `:231`, written by `updateTtsSettings()` `:243`.

| Key | Default | Meaning |
|---|---|---|
| `voiceId` | `'en_US-lessac-medium'` | Installed Piper voice id |
| `rate` | `1.0` | Playback speed, range 0.8–1.5 |
| `readHeadings` | `false` | Speak section headings before their verse |
| `highlightVerse` | `true` | Tint the verse being read |
| `glowFollow` | `false` | Soft glow drifting along the words |

`highlightVerse` and `glowFollow` are independent — either, both, or neither (`settings.ts:33`).

### 16.5 Player controls

`TtsPlayer.svelte`, props `translation`, `book`, `chapter`. Controls: play/pause (`:281`), jump to a verse (`:292`), stop (`:300`), continuous play toggle (`:305`), cancel during preparation (`:269`), dismiss (`:274`), spinner while preparing (`:276`).

Speech text comes from `extractSpeechText()`, `src/lib/verseRendering.ts:318` — footnotes and cross-references are dropped entirely rather than read aloud, using the same `findNoteEnd()` boundary logic as the HTML renderer so the two can't disagree.

### 16.6 Drifting glow

`src/lib/ttsGlow.ts`. Two design decisions worth preserving:

- **Why soft and wide** (`:5-10`) — the standard Piper export returns finished audio and keeps its internal per-word durations to itself, so pacing is an estimate. A crisp highlight on the wrong word looks broken; a blurred cloud several words wide is almost always covering the right word somewhere in its span, and reads as atmosphere rather than error.
- **Why it's anchored to `.text-container`, not the verse** (`:12-18`) — in paragraph layout a verse is an inline element flowing through the paragraph, and for an inline box spanning several lines the browser's reference for placing an absolutely positioned child is not the box that measuring returns. Anchoring to the verse put the glow in the wrong place and made it drift as text rewrapped. `.text-container` is a block that scrolls with the content and is already the anchor the text-selection drag handles use.

Reader-side wiring at `BibleReader.svelte:566`, with a ticket guard at `:596` because an `await` follows and a newer call can overtake an older one.

## 17. Audio

Pre-recorded chapter audio, distinct from [16. Read Aloud](#16-read-aloud). Files: `src/components/AudioPlayer.svelte` (261), `src/adapters/audio.ts` (379), `src/stores/audioStore.ts`.

`AudioPlayer` props: `book`, `chapter`. Controls: play/pause (`:137`), seek slider (`:153`), stop (`:156`), continuous-play toggle (`:161`), dismiss (`:130`), loading spinner (`:132`).

`continuousPlay` is a shared store used by both the audio player and the TTS player, so auto-advance behaves the same either way.

## 18. Panes & Windows

Two independent docking systems.

### 18.1 Windows

`src/lib/stores/windowStore.ts`, `src/components/Window.svelte` (299), `src/components/WindowContainer.svelte` (254), `src/components/WindowContentSelector.svelte` (196), `src/components/Pane.svelte` (238).

- `WindowContentType` `:3` — `'selector' | 'bible' | 'map' | 'notes' | 'wordstudy' | 'commentaries' | 'journal' | 'art'`
- `WindowEdge` `:4` — `'top' | 'left' | 'right' | 'bottom'`
- `MAX_WINDOWS = 6` `:30`; `createWindow()` returns `null` at capacity (`:59-62`)
- `setWindowContent(id, contentType, contentState?)` `:119` — each window carries its own `contentState`, so a second Bible window can sit on a different chapter from the main reader
- `getWindowsByEdge(edge)` `:176`

Layout: `App.svelte:188-204` sums the sizes of the windows on each edge and insets the main content with `left`/`right`/`top`/`bottom` percentages, transitioned over 0.3 s.

### 18.2 Edge gestures

`src/components/EdgeGestureDetector.svelte` (497).

| Constant | Value | Purpose |
|---|---|---|
| `EDGE_ZONE_WIDTH` | 40 px | Width of the grab zone along each edge |
| `OPEN_THRESHOLD` | 0.05 | 5% of screen width/height before a window opens |
| `BOTTOM_DEAD_HALF` | 20 px | Half of a 40 px centre dead zone on the bottom edge, left free for the Android home gesture (`:98`) |

Two-stage commit (`:76`, `:177-192`): touching an edge sets a **pending** edge; the drag only commits once movement direction matches that edge's axis. This is what stops accidental opens.

Touch and mouse paths are separate, with a `usingTouch` flag so mouse events are ignored during touch (`:22`). Any touch starting in the bottom zone locks reader scroll (`:30`). `atLimit` (6 windows) switches the bumper's visual class (`:32`).

### 18.3 Panes

`src/stores/paneStore.ts`. A simpler, app-level docking system.

- `PaneType` `:3` — `'settings' | 'map' | 'packs' | 'search' | 'notes' | 'commentaries'`
- Positions: `'left' | 'right' | 'bottom'`
- `openPane(type, position)` `:21` — reopens an existing pane of that type rather than duplicating it
- Sizing: left/right panes are 75% wide on a phone (`innerWidth <= 480`) and 40% otherwise; bottom panes are 50% tall (`:33-36`)
- `zIndex` is assigned as `max(existing) + 1`
- `closePane(id)` sets `isOpen: false` rather than removing the record
- `pendingCloseEdge` is consumed by `EdgeGestureDetector` for close animations

Pane components: `src/components/panes/SettingsPane.svelte` (860), `PacksPane.svelte` (1,238), `SearchPane.svelte`, `MapPane.svelte`; container `src/components/PaneContainer.svelte`.

### 18.4 Orientation

Setting `allowRotation`, default `false` (portrait-locked). `applyOrientationLock()`, `src/App.svelte:24` — tries `'portrait-primary'` then falls back to `'portrait'`; failures are swallowed since desktop and tablet browsers often don't support the API.

Re-applied on visibility resume to handle tablet app-switching (`:52`) and whenever settings are saved (`:95`). Deliberately **not** re-applied on orientation change itself — doing so fought the OS on tablet and confused mobile (`:49`).

`handleOrientationChange()` `:42` fades `.app-root` to opacity 0 over 0.25 s and back after 350 ms, so a rotation reads as a transition rather than a snap.

## 19. Content Packs

Files: `src/components/panes/PacksPane.svelte` (1,238), `src/adapters/PackManager.ts`, `src/adapters/pack-import.ts` (2,116), `src/lib/pack-init.ts` (497), `src/lib/pack-triggers.ts`, `src/lib/progressive-init.ts`, `src/lib/bootstrap-loader.ts`, `src/components/ProgressModal.svelte`, `src/adapters/db-manager.ts` (339).

### 19.1 Pack manager

`IndexedDBPackManager`, `src/adapters/PackManager.ts:4`: `listInstalled()` `:5`, `install(source: string | File)` `:38`, `remove(packId)` `:47`, `isInstalled(packId)` `:97`.

`install()` accepts either a URL string or a `File`, which is what makes both Quick Install and Advanced Install one code path.

### 19.2 First-run initialization

`src/lib/pack-init.ts`. Bundled packs are extracted to IndexedDB on first run; afterwards packs load from IndexedDB.

`isInitialized()` `:262`, `initializePolishedApp()` `:273`, `getBundledPacks()` `:486`, `resetInitialization()` `:493` (development only). Internal helpers for opening (`:424`), reading (`:444`), and writing (`:458`) the pack IndexedDB. Type `BundledPack` `:8`.

### 19.3 Demand loading

`src/lib/pack-triggers.ts` — loads packs when a user action needs them, without blocking the UI.

- Stores: `currentDownload` (`DownloadProgress | null`) `:14`, `showProgressModal` `:15`. Both consumed by `ProgressModal` in `App.svelte:238`.
- `triggerPackLoad(...)` `:24`, `preloadPacks(packIds)` `:99`, `isPackLoaded(packId)` `:115`, `getLoadedPacks()` `:122`, `clearLoadedPacksCache()` `:129`.

### 19.4 Packs pane sections

`PacksPane.svelte`: Database Statistics `:558`, Installed Packs `:577`, Quick Install `:630`, Voices (Read Aloud) `:665`, Advanced Install `:730`, About Packs `:784`.

Entry point from Settings: "Manage Packs" button, `SettingsPane.svelte:419`.

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

`SupabaseAuthService`, `src/services/SupabaseAuthService.ts:4`, exported as `supabaseAuthService` `:66`:

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

`SyncTable`, `src/lib/sync/types.ts:14` — seven tables: `user_notes`, `user_highlights`, `user_word_highlights`, `user_bookmarks`, `journal_entries`, `reading_plans`, `reading_progress`.

`SyncOperationType` `:5` — `'INSERT' | 'UPDATE' | 'DELETE'`. `SyncStatus` `:23` — `'idle' | 'syncing' | 'error' | 'offline'`. `SyncState` `:25` carries `status`, `pendingCount`, `lastSyncedAt`, `error`, `isOnline`.

### 20.3 Orchestrator

`SyncService`, `src/lib/sync/SyncService.ts`, exported `:335`. Responsibilities (`:4-8`): connect/disconnect Realtime on auth changes, process the queue when online, pull initial data on sign-in, expose sync state to the UI.

`init()` `:63`, `forceSync(throttleMs = 0)` `:109`, `onSignIn(userId)` `:189`, `onSignOut()` `:246`, `handleOnline` `:269`, `pullRemoteData()` `:287`, `pullTable(...)` `:302`.

`forceSync` is called on tab visibility change, throttled to once per 30 s and guarded by a mutex so it can never pile up or leave the status stuck on "Syncing…" — `App.svelte:77-84`.

### 20.4 Offline queue

`SyncQueueService`, `src/lib/sync/SyncQueueService.ts`, exported as `syncQueue` `:381`. Writes queue to IndexedDB and drain when online.

Drain behavior (`:5-7`): oldest-first, coalescing every queued op for the same row into one equivalent upload, with exponential backoff on failure — 5 s doubling per attempt, capped at 15 minutes.

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

`RealtimeService`, `src/lib/sync/RealtimeService.ts`, exported `:183`. Subscribes to Postgres changes on all user-data tables and notifies registered handlers. `connect(userId)` `:39`, `disconnect()` `:80`, `ensureConnected()` `:100`, `reconnect()` `:118`.

Pull handlers are registered by side-effecting imports in `App.svelte:16-17`: `./adapters/SyncedReadingAdapter` (reading plan/progress) and `./adapters/SyncedHighlightAdapter` (verse/word highlights).

### 20.6 Conflict resolution

`src/lib/sync/conflictResolver.ts` — last-write-wins on `updated_at`. `shouldApplyRemoteChange()` `:10` returns true only when remote is newer than local; `nowISO()` `:36`.

Reading progress is the deliberate exception: it **union-merges** rather than last-write-wins, so concurrent ticks on two devices both survive. See [13.3](#133-progress-store).

`src/lib/sync/reconcileDeletes.ts` handles the case that last-write-wins can't — distinguishing "deleted remotely" from "not yet uploaded".

### 20.7 Settings sync

`src/lib/sync/settingsSync.ts`.

`SYNCED_KEYS` `:28` — the subset that travels across devices:

`theme`, `timezone`, `dailyDriverEnglishOT`, `dailyDriverEnglishNT`, `dailyDriverHebrewOT`, `dailyDriverHebrewNT`, `dailyDriverGreekOT`, `dailyDriverGreekNT`, `interlinear`, `showRedLetter`, `showSectionHeadings`, `showArt`, `themedTitles`

Everything else stays per-device by design (`:4-8`) — font size, line spacing, verse layout, word wrap, rotation, update checks. A phone and a desktop rarely want the same font size.

- **Push** — debounced `PUSH_DEBOUNCE_MS = 2_000` after any settings write, registered as the settings change hook (`registerSettingsChangeHook()`, `src/adapters/settings.ts:109`); flushed when the tab hides. `scheduleSettingsPush()` `:53`.
- **Pull** — on sign-in and `forceSync`, applied only when the server row is newer than `projectbible_settings_synced_at` (`LAST_SYNCED_KEY` `:40`). Never a blind overwrite, so a fresh install can't clobber the account's settings with an empty blob (`:11-14`).
- `pickSynced()` `:43` omits `undefined` keys rather than writing nulls.

### 20.8 Synced store wrappers

`src/adapters/SyncedUserDataStore.ts` (426), `SyncedJournalStore.ts` (229), `SyncedReadingAdapter.ts` (447), `SyncedHighlightAdapter.ts`. Each wraps the plain IndexedDB store and enqueues a sync operation after local writes.

### 20.9 Profile modal

`ProfileModal.svelte`. Header greets by name when set (`:433`). Four tabs (`:466-469`): Reading Plan, Saved Verses/Notes, Journal, Settings. Auth views: Log in `:476`, Create Account `:483`, Reset Password `:491`. Today's reading with tappable chapter links `:509-512`. Inline settings: Theme `:545`, Default OT Translation `:554`, Default NT Translation `:563`.

## 21. App Settings & Appearance

Files: `src/components/panes/SettingsPane.svelte` (860), `src/adapters/settings.ts`, `src/App.svelte`, `src/stores/clockStore.ts`, `src/lib/dailyGreeting.ts`, `src/components/DailyGreetingModal.svelte` (284), `src/components/UpdateNotice.svelte`.

### 21.1 Complete settings table

Stored in `localStorage` under `projectbible_settings` (`settings.ts:7`). Accessors `getSettings()` `:91`, `updateSettings()` `:116` (merges), `clearSettings()` `:251`.

| Key | Type | Default | UI location | Synced |
|---|---|---|---|---|
| `theme` | `'light' \| 'dark' \| 'auto' \| 'sepia'` | `'dark'` | Settings pane, Profile | ✓ |
| `fontSize` | number | `18` | Settings pane, range 12–32 | |
| `lineSpacing` | number | `1.8` | Settings pane | |
| `verseLayout` | `'one-per-line' \| 'paragraph' \| 'paragraph-no-verse-numbers'` | `'one-per-line'` | Settings pane | |
| `wordWrap` | boolean | `true` | Settings pane | |
| `showSectionHeadings` | boolean | `true` | **none** — see [Known gaps](#known-gaps) | ✓ |
| `showArt` | boolean | `true` | Settings pane | ✓ |
| `showRedLetter` | boolean | `true` | Settings pane | ✓ |
| `showPlaceMarkers` | boolean | `false` | Settings pane | |
| `themedTitles` | boolean | `true` | Settings pane | ✓ |
| `interlinear` | `InterlinearSettings` | see [4.1](#41-settings-keys) | Navbar popover + Settings pane | ✓ |
| `tts` | `TtsSettings` | see [16.4](#164-settings) | Settings pane | |
| `allowRotation` | boolean | `false` | Settings pane | |
| `autoCheckUpdates` | boolean | `true` | Settings pane | |
| `timezone` | IANA string | browser-detected | Settings pane | ✓ |
| `dailyDriver*` (6 keys) | string | unset → `'kjv'` fallback | Settings pane, Profile | ✓ |

Legacy keys `dailyDriverEnglish` / `dailyDriverHebrew` / `dailyDriverGreek` are read and migrated by `normalizeSettings()` but never written.

Note the defaults are read with three different idioms, which is why they must be read from the call site rather than the interface: `settings.x || fallback` (falsy-coercing — `fontSize`, `lineSpacing`, `verseLayout`), `settings.x !== false` (default-true — `showRedLetter`, `themedTitles`, `showArt`, `autoCheckUpdates`), and `settings.x === true` (default-false — `showPlaceMarkers`).

### 21.2 Themes

`resolveTheme()` `settings.ts:127` — `'auto'` resolves via `matchMedia('(prefers-color-scheme: dark)')`, falling back to `'dark'` when `matchMedia` is unavailable. `applyTheme()` `:137` swaps a single body class: `dark-theme`, `light-theme`, or `sepia-theme`.

Light and sepia are implemented as a **filter inversion** on `.themed` rather than a second stylesheet — `filter: invert(1) hue-rotate(180deg)`, plus `sepia(0.5) saturate(0.85)` for sepia (`App.svelte:279-293`). Consequences handled explicitly:

- `.emoji` gets the inverse filter re-applied so emoji don't render inverted (`:283`, `:291`).
- `.red-letter` likewise re-applies the filter to cancel the parent's, with a more vivid starting color for sepia since it also passes through `sepia(0.5) saturate(0.85)` (`:295-309`).

Scrollbars are hidden globally while remaining scrollable — `scrollbar-width: none`, `-ms-overflow-style: none`, and `::-webkit-scrollbar { display: none }` (`:311-319`).

### 21.3 Settings pane layout

`SettingsPane.svelte`: Font Size `:280`, Line Spacing `:287`, Verse Layout `:300`, Allow Screen Rotation `:319`, Words of Jesus in red letters `:326`, Theme colors in reader titles `:333`, Show art icons on Bible scenes `:340`, Read section headings aloud `:381`, Highlight the verse being read `:385`, Soft glow drifts along the words `:389`, Time Zone `:395`, Pack Management `:413`, Cache Management `:426`.

Saving dispatches a `settingsUpdated` window event, which `App.svelte:95` and `BibleReader.svelte:623` both listen for.

### 21.4 Clock and timezone

`src/stores/clockStore.ts` — the single source of truth for "what day is it?" across the app.

Uses `Intl.DateTimeFormat` with the configured IANA timezone, so DST transitions, leap years, and offsets are handled by the platform rather than hand-rolled arithmetic (`:4-7`).

- `localDateStr(d)` `:23` → `YYYY-MM-DD`. Any "today vs stored date" comparison must use this.
- `sameLocalDay(a, b)` `:40`
- `todayStore` `:78` — a readable that updates at midnight, so date-dependent UI re-renders without a reload.

### 21.5 Daily greeting and Verse of the Day

`src/lib/dailyGreeting.ts` — `getDailyGreeting(dateStr)` `:118`, taking a `YYYY-MM-DD` string from `localDateStr()`.

Floating Christian holidays (Easter, Good Friday, and so on) and Thanksgiving are computed algorithmically per year, so they land on the correct calendar day regardless of timezone or year (`:5-7`).

`DailyGreetingModal.svelte` parses a verse-of-the-day reference (single verse or range), loads each verse via `textStore.getVerse()`, renders through `renderVerseHtml()`, and offers `goToVerse()` `:59` which navigates to the start verse.

Triggered from `App.svelte`: 800 ms after mount (`:166`), and again on every `todayStore` change so a midnight rollover with the app open still fires it (`:169`). Logic in `src/stores/dailyGreetingStore.ts` (`checkAndShowDailyGreeting`). Toolbar entry point `NavigationBar.svelte:1007`.

### 21.6 Auto-update

`App.svelte:132-163`, gated on `autoCheckUpdates !== false`.

- Checks for a new service worker on mount and on every visibility resume — an installed PWA usually resumes rather than relaunching, so `onMount` alone would miss most reopens.
- On `controllerchange`, sets `sessionStorage['pb-updated'] = '1'` and reloads once.
- Two guards: `hadController` skips the very first install (no controller yet), and the one-shot `swReloaded` flag prevents reload loops.
- After the reload, `UpdateNotice.svelte` shows "Running Latest Version".
- Manual "Check for Updates" and "Clear cache" (packs, service workers, databases) in `SettingsPane.svelte:426`.

### 21.7 Global keyboard shortcuts

`App.svelte:111-128`. **J** — open today's journal entry in a right-edge window at 50%. Suppressed when the event target is an `input`, `textarea`, or `contenteditable`, and when Ctrl/Meta/Alt is held.

### 21.8 Debug tooling

Eruda is initialized on every mount (`App.svelte:60-72`), positioned 60 px from the bottom-right corner. This is a mobile debug console and ships in the current build — worth removing or gating before a public release.

---

## Appendix A — Data layer

Not user-facing features, but every feature above sits on these.

### A.1 IndexedDB

`src/adapters/db.ts` (1,053). Database `projectbible`, **schema version 31** (`:15` — migration 31 added the `art_images` store for bundled painting blobs).

Object stores, grouped by what they serve:

| Group | Stores |
|---|---|
| Packs & text | `packs`, `verses`, `art_images` |
| User data | `user_notes`, `user_highlights`, `user_word_highlights`, `user_bookmarks`, `journal_entries` |
| Study | `cross_references`, `strongs_entries`, `greek_strongs_entries`, `hebrew_strongs_entries`, `lexicon_entries`, `pronunciations`, `morphology`, `word_occurrences`, `tsk_references`, `commentary_entries` |
| English lexical | `english_words`, `english_synonyms`, `thesaurus_synonyms`, `thesaurus_antonyms`, `english_grammar`, `english_definitions_modern`, `english_definitions_historic`, `english_definitions_wordset`, `word_mapping` |
| Places & maps | `places`, `place_name_links`, `map_tiles`, `historical_layers`, `pleiades_places` |
| Reading | `reading_history`, `reading_plans`, `reading_plan_days`, `reading_progress`, `plan_metadata`, `chronological_order` |
| Audio | `audio_chapters`, `audio_cache` |
| Sync | `sync_queue`, `sync_operations` |

`word_mapping` is keyed on `lemma` rather than an id — it is the lookup that makes English definitions resolve off lemma rather than surface text (see [5.3](#53-english-word-lookup)).

Row types are declared as `DB*` interfaces in the same file (`DBVerse`, `DBUserNote`, `DBSectionHeading`, `DBArtScene`, and so on).

`src/adapters/db-manager.ts` (339) handles open/upgrade/reset; `src/adapters/index.ts` and `src/lib/adapters.ts` are the barrel exports.

### A.2 Text access

`IndexedDBTextStore`, `src/adapters/TextStore.ts:67` — the read path every reader surface goes through.

| Method | Line |
|---|---|
| `getVerse(...)` | 68 |
| `getChapter(...)` | 98 |
| `getTranslations()` → `{id, name}[]` | 158 |
| `getBooks(translation)` | 227 |
| `getChapters(translation, book)` | 268 |
| `getVerses(translation, book, chapter)` | 306 |

`HeadingsStore`, `src/adapters/HeadingsStore.ts:7` — `getChapterHeadings()` `:12`, `isInstalled()` `:43`. Supplies the pericope headings described in [1.2](#12-what-appears-in-the-text).

`src/adapters/SearchIndex.ts` (`IndexedDBSearchIndex`) backs the Bible category of unified search.

### A.3 Caching

`src/lib/lru-cache.ts` — `LRUCache<K, V>` `:8`, evicting least-recently-accessed on overflow. One shared instance is exported: `dictionaryCache = new LRUCache<string, any>(500)` `:61`.

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
| `showSectionHeadings` has no UI toggle | The setting is honored by the reader (`BibleReader.svelte:551`, `:4205`) and is in the synced-settings list (`src/lib/sync/settingsSync.ts:35`), but no control exists in `SettingsPane.svelte`. It can only change via sync or a manual `localStorage` edit. |
| `fontSize` / `lineSpacing` doc-comment defaults are stale | `src/adapters/settings.ts:54-55` documents defaults of `15` and `1.5`. The applied defaults are `18` and `1.8` (`SettingsPane.svelte:10-11`, `:55-56`). The code is the truth; the comments are wrong. |
| `isChronologicalMode` has no UI control | Flag and setter exist on the nav store (`navigationStore.ts:8`, `:86`) and are persisted, but nothing in the navbar or settings sets them. |
