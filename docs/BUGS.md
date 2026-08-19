# Known Bugs

Running list of bugs found while using the app. Each entry has what's wrong, where
the code lives, and what's actually causing it — so any item can be picked up cold.

All paths are relative to `apps/pwa-polished/src/` unless stated otherwise.
Line numbers were verified 2026-08-13 and will drift as the files change.

---

## The four works

The four lookup cards are one system, reached from each other by the tab row across
the top of every card. Order is fixed — Dictionary, Topical, Encyclopedia, People —
and a tab greys out when that work has nothing for the subject.

Availability and opening both come from one place: `resolveWorks(name, ref?)` in
`adapters/lexicon-lookup.ts`, which asks all four at once and returns the **ids**, not
booleans, so a lit tab is guaranteed to open something. It uses `headWord` for the
dictionary (which files single words) and the full name for the rest, and hands back
the term it used so open handlers can't drift from what lit the tab up. Before this
there were eight separate checkers with four different term rules between them.

The tab row is `components/WorkTabs.svelte`. Its class is deliberately **not**
`.tabs`: `IsbeContent` and `NavesContent` style their section tabs as an unqualified
`.tabs button`, which would capture it. Over the A–Z index the tabs switch index
rather than subject; Dictionary greys out there, having no index of its own.

The index badges (📍 👤 📕 📚 📖) navigate too, added 2026-08-13.
`annotateLibraryBadges` keeps the id beside each flag it sets — the ids were always
in the records it reads, they were just being discarded — so a tap goes straight
there and can't disagree with the dot that invited it. Two rules to preserve if you
touch this: match on the full name first and `headWord` second, the same order and
the same two keys the badge itself was decided on; and the 📍 pin marks a
*geographic entry*, not a mappable one, since plenty of places have no coordinates —
it opens the Map tab only when there is a point, and the overview otherwise.

Only one lookup card is open at a time. The tabs close the one they leave, and
`IndexList.soloCard` does the same before a badge opens anything — two open cards
would also put two Escape handlers on the same key. Docked windows aren't stores, so
they survive both.

Quick map of the four, since they're spread across more files than you'd expect:

| Popup | Shell | Content | Store |
|---|---|---|---|
| Dictionary | `LexicalModal.svelte` | (self-contained) | `stores/lexicalModalStore.ts` |
| Encyclopedia | `IsbeModal.svelte` | `IsbeContent.svelte` | `stores/isbeModalStore.ts` |
| Topical | `NavesModal.svelte` | `NavesContent.svelte` | `stores/navesModalStore.ts` |
| People | `PersonModal.svelte` | `PersonContent.svelte` | `stores/personModalStore.ts` |

People got its own store and shell on 2026-08-13. Until then a bio could only reach
the screen riding `lexicalModalStore.characterData` — as a word study of a word that
happened to be a person — which is why nothing could navigate *to* one. It still
renders inside the Dictionary card when a tapped name resolves to someone, where
Dictionary and People are a flip apart rather than two cards.

