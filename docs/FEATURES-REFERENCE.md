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
| Section headings | Setting `showSectionHeadings`, default `true`. Extracted from the leading `+ Heading. ` marker in stored verse text by `extractHeading()`, `verseRendering.ts:296`. Rendered at `BibleReader.svelte:4205`. **No UI toggle exists** — see [Known gaps](#known-gaps). |
| Footnotes | Stored as `+ note text` runs terminated by a `\x01` sentinel. Rendered as `<sup class="inline-note inline-footnote">[n]</sup>` in `#6699ff`. `renderTextWithInlineNotes()`, `verseRendering.ts:94` |
| Cross-reference markers | Same mechanism, rendered grey `#ccc` with class `.inline-xref`. Classified by `isCrossReference()`, `verseRendering.ts:19` — a note counts as a cross-reference if it contains a `\d+:\d+` token and does *not* begin with a wording-note starter (`Or`, `Lit`, `I.e.`, `That is`, `Some manuscripts`, `Gr.`, `Gk.`, `Heb.`, `Aram.`, `Lat.`). |
| Note-boundary detection | `findNoteEnd()`, `verseRendering.ts:48` — shared by the HTML renderer and the read-aloud text extractor so the two can never disagree about where a note ends. Treats `Gr`, `Gk`, `Heb`, `Aram`, `Lat`, `Syr`, `LXX`, `Vg` as non-terminal abbreviations so their trailing period doesn't end the note early. |
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

## 7. Commentaries

<!-- TODO:7 -->

## 8. Cross-References

<!-- TODO:8 -->

## 9. Search

<!-- TODO:9 -->

## 10. Highlights & Notes

<!-- TODO:10 -->

## 11. Repeated Words

<!-- TODO:11 -->

## 12. Journal

<!-- TODO:12 -->

## 13. Reading Plans & Progress

<!-- TODO:13 -->

## 14. Maps & Places

<!-- TODO:14 -->

## 15. Art

<!-- TODO:15 -->

## 16. Read Aloud

<!-- TODO:16 -->

## 17. Audio

<!-- TODO:17 -->

## 18. Panes & Windows

<!-- TODO:18 -->

## 19. Content Packs

<!-- TODO:19 -->

## 20. Account & Sync

<!-- TODO:20 -->

## 21. App Settings & Appearance

<!-- TODO:21 -->

---

## Known gaps

Things found during the sweep that are wired but incomplete, or where code and comments disagree. Documented here rather than described as working features.

| Item | Detail |
|---|---|
| `showSectionHeadings` has no UI toggle | The setting is honored by the reader (`BibleReader.svelte:551`, `:4205`) and is in the synced-settings list (`src/lib/sync/settingsSync.ts:35`), but no control exists in `SettingsPane.svelte`. It can only change via sync or a manual `localStorage` edit. |
| `fontSize` / `lineSpacing` doc-comment defaults are stale | `src/adapters/settings.ts:54-55` documents defaults of `15` and `1.5`. The applied defaults are `18` and `1.8` (`SettingsPane.svelte:10-11`, `:55-56`). The code is the truth; the comments are wrong. |
| `isChronologicalMode` has no UI control | Flag and setter exist on the nav store (`navigationStore.ts:8`, `:86`) and are persisted, but nothing in the navbar or settings sets them. |