All four mount globally in `App.svelte:283-287`. Tap dispatch is
`BibleReader.svelte:4280-4424` (person → ISBE → English lexicon → Strong's).

---

### [x] 1. Dictionary has a different look than Encyclopedia and Topical; Bio also looks slightly different

**Fixed 2026-08-13.**

Dictionary was the odd one out of the four, so it was changed to match Encyclopedia
and Topical rather than the other way round. What you'd notice:

- The title is smaller and sits in the same place, with the same spacing around it.
- There's now a small grey line under the title, like the other three have. It reads
  `Greek · agapē · noun` for a Strong's entry, `Dictionary · noun, verb` for an
  English word, the verse count for a bio, and the result count for a search.
- The card is the same width as the other two, with the same rounded corners, and
  the background behind it is blurred the same way.
- The tabs are smaller. They wrap onto a second row when there's no space instead of
  scrolling sideways, and the selected tab is the app's blue instead of a green that
  appeared nowhere else.
- The category pills and the close button are the same size as the other two.

Bio needed no changes of its own — it borrows Dictionary's frame, so it picked all of
this up automatically.

Encyclopedia and Topical each got two small changes, so the matching went both ways:
their pills and tabs had been falling back to the browser's default font instead of
Milonga, and they now slide up when opening the way Dictionary always has.

Still open for these headers: bug #2 below. All three now share the same header
markup, so fixing #2 will fix all of them at once.

**Follow-up, 2026-08-13.** Using the matched cards showed the problem went past
styling — they didn't behave like one system. The bridge pills changed depending on
which card you were in, the Dictionary title read "Lexical Study: love" with the word
lowercase and tacked on the end, and People wasn't somewhere you could navigate to at
all. Replaced with four fixed tabs across the top of every card — Dictionary, Topical,
Encyclopedia, People — always the same four in the same order, greyed when that work
has nothing for the subject. See "The four works" below.

#### Exact values changed

`LexicalModal.svelte` — `h2` wrapped in a `.head-text` div (`flex:1; min-width:0`)
with a `.sub` line beneath it fed by the new `headerSubtitle` reactive; header to
`align-items:flex-start`, `padding:16px 18px 10px`, `gap:12px`; `h2` to 20px with
`line-height:1.15` and `overflow-wrap:anywhere`, no longer `display:flex`;
`.strongs-id` given its own `margin-left` in place of the flex gap it had been
relying on, and sized down to suit; card to `min(720px,100%)` / `min(86vh,900px)` /
`radius:10px` / `overflow:hidden`; backdrop to `rgba(0,0,0,.6)` + `blur(3px)` +
`padding:16px`; body padding to `16px 18px`; `.bridge-btn` to `4px 10px` / 12px;
`.close-btn` to the plain muted-with-hover treatment; tab strip to 13px / `8px 12px`
/ wrapping / accent `var(--color-primary)` in place of the hardcoded `#4caf50`;
mobile card and tab overrides dropped, since the card now sizes identically at every
width.

`IsbeContent.svelte` — added `font-family: inherit` to `.bridge-btn` and
`.tabs button`, the only two rules across the four files that lacked it.

`IsbeModal.svelte` and `NavesModal.svelte` — added the `fadeIn` / `slideUp`
keyframes and animations that `LexicalModal` already had.

`PersonContent.svelte` — untouched. It already zeroes its own padding under
`.person-content.hosted`, so it inherits the corrected `.modal-body` padding.

#### Original diagnosis

There were two different header architectures in play.

**Pattern A** — Encyclopedia / Topical / Bio share it:
`IsbeContent.svelte:956-997`, `NavesContent.svelte:404-443`, `PersonContent.svelte:372-413`.
Title sits in a `.head-text` wrapper (`flex:1; min-width:0`), `h2` is 20px with
`overflow-wrap:anywhere`, header padding `16px 18px 10px`, `align-items:flex-start`,
plus a `.sub` subtitle line.

**Pattern B** — Dictionary only: `LexicalModal.svelte:597-652`, CSS at `:1215-1259`.
Differs on every one of those points:

- no `.head-text` wrapper, so the `h2` is a raw flex item with default
  `min-width:auto` — it can't shrink below its longest word
- no `overflow-wrap:anywhere`
- `align-items:center` instead of `flex-start`
- `font-size:24px` and `padding:24px`, vs 20px and `16px 18px 10px`
- the `h2` is itself `display:flex`, which is why the Strong's ID badge sits inline
- no `.sub` subtitle line at all

The card shells differ too. Dictionary is `max-width:800px`, `border-radius:12px`,
with `slideUp`/`fadeIn` animations and **no** backdrop blur
(`LexicalModal.svelte:1168-1202`). Encyclopedia and Topical are matched at
`min(720px,100%)`, `border-radius:10px`, `backdrop-filter:blur(3px)`, no animation
(`IsbeModal.svelte:117-138`, `NavesModal.svelte:76-97`). Dictionary also has a
mobile full-bleed breakpoint (`:1856-1877`) the other two lack.

**Why Bio is slightly off:** it's Pattern A content rendered inside the Pattern B
shell — hosted in `LexicalModal.svelte:661` with `showHeader={false}`.

**Also:** `.bridge-btn` (the category pills) is copy-pasted into all four files.
`NavesContent` and `PersonContent` set `font-family: inherit`; `IsbeContent` and
`LexicalModal` **don't**, so Encyclopedia's and Dictionary's pills render in the
browser's default button font instead of Milonga. LexicalModal's are also a size
bigger (`padding:5px 11px; font-size:13px` vs `4px 10px; 12px`).

---

### [x] 2. Long titles render vertically instead of left-to-right

**Fixed 2026-08-13**, in two parts.

Most of it went with the pills. They were what squeezed the title, and removing them
for the work tabs gave the title column about 556px in a 720px card — enough that
even the longest name in the encyclopedia, "Stranger And Sojourner (In The Apocrypha
And The New Testament)" at 63 characters, wraps between words and reads left to
right.

What remained was docked windows, which can be dragged to 10% of the viewport —
about 140px of content, which left the title column at *negative* width. Two
changes, in all four cards:

`overflow-wrap` went from `anywhere` to `break-word`. That was the direct cause of
letter-by-letter stacking: `anywhere` splits mid-word the moment a column gets
tight, whereas `break-word` only splits a word that genuinely cannot fit. The
longest single word anywhere in the encyclopedia is "Anthropomorphism" at 16
characters, so in practice words are no longer split at all.

The header rows gained `flex-wrap: wrap`, and `.head-text` went from `flex: 1` to
`flex: 1 1 180px`. The basis makes the header wrap *before* the title is squeezed
below a readable width, so in a narrow pane the title drops to its own line instead
of being crushed. A pane at its 10% minimum is still tight by nature — that's a
140px column, not a layout bug.

<sub>Original diagnosis follows.</sub>

Encyclopedia and Topical put the entry title on the same flex row as the
Encyclopedia/Topical/Dictionary pills.

`.head-text` is `flex:1; min-width:0` while `.head-actions` is `flex-shrink:0`
(`IsbeContent.svelte:1184-1229`, mirrored in `NavesContent.svelte:621-664` and
`PersonContent.svelte:621-700`). The pills therefore always win the width contest,
and the title is squeezed into whatever's left — with `overflow-wrap:anywhere` it
wraps down its own narrow column, one word (sometimes one letter) per line.
`align-items:flex-start` keeps the pills pinned top-right while the title stacks
beneath them.

Wanted: title reads left-to-right. Fix direction — give the title its own full-width
row above the pills.

---

### [~] 3. Encyclopedia Verses tab is there sometimes, missing other times

**Closed by decision 2026-08-13 — not a bug, nothing broken.** Investigated, then
dropped: the tab is correctly data-gated and entries without verses genuinely have
none to show.

**Only places have verses.** The ISBE pack has exactly one verse table,
`place_verses`. Of 9,380 entries, 958 are places and get a tab; the other 8,422 have
no verse data at all. "Euphrates River · 44 verses" is a place, which is why it has a
list.

If it's ever wanted as a *feature*: 6,917 entries cite scripture inside the article
text, already marked up by the pack builder as
`<a class="isbe-scripture" data-osis="Exod.6.20">` — 6,049 of them non-place entries.
Harvesting those would take coverage from 958 entries to about 6,917, and would be the
encyclopedia's own citations rather than anything borrowed from Topical or Bio.
Topical already works exactly this way: `naves_verses` isn't separate data, it's the
OSIS refs cited in Nave's outline points, expanded at pack build time. Doing it at
read time from the already-loaded article HTML would need no pack rebuild and no
release swap. The citation data is clean — two shapes only (`Book.Chapter.Verse` and a
same-chapter range), exactly the 66 canonical book codes, median 4 refs per entry, and
ranges should stay expanded rather than listed whole (largest is `Ps.119.1-176`).

#### Original diagnosis

Not a regression — the tab is data-gated and always has been.

- Encyclopedia: `IsbeContent.svelte:390` sets `hasVerses = verses.length > 0`;
  the tab at `:1017` is inside `{#if hasVerses}`. Article and Map tabs are gated
  the same way (`:388-390`).
- Topical: same gate at `NavesContent.svelte:116`, tab at `:460`.
- Bio: **no Verses tab at all** — uses an inline collapsible disclosure instead
  ("Appears in N verses"), `PersonContent.svelte:493-535`.
- Dictionary: no Verses tab; its tab lists are hardcoded and always render
  regardless of data (`LexicalModal.svelte:800-815` and `:991-1013`).

So the entries where the tab vanishes are ones where the verse query returned zero
rows. **The real question is a data one, not a UI one:** are ISBE entries that
should have verses coming back empty?

Design intent to preserve when fixing: Topical, Encyclopedia and Bio each own their
own verse list. There is no master list to be shared between them. Maybe it is working correctly already.

---

### [x] 4. Topical outline verse pills are all green, ignoring app theme colors

**Fixed 2026-08-13.** The scripture links on the Topical outline tab are now coloured
by book, using the same colours the Verses tab and the nav bar's reference dropdown
already use. Hovering one highlights it in that book's colour too.

Links that point at another topic rather than a verse are unchanged — they aren't
scripture, and they were already the right colour.

The chips already carried the reference they point at, so the book was there to read;
nothing new had to be looked up.

#### Original diagnosis

`NavesContent.svelte:831-853` — `.ref-chip` hardcodes `color: #8bc34a` (and the
hover state hardcodes the same green). The rule immediately after it re-tints
`.link-chip` (cross-topic links) blue, but `.ref-chip` keeps the green
unconditionally, so every scripture pill in the outline is the same color no matter
which book it points at.

Pills are rendered in three places in the outline: `NavesContent.svelte:487-498`,
`:506-517`, `:529-540`.

**The right mechanism already exists and is already used one tab over.**
`getBookColor()` / `CATEGORY_COLORS` live in `lib/bibleData.ts:207-238`, and the
Verses tab of this very same component already colors by book —
`NavesContent.svelte:172-186`, applied inline at `:551`, `:554`, `:563`, `:566`.
Each `.ref-chip` carries `r.osis`, so the same call works per-chip.

**Wider cause worth knowing before touching modal colors:**
`--color-primary`, `--background-color`, `--text-color`, `--border-color` and
friends are **never defined at `:root`** — zero matches across `src/` and
`index.html`. Every `var(--color-primary, #4a90e2)` in these four files silently
resolves to its fallback, so the popups are permanently `#4a90e2` on `#1e1e1e`.

The only real design tokens are the `--reader-*` set written in
`adapters/settings.ts:329-346` (`--reader-bg`, `--reader-text`, `--reader-rule`,
`--reader-red`, …), derived by `lib/themeColors.ts`. None of the four popups read
them.

On top of that, the popups render outside `.main-content.themed`
(`App.svelte:275-287`), and light/sepia are implemented as
`filter: invert(1) hue-rotate(180deg)` on `.themed` (`App.svelte:325-339`) — so the
popups **stay dark in every theme**. `Window.svelte:213-219` makes this explicit
for the docked variants by excluding `map`/`isbe`/`person`/`naves`.

Same hardcoded-green leak elsewhere, if doing a sweep:
`PersonContent.svelte:817, 879, 904, 936, 958`; `NavesContent.svelte:908`; and
`#4caf50` / `#8bc34a` throughout `LexicalModal.svelte` (`:1306, 1372, 1420-1421,
1444, 1476, 1494, 1549, 1556, 1571, 1711, 1726, 1738, 1753, 1809, 1883`).

---

## Navigation

### [x] 5. Encyclopedia flip-over lands on letter "N", not on "Noah"

**Fixed 2026-08-13.**

Flipping to the index now scrolls straight to the entry you were reading and keeps
that row marked — a blue bar down its left edge and a faint tint — for as long as the
index is open. Same in Encyclopedia, Topical and Bio.

The row is found by its id, not its name. That matters more than it sounds: the
encyclopedia holds two Noah entries, `NOAH (1)` and `NOAH (2)`, and the pack builder
strips the number when it files them, so both sit in the index under the plain name
`Noah`. 166 names collide like that, covering 342 of the 9,380 entries. Matching by
name would have quietly landed on the first one every time — including for Noah, the
entry this bug was reported against.

If the row can't be found, you land at the top of the letter exactly as before, so
nothing got worse in the cases this doesn't cover.

Note the two Noah rows still *look* identical in the list; only the marker tells them
apart. Giving duplicates a visible disambiguator was considered and deliberately left
alone.

#### Exact values changed

`library/IndexList.svelte` — new `initialRowId` prop beside `initialLetter`,
consumed at the end of `onMount` after `selectLetter` resolves and a `tick()` lets
`filteredRows` settle. The tail of the existing private `jumpTo` — grow
`visibleCount`, tick, `scrollIntoView({block:"center"})` — was pulled out into a
shared `revealRow(i)` helper that both `jumpTo` and the new landing path call. A
`isCurrentRow` reactive compares `String(row.id)` against `String(initialRowId)`,
driving `class:is-current` on `.row-wrap`, styled with an inset box-shadow rather
than a left border so marking a row doesn't nudge its text sideways.

`IsbeContent.svelte` — passes `initialRowId={contentsRowId}`, where `contentsRowId`
is `entry?.entryId ?? place?.entryId ?? entryId`; the prop alone is null when the
article was opened by place. `contentsLetter` now derives from `entry?.primaryName`
falling back to `title`, because a place-opened article titles itself with
OpenBible's spelling while its index row is filed under the encyclopedia name — the
old version could open a letter that didn't contain its own row.

`NavesContent.svelte` — `contentsRowId` is `topic?.topicId ?? topicId`.

`PersonContent.svelte` — `contentsRowId` is `person?.id`, read off `person` rather
than the `personId` prop because the modal path may have picked a homonym. People
ids are strings, which is why the comparison stringifies both sides.

#### Original diagnosis

Repro: tap Noah in the text → Bio → Encyclopedia pill → Noah's ISBE entry → tap the
upper-left flip toggle. The index opens at letter N, and you still have to scroll a
long list to find Noah. Wanted: scroll to the Noah row itself, so you can see where
it sits in the index.

- Flip button: `library/LibraryNavButtons.svelte:28-37` (Back arrow + Swap icon)
- Handler: `IsbeContent.svelte:300-312` (`flip()`), wired at `:957`
- Letter derived at `:278` — `contentsLetter = libraryLetterOf(title.toLowerCase())`
- Passed as `initialLetter` at `:999-1000`, consumed only in
  `library/IndexList.svelte:63-67` (`onMount`). An `onMount`-only prop is fine here
  because the `{#if}` destroys and recreates `IndexList` on every flip.

**The behavior we want already exists — it's just unreachable.** `jumpTo(prefix)` at
`IndexList.svelte:190-205` is the typeahead handler ("type N-o-a to jump"), and it
already does exactly the right sequence: select the letter, `await tick()`, bump
`visibleCount` until the target row is rendered, then
`scrollIntoView({block:"center"})`. It isn't exported and no host does `bind:this`.

Two ways in:

- **(a)** add an `initialRowKey` prop (the entry's `sortKey`, i.e.
  `title.toLowerCase()`) consumed in `onMount` right after `selectLetter`, passed
  from `IsbeContent:1000` next to `initialLetter` — both derive from the same
  `title`, so they stay consistent for free
- **(b)** `export function jumpTo` + `bind:this`. Precedent for an exported method
  in this file already exists: `IsbeContent.svelte:294` exports `handleBack`

Gotchas:

- `selectLetter` hard-resets `listEl.scrollTop = 0` (`IndexList.svelte:83-86`), so
  any jump has to run *after* it resolves
- `.section-head` is `position:sticky; top:0` (`:421-431`) — `block:"start"` would
  tuck the row under it; `block:"center"` is correct
- `handleScroll` (`:106-127`) treats downward scroll near the bottom as "load
  another chunk / roll into the next letter", and a programmatic `scrollIntoView`
  registers as downward
- `selectLetter` fires an async `annotateBadges` pass that reassigns `rows`
  afterward (`:89-93`), so the list re-renders post-jump
- the starred/recent shelves render above `.section-head`, so absolute offsets are
  unreliable — `scrollIntoView` on the row element is the right primitive
- rows carry `data-row={i}` (`:324`) where `i` is the index within `shownRows`, not
  a stable entry id; `row.id` is the keyed-each key but is never written to the DOM

Same flip pattern in `NavesContent.svelte:311-322` and `PersonContent.svelte:190-201`
— fix all three.

---

### [x] 6. Ring menu stays in Verse scope after you use it once

**Fixed 2026-08-15.** The scope now returns to Word at the start of every new tap,
and again when a selection is dismissed. Verse is a choice about the selection you
have, not a mode left switched on.

Previously only a committed drag reset it, and a plain tap never goes down that path
— so one use of Verse made every later tap select a whole verse for the rest of the
session. Extend and shift-click return before the reset, so they still grow the
selection you already have rather than starting over.

Two side effects went with it: while stuck on Verse the reader skipped the person and
encyclopedia lookup, so Define never relabelled to Bio or Info; and Mark saved a
whole-verse highlight where a word one was meant, which then wouldn't line up with
word highlights made elsewhere.

**Also, same pass: the Word/Verse pair became one toggle.** On a fresh tap the word
is already highlighted in front of you, so a button announcing it earned nothing. The
single button is labelled with what you'd be switching *to* — "Verse" on a word,
"Word" once the verse is selected. It never shows an active state, because its label
is where you'd be going rather than where you are. Done in both the ring and the
plain toast so the two stay consistent; the ring re-spaces itself around the freed
seat, since the seat geometry only spreads however many buttons it's given.

**Regression from that toggle change, fixed the same day.** Moving the toggle to the
ring's trailing seat made the *last* seat removable for the first time, which exposed
a latent fault in the closing sweep.

Each departing seat staggers out on a delay worked out from the ring's **new** length
against that seat's **old** index. A seat leaving from beyond the end of the new ring
therefore produced a **negative** delay. Svelte implements a transition delay as an
animation whose *duration* is the delay, and `element.animate` rejects a negative
duration outright — so the throw escaped mid-flush and left the scheduler unable to
queue any further effect. The whole app stopped redrawing until reload.

That single throw produced three separate-looking symptoms: the label never changed
(removing the old seat is what failed, and it sits on identical coordinates to its
replacement, covering it); Mark appeared to only delete the highlight (clearing a
highlight is direct DOM work so it still ran, while opening the modal and closing the
ring both needed a render); and the ring couldn't be dismissed (also a render).

Unreachable before, because the trailing seat was always Verse and Verse was never
removed. Fixed by clamping the delay at zero — which is also the *correct* value,
since the highest-index seat should leave first in a reverse sweep. A stray **Extend**
button stranded at the bottom of the ring was the visible tell.

Separately, the toggle had been left wearing the dim grey that used to mean "not the
mode you're in", which alone reads as a switched-off button. It now uses the same
indigo an armed Extend uses for a live choice, in both the ring and the plain toast.

#### Original diagnosis

Repro: tap a word → ring appears, word highlighted. Tap Verse → whole verse selects.
Tap away, tap a new word → it selects the whole verse again, because Verse was last
used. Wanted: always default back to Word. Verse should be an explicit choice every
time — the common case is wanting info on the word you just tapped.

State: `BibleReader.svelte:533` — `let selectionMode: "word" | "verse" = "word"`.
Plain component-local `let`; not a store, not persisted, doesn't survive reload —
but sticky for the entire reading session, which is what you're seeing.

Currently reset in only three places, none of which a plain tap hits:

- `:2857` `armWordDrag()` — only once a gesture commits to a drag (3px mouse / 8px
  finger / 300ms hold)
- `:3012` `finishWordSelection()` — only the multi-word branch
- `:3644` `stopDrag()` — only after a bumper-handle drag that moved

Set by the user at `:4523` (`handleModeChange`).

**Root cause:** a plain tap never calls `armWordDrag()`. `handlePointerDown`
(`:2774-2835`) clears everything else about the previous selection at `:2799-2806`
— toast, highlights, painted selection, segments, counts — but leaves
`selectionMode` alone. `dismissSelection()` (`:3539-3547`) has the same omission.
`handleTextSelection:3332` then reads the stale `"verse"` and
`highlightSelection:3446` takes the else-branch and paints the whole verse.

Two side effects of the same staleness, worth fixing in the same pass:

- `showToastAt:4011` — `if (lookup && word && selectionMode === "word")`, so while
  stuck in verse mode the person/ISBE lookup never fires and Define never relabels
  to **Bio** / **Info**
- `handleToastAction` branches on it at `:4445, 4458, 4469, 4470, 4474`, so a Mark
  from a stuck-verse tap saves as a **verse** highlight with `pendingWordSpans = []`

Best fix site: `handlePointerDown`, alongside the existing clears at `:2801-2806`.
Every new gesture — tap or drag, mouse or finger — passes through it, and the
`extendArmed`/shiftKey early return at `:2784-2797` bails *before* that block, so
Extend still correctly preserves the current selection. Worth adding to
`dismissSelection()` too.

The stale value is read at three sites for the different text modes: `:1347`
(interlinear), `:3261` (Greek/Hebrew), `:3332` (English).

`SelectionToast.svelte` (the classic non-ring variant) shares the same
`mode`/`modeChange` contract and therefore the same bug. The ring itself
(`RadialSelectionMenu.svelte`) holds no state — it's pure presentation, `mode` prop
at `:35`, dispatches `modeChange` at `:171`.

---

## Search

### [x] 7. Navbar search spinner should use the ProjectBible icon

**Fixed 2026-08-13.**

Both search boxes — the one in the navbar and the reference search used by the
library windows — now spin the ProjectBible gem while they work, at the same speed as
the Read Aloud spinner, instead of the old dots.

#### Exact values changed

`NavigationBar.svelte` — the phosphor `SpinnerGap` in the search box swapped for
`BrandSpinner size={14} title="Searching…"`; the title is passed explicitly because
BrandSpinner's default reads "Preparing speech…" and doubles as the screen-reader
label. `SpinnerGap` dropped from the phosphor import, this being its only use.
`.search-spinner-wrap` lost its `animation` line (the wrapper used to spin *itself*,
which would have turned the gem twice over) and its `color` line (it tinted the old
icon and does nothing to an image). The `@keyframes spin` block went with it, having
no other user in the file.

`library/RefSearchBar.svelte` — identical change at `size={13}`, plus a new
`BrandSpinner` import.

#### Original diagnosis

Current: `NavigationBar.svelte:1162-1165` renders phosphor `SpinnerGap`
(imported `:67`). CSS `.search-spinner-wrap` at `:1928-1941` puts
`animation: spin 1s linear infinite` on the **wrapper div**, not the icon.

Reuse instead: `BrandSpinner.svelte` — class `.brand-spinner`, keyframes
`brand-spin`, `animation: brand-spin 1.69s linear infinite` (`:37`; the comment at
`:36` notes it's deliberately 35% slower than the original 1.1s). Props are
`size` (default 20) and `title` (doubles as `aria-label`). Asset is `/pb-gem.png`,
precached in `vite.config.ts:228`.

`NavigationBar.svelte` **already imports BrandSpinner** at `:43` and uses it at
`:1044` for the TTS nav button, so this is markup-only.

**Gotcha:** remove the `animation` from `.search-spinner-wrap` or the icon will
double-rotate — BrandSpinner animates itself.

Other existing usages, for sizing reference: `TtsPlayer.svelte:29, 106, 113`,
`ReadingPlanModal.svelte:23, 1697`, `ProfileModal.svelte:18, 438` — all pass a small
explicit `size`.

The same dots pattern is duplicated in `library/RefSearchBar.svelte:3, 83, 189-200`
— worth changing at the same time.

---

### [x] 8. Clicking the `>` / `v` arrows dismisses the search results

**Fixed 2026-08-13.** Clicking the arrow now expands and collapses the group, and the
results panel stays open.

Two changes, at different layers, because the instance and the class of bug are
different problems:

`SearchResultsTree.svelte` — `pointer-events: none` on `.tree-caret`. A click on the
arrow now reports the enclosing button as its target rather than an icon that is about
to be destroyed, so the click-outside check can still resolve where it landed. It also
makes the arrow part of the same hit area as the label, instead of a separate thing
you can miss. Done here rather than with `stopPropagation` on the header because the
component has three consumers — `NavigationBar`, `NotesPane` and `PowerSearchModal` —
and only one of them had the bug.

`NavigationBar.svelte` — `closeDropdowns` now bails out when the click target is no
longer connected to the document. A detached node reports no ancestors, so every
"is this inside?" check passes and the panel closes itself. Anything inside a dropdown
that re-renders on click would have hit this; the guard covers the next one too.

#### Original diagnosis

In the navbar search results you can only expand/collapse by clicking the words.
Clicking the chevron closes the whole results panel and you have to search again.

There is **no separate chevron button** — the caret, label and count are all inside
one `.tree-header` button with one handler
(`SearchResultsTree.svelte:69-87`). So the click handler is identical for both
paths. The only difference is what `event.target` ends up being.

**Root cause:** the caret sits inside an `{#if}` (`SearchResultsTree.svelte:77-81`)
that swaps `CaretDown` ↔ `CaretRight`. Sequence on a chevron click:

1. the button handler fires → `onToggle(key)` → `toggleSearchNode`
   (`NavigationBar.svelte:751-756`) reassigns `expandedSearchNodes`
2. Svelte flushes in a **microtask** — after the button's listener returns, but
   before the document-level listener runs
3. the `{#if}` tears down the old caret, so the clicked `<path>`/`<svg>` is
   **removed from the document**
4. `closeDropdowns` (`NavigationBar.svelte:462-481`, registered on `document` at
   `:842-852`) then runs against a detached target.
   `target.closest(".search-results-dropdown")` returns `null`, all six guards
   pass, and `showResults = false`

Clicking the words works because `.tree-label` (`:83`) and `.tree-count` (`:86`) are
outside the `{#if}` and the `{#each}` is keyed (`:67`) — those nodes survive the
re-render, so `closest()` still resolves and the guard short-circuits. Clicking the
padding of `.tree-caret` outside the SVG box works for the same reason.

Contributing factor: the results panel renders as a sibling outside `.nav-pill`
(`NavigationBar.svelte:1242-1271`), and the `on:click|stopPropagation` at `:1138`
covers only `.pill-search-area` (the input), not the dropdown. So every click in
the panel bubbles to `document`, and survival depends entirely on that
`closest()` check.

Secondary effect — why it looks like the entire bar collapses: `handleSearchBlur`
(`:781-788`) runs a 150ms timer that re-reads `showResults`; by the time it fires,
`showResults` is already false, so the field also collapses back to its icon. Not
the cause, but part of the symptom.

Three independent fixes, any one of which breaks the chain:

- `pointer-events: none` on `.tree-caret svg` (or `.tree-caret`) — cleanest, no
  logic change, `event.target` becomes the persistent button
- `on:click|stopPropagation` at `SearchResultsTree.svelte:74`
- make `closeDropdowns` resilient to detached targets: early-return on
  `!target.isConnected`, or use `event.composedPath()` (captured at dispatch time,
  so it still contains the panel)

`PowerSearchModal.svelte` reuses the same `SearchResultsTree` (`:19, 524-528`) but
is immune — its `.modal-container` has `on:click|stopPropagation` (`:267`) and
there's no document-level close handler.

---

### [x] 9. The search box inside Encyclopedia / Topical / Bio won't hold focus

**Fixed 2026-08-13**, and the whole class of it with it.

This was never really about that one search box. The report that cracked it was
"every time you add a new place to type we hit this snag" — and the codebase already
said so, in a comment on `NotesPane.svelte`:

> EdgeGestureDetector watches mousedown and touchstart on the whole window to spot
> edge swipes, and only excuses rich-text areas — a plain input loses focus to it
> mid-tap. **Every input in the app that works stops these first.**

That's the bug in one sentence. Several handlers listen on `window` or `document` for
every press and keystroke in the app, and each excused rich text but not ordinary
fields. So every new input arrived broken and only worked once someone bolted a
`stopPropagation` shield onto it by hand — `NotesPane`, `JournalNavigationBar` and
`MapPane` all carry one. Nothing reminded you, so it recurred every time.

**The fix inverts that.** `lib/isTextEntry.ts` is one shared test —
`closest('input, textarea, select, [contenteditable="true"]')` — and the global
handlers now excuse text entry themselves. A new field works the moment it is added.

Four handlers were taking focus or eating keystrokes, none of them checking:

- `EdgeGestureDetector.svelte` — mousedown/mousemove/mouseup and touchstart/move/end
  on `window`, mounted permanently. It excused `[contenteditable="true"]`, `.panel`
  and `.verse-text` but no plain field. Its touchmove listener is `{passive:false}`
  and calls `preventDefault()`, which on a phone cancels the tap→focus→keyboard
  sequence outright. All four handlers now test `isTextEntry` first.
- `BibleReader.handleClickOutside` — a document click handler that runs on *every*
  click and calls `dismissSelection()` → `clearHighlights()` →
  `getSelection().removeAllRanges()`. That clears the caret just as the tap that
  focused the field lands. Now returns early for text entry.
- `BibleReader.handleToastGuard` — document `pointerdown` in the **capture** phase, so
  the earliest handler in the app on any press; same `removeAllRanges()` path whenever
  a selection toast happens to be up. That hidden state is what made this feel
  intermittent. Same guard.
- `LexicalEditor.setContent` — `setTimeout(() => editor.focus(), 50)` whose only check
  ran *before* the timeout. Any note or journal load yanked focus 50ms later, which is
  the "I got one or two characters in" symptom. It now re-checks on the way in.

Plus `IndexList`'s type-to-jump, which `preventDefault()`s every bare letter. The
search box shielded itself from it already; it now checks centrally too.

**Why it looked intermittent.** `.index-bar` is `justify-content: space-between`, so
the search bar is pinned to the card's right edge. With a 16px backdrop pad and a
`min(720px, 100%)` card, on a phone the magnifier sits roughly 26–50px from the right
of the screen — inside the detector's 40px lane. On a wide desktop the centred card is
nowhere near an edge. Docked left or right, it is always in the lane.

The existing per-field `stopPropagation` shields in `NotesPane`, `JournalNavigationBar`
and `MapPane` are now belt-and-braces. They were left in place because they're
harmless, but **new fields should not copy them** — that's the cargo cult this fix
exists to end.

#### Original diagnosis

Reported 2026-08-13. Clicking the magnifier in a library index opens the search box,
but it doesn't stay focused long enough to type into.

That box is `library/RefSearchBar.svelte`, used by `library/IndexList.svelte` — the
same component in all three works, which matches the symptom appearing in all three.

**Not yet reproduced from reading the code.** Ruled out so far, so nobody re-treads it:

- Nothing steals focus. The only two `.focus()` calls anywhere near the library are
  RefSearchBar's own, in `expand()` and `clear()`.
- The input isn't being destroyed and recreated. It sits outside any `{#if}`; the
  `{#if searching}` block beside it only swaps the spinner for the clear button, and
  is a sibling, not an ancestor.
- Not the contents list's type-to-jump. That's bound to `.rows`, not to the window,
  and `RefSearchBar.handleKeydown` calls `stopPropagation` precisely so the list
  behind it can't also see the keystrokes.
- Not the modals' Escape handling. They listen on `window`, but the same
  `stopPropagation` stops keystrokes reaching them.

Worth capturing next time it happens, since it would narrow this quickly:

- does the box collapse back to its icon, or stay open but lose the caret?
- does it need a query long enough to run a search (2+ characters), or does it happen
  before typing anything?
- does it happen in a docked window as well as in the centred card?
- does it happen on the very first open, or only after a previous search?

---

### [x] 10. `navigationStore` notifies every subscriber even when nothing changed

**Fixed 2026-08-15.** The check now runs *before* the write rather than inside it.

Returning the same object from `update` never suppressed anything — Svelte's change
test treats any object as changed, identical or not — so the guard did nothing at
all. Since this fires on the reader's scroll debounce, every subscriber was woken
several times a second the whole time the reader was moving, and the same state was
written back to storage each time.

Checked the other stores while in there: nothing else uses this pattern.

#### Original diagnosis

Found 2026-08-13 while tracking down #9. Not user-visible; pure wasted work.

`stores/navigationStore.ts` — `setScrollPosition` tries to suppress a pointless
notification by returning the *same* state object when book and chapter are unchanged:

```
setScrollPosition: (book, chapter) => {
  update(state => {
    if (state.book === book && state.chapter === chapter) return state;
```

That doesn't work. Svelte's `safe_not_equal` treats any object as changed, identical or
not, so **every subscriber is notified anyway**.

`BibleReader` calls this from its `IntersectionObserver` on a 150ms debounce, so while
the reader is scrolling — TTS auto-scroll included — everything subscribed to
`$navigationStore` re-renders roughly seven times a second. `IndexList` alone
re-renders its chapter chip and section head that often whenever the reader moves
behind it, and there are a couple of dozen other subscribers.

Fix direction: either compare before calling `update` and skip the write entirely, or
give the store a custom equality check. Worth confirming the same pattern isn't
repeated in the other stores while in there.

---

## Project

### [ ] 11. The repo still lives under the old name, not the Hexapla org

Open. Not a bug — a move that was deliberately deferred, parked here so it can be
picked up cold.

Paths in this entry are repo-relative, not relative to `apps/pwa-polished/src/`.

The app was renamed ProjectBible → Hexapla on 2026-08-18, but **only the strings a
user can see**. The `hexapla` GitHub org has been created and is empty; the repo is
still `Psalted-Photon/projectbible`, and the local folder is still
`Desktop\ProjectBible`. Both are invisible to users, which is why neither was
urgent.

Deliberately left alone in that rename, and still to be left alone unless someone
writes a migration first: the IndexedDB databases `projectbible` and
`ProjectBible_Packs`, the 17 `projectbible_*` localStorage keys, the
`@projectbible/core` package scope across 47 files, and the
`projectbible-wake-alarm` push tag. Renaming the first two wipes every note,
highlight, journal entry and reading plan and forces a multi-GB pack re-download.
The push tag is a matched pair between `lib/alarm/pushSubscription.ts` and
`supabase/functions/wake-alarm-send/index.ts` — change one without the other and
alarms stop being replaced correctly.

**The clean route is GitHub's own transfer**, at repo Settings → Danger Zone →
Transfer ownership. Releases and their download assets travel with the repo, and
GitHub leaves permanent redirects behind, so the pack manifests already shipped to
installed apps keep downloading throughout. The repo can be renamed in the same
step. Afterwards the local clone needs `git remote set-url origin` pointed at the
new path.

**Then update the 13 baked-in old URLs**, so nothing depends on those redirects
permanently:

- `api/packs/[name].ts:13` — the production pack proxy target
- `scripts/generate-manifest.mjs:27` — `GITHUB_RELEASE_BASE`, which stamps the URL
  into every manifest it writes
- `scripts/ensure-bundled-packs.mjs:11` — clone URL used by the Vercel build
- `scripts/build-net-pack.mjs:301` — printed import URL
- `packs/consolidated/manifest.json` and
  `apps/pwa-polished/public/packs/consolidated/manifest.json` — two copies, both
  with `bsb-audio-pt1` and `-pt2` download URLs
- `RELEASE-INSTRUCTIONS.md` and `docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md`

Regenerating the manifest via `scripts/generate-manifest.mjs` covers the two JSON
copies, but the manifest sha256 has to be re-synced afterward the usual way.

**Gotcha — Vercel.** The project's Git connection points at the old owner, and a
transfer does not carry it over. The Vercel GitHub App has to be authorized on the
`hexapla` org and the project re-linked under Project Settings → Git, or pushes
silently stop triggering deploys. Worth doing immediately after the transfer rather
than discovering it at the next deploy.

**Caveat.** The redirects hold only while nothing occupies the old path. Creating
any new repo at `Psalted-Photon/projectbible` breaks them for every already-shipped
app. Updating the baked-in URLs above is what removes that exposure.

Renaming the local folder is independent and purely cosmetic, but it breaks 29
hardcoded absolute `C:\Users\Marlowe\Desktop\ProjectBible\...` paths scattered
through `scripts/` (mostly the Python and PowerShell data-prep one-offs) plus a
couple of docs. Low value; do it only alongside a sweep of those.
