<script lang="ts">
  /**
   * The modal behind the Harmonies tile: choose what to lay side by side.
   *
   * Three ways in, on three tabs, because they answer different questions.
   * "Sets" answers "show me these books together" and opens at a sensible
   * place. The "Harmony" contents answers "show me this event" — Robertson's
   * 185 titled sections, in his order, under his own part titles — and opens
   * exactly there with only the Gospels that carry it. "Translations" answers
   * "show me this passage in several renderings", and opens on the passage the
   * reader is already in, because a comparison is something you reach for about
   * the verse in front of you rather than somewhere you navigate to.
   *
   * Nothing is created until the user picks. The modal dispatches the choice and
   * the view does the rest, so backing out of here costs nothing.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import {
    HARMONY_PARTS,
    PARALLEL_SETS,
    panesForSection,
    type HarmonyEntry,
    type ParallelSet,
  } from '../lib/parallelSets';
  import { navigationStore, availableTranslations } from '../stores/navigationStore';
  import {
    BIBLE_BOOKS,
    getTranslationScope,
    translationLabel,
    translationSortIndex,
  } from '../lib/bibleData';

  /** The ceiling everywhere, phone included — the view's grid tops out at four. */
  const MAX_PANES = 4;

  const dispatch = createEventDispatcher<{
    close: void;
    choose: {
      panes: Array<{ book: string; chapter: number }>;
      label: string;
      /** Set only from the contents, so the view can open at the section's own verse. */
      sectionId?: number;
      /**
       * One per pane, in the same order, when comparing translations. Absent
       * for a harmony, where every pane takes the reader's current translation.
       */
      translations?: string[];
    };
  }>();

  let tab: 'sets' | 'harmony' | 'translations' = 'sets';

  /**
   * Which parts are open. All shut to begin with — 185 sections is a long list
   * to land in, and the fourteen part titles alone are a readable contents page.
   */
  let openParts: Record<string, boolean> = {};

  function chooseSet(set: ParallelSet) {
    dispatch('choose', {
      // Only the master opens at the set's chapter. The followers open at
      // chapter 1 and are moved by the engine on the master's first tick, which
      // is the same path they take for every later move — opening them at a
      // guessed chapter would be a second way to position a follower that could
      // disagree with the first.
      panes: set.books.map((book) => ({
        book,
        chapter: book === set.start.book ? set.start.chapter : 1,
      })),
      label: set.label,
    });
  }

  // ── Translations ──────────────────────────────────────────────────────────

  /**
   * Where the comparison opens: wherever the reader already is.
   *
   * Captured once on mount rather than followed reactively. The user is about
   * to leave this modal for a fullscreen view, and the main reader cannot move
   * while the modal is over it — but reading it live would mean a comparison
   * that silently retargets if anything else nudged the store between opening
   * the tab and pressing the button.
   */
  const openAt = {
    book: $navigationStore.book,
    chapter: $navigationStore.chapter,
  };

  /**
   * Which translations can show the passage you are on.
   *
   * Filtered by testament, because the scopes are real: the Greek New
   * Testaments hold no Genesis and the Hebrew and LXX hold no Romans. Offering
   * one anyway would open a pane that could never load its chapter, which the
   * engine would eventually dim as "not loaded" — a correct-looking answer to a
   * question the picker should not have asked.
   *
   * Sorted by the app's own translation order so the list reads the same here
   * as it does in the navbar's chip.
   */
  $: currentTestament =
    BIBLE_BOOKS.find((b) => b.name === openAt.book)?.testament ?? 'NT';

  $: offered = $availableTranslations
    .filter((id) => {
      const scope = getTranslationScope(id);
      if (scope === 'full') return true;
      return currentTestament === 'OT' ? scope === 'ot-only' : scope === 'nt-only';
    })
    .slice()
    .sort((a, b) => translationSortIndex(a) - translationSortIndex(b));

  /**
   * The chosen translations, in the order they were tapped.
   *
   * Tap order rather than list order, because the first one is the master — the
   * pane that drives the rest — and the one you pick first is the one you mean
   * to read from. The list itself stays in the app's canonical order so the
   * positions do not move under the finger.
   */
  let picked: string[] = [];

  /**
   * Seeded with what you are reading, so the common case is one more tap.
   *
   * Only when it is actually on offer: a reader sitting in Genesis with a Greek
   * New Testament selected would otherwise seed a translation the filter has
   * just excluded.
   *
   * Once, guarded by a flag rather than by `picked.length === 0`. The list is
   * reactive, so an unguarded version would re-seed the moment the user
   * deselected their last choice to start again — the tap would appear to do
   * nothing, because the selection would come straight back.
   */
  let seeded = false;
  $: if (!seeded && offered.length > 0) {
    seeded = true;
    if (offered.includes($navigationStore.translation)) {
      picked = [$navigationStore.translation];
    }
  }

  function togglePick(id: string) {
    if (picked.includes(id)) {
      picked = picked.filter((p) => p !== id);
      return;
    }
    // Silently ignored at the ceiling rather than disabled: the buttons stay
    // tappable so a fifth tap can still deselect, and the counter below already
    // says how many are in.
    if (picked.length >= MAX_PANES) return;
    picked = [...picked, id];
  }

  /**
   * Open the comparison. Every pane is the same book and chapter — unlike a
   * harmony, where only the master opens where it was asked for, because here
   * there is nothing to work out: the followers belong at the same reference by
   * definition, and opening them there means they are already right before the
   * first tick rather than sliding into place after it.
   */
  function chooseTranslations() {
    if (picked.length < 2) return;
    dispatch('choose', {
      panes: picked.map(() => ({ book: openAt.book, chapter: openAt.chapter })),
      label: `${openAt.book} ${openAt.chapter}`,
      translations: picked,
    });
  }

  function chooseSection(entry: HarmonyEntry) {
    // The id travels with the panes because the chapter alone is not where the
    // section starts — §110 is Luke 15:11, and opening Luke 15 leaves the reader
    // ten verses above the parable they asked for. The view aims at the verse
    // once its readers exist.
    dispatch('choose', {
      panes: panesForSection(entry.group),
      label: entry.title,
      sectionId: entry.group.id,
    });
  }

  // Captured, so Escape closes the picker rather than reaching the view behind
  // it — which would close the whole harmony instead of this modal.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dispatch('close');
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('hp-backdrop')) dispatch('close');
  }

  onMount(() => window.addEventListener('keydown', handleKeydown, true));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown, true));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="hp-backdrop" on:click={handleBackdropClick}>
  <div class="hp-modal" role="dialog" aria-modal="true" aria-label="Open a harmony">

    <div class="hp-header">
      <span class="hp-title">Harmonies</span>
      <button class="hp-close" on:click={() => dispatch('close')} aria-label="Close">✕</button>
    </div>

    <div class="hp-tabs">
      <button class="hp-tab" class:active={tab === 'sets'} on:click={() => (tab = 'sets')}>Sets</button>
      <button class="hp-tab" class:active={tab === 'harmony'} on:click={() => (tab = 'harmony')}>The Harmony</button>
      <button class="hp-tab" class:active={tab === 'translations'} on:click={() => (tab = 'translations')}>Translations</button>
    </div>

    <div class="hp-body">
      {#if tab === 'translations'}
        <p class="hp-hint">
          The same passage in two to four translations, lined up verse by verse.
          Opens at <strong>{openAt.book} {openAt.chapter}</strong>, where you are now.
        </p>

        {#if offered.length < 2}
          <!-- One installed translation is not a comparison. Said plainly and
               pointed at the fix, rather than showing a list that cannot be
               used — the Packs screen is where more come from. -->
          <p class="hp-empty">
            You have one translation that covers {openAt.book}. Install another from
            Packs to compare them side by side.
          </p>
        {:else}
          {#each offered as id (id)}
            {@const order = picked.indexOf(id)}
            <button
              class="hp-trans"
              class:picked={order >= 0}
              on:click={() => togglePick(id)}
              aria-pressed={order >= 0}
            >
              <!-- The number, not a tick: order is meaningful here. 1 is the
                   master and the rest follow it down the screen, so the badge
                   is also a preview of the layout. -->
              <span class="hp-order" class:on={order >= 0}>{order >= 0 ? order + 1 : ''}</span>
              <span class="hp-trans-label">{translationLabel(id)}</span>
            </button>
          {/each}

          <div class="hp-actions">
            <span class="hp-count">
              {#if picked.length < 2}
                Pick at least two
              {:else}
                {picked.length} of {MAX_PANES}
              {/if}
            </span>
            <button
              class="hp-open"
              on:click={chooseTranslations}
              disabled={picked.length < 2}
            >Compare</button>
          </div>
        {/if}
      {:else if tab === 'sets'}
        <p class="hp-hint">Books that tell the same events, opened together.</p>
        {#each PARALLEL_SETS as set (set.id)}
          <button class="hp-set" on:click={() => chooseSet(set)}>
            <span class="hp-set-label">{set.label}</span>
            <span class="hp-set-blurb">{set.blurb}</span>
            <span class="hp-books">
              {#each set.books as book (book)}<span class="hp-book">{book}</span>{/each}
            </span>
          </button>
        {/each}
      {:else}
        <p class="hp-hint">Robertson &amp; Broadus, <em>A Harmony of the Gospels</em> — 185 sections in order.</p>
        {#each HARMONY_PARTS as part (part.title)}
          <button
            class="hp-part"
            on:click={() => (openParts = { ...openParts, [part.title]: !openParts[part.title] })}
            aria-expanded={!!openParts[part.title]}
          >
            <span class="hp-caret" class:open={openParts[part.title]}>›</span>
            <span class="hp-part-title">{part.title}</span>
            <span class="hp-part-count">{part.entries.length}</span>
          </button>
          {#if openParts[part.title]}
            {#each part.entries as entry (entry.group.id)}
              <button class="hp-entry" on:click={() => chooseSection(entry)}>
                <span class="hp-section">§{entry.section}</span>
                <span class="hp-entry-title">{entry.title}</span>
                <!-- The chips are the "only in Luke" marking: a section showing
                     one chip is material that one Gospel alone carries. -->
                <span class="hp-books">
                  {#each entry.books as book (book)}<span class="hp-book">{book.slice(0, 4)}</span>{/each}
                </span>
              </button>
            {/each}
          {/if}
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .hp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9200;
    padding: 16px;
    box-sizing: border-box;
  }

  .hp-modal {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 460px;
    max-height: min(80vh, 640px);
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }

  .hp-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .hp-title {
    font-size: 15px;
    font-weight: 600;
    color: #e0e0e0;
    flex: 1;
  }

  .hp-close {
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
  }

  .hp-close:hover {
    color: #e0e0e0;
  }

  .hp-tabs {
    display: flex;
    gap: 4px;
    padding: 10px 12px 0;
    flex-shrink: 0;
  }

  .hp-tab {
    flex: 1;
    padding: 8px 10px;
    background: #232323;
    border: 1px solid #3a3a3a;
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    color: #999;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .hp-tab.active {
    background: #2b2b2b;
    color: #e0e0e0;
    border-color: #4a7c9e;
  }

  .hp-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    -webkit-overflow-scrolling: touch;
  }

  .hp-hint {
    margin: 0 0 4px;
    color: #888;
    font-size: 11px;
    line-height: 1.4;
  }

  /* The three tabs no longer fit at the old flex:1 on a narrow phone — "The
     Harmony" alone is wider than a third of a 320px modal. They share the row
     evenly and shrink their text instead of wrapping to two lines. */
  .hp-tab {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hp-empty {
    margin: 4px 0;
    padding: 12px;
    background: #242424;
    border: 1px solid #383838;
    border-radius: 9px;
    color: #999;
    font-size: 12px;
    line-height: 1.45;
  }

  .hp-trans {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    background: #262626;
    border: 1px solid #383838;
    border-radius: 9px;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .hp-trans:hover {
    background: #2e2e2e;
    border-color: #4a7c9e;
  }

  .hp-trans.picked {
    border-color: #4a9ec9;
    background: #23313a;
  }

  /* Always in the layout, empty when unpicked, so the labels do not shift
     sideways as you tap down the list. */
  .hp-order {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 1px solid #444;
    font-size: 11px;
    font-weight: 600;
    color: #888;
  }

  .hp-order.on {
    background: #4a9ec9;
    border-color: #4a9ec9;
    color: #10202a;
  }

  .hp-trans-label {
    flex: 1;
  }

  /* Sticks to the bottom of the scrolling body so Compare stays reachable with
     four translations listed above it. */
  .hp-actions {
    position: sticky;
    bottom: -12px;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
    padding: 10px 0;
    background: #1e1e1e;
  }

  .hp-count {
    flex: 1;
    font-size: 11px;
    color: #888;
  }

  .hp-open {
    padding: 8px 18px;
    background: #4a9ec9;
    border: none;
    border-radius: 8px;
    color: #10202a;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .hp-open:disabled {
    background: #333;
    color: #777;
    cursor: default;
  }

  .hp-set,
  .hp-entry,
  .hp-part {
    display: flex;
    background: #262626;
    border: 1px solid #383838;
    border-radius: 9px;
    color: #e0e0e0;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .hp-set:hover,
  .hp-entry:hover,
  .hp-part:hover {
    background: #2e2e2e;
    border-color: #4a7c9e;
  }

  .hp-set {
    flex-direction: column;
    gap: 4px;
    padding: 11px 12px;
  }

  .hp-set-label {
    font-size: 14px;
    font-weight: 600;
  }

  .hp-set-blurb {
    font-size: 11px;
    color: #999;
    line-height: 1.35;
  }

  .hp-books {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }

  .hp-book {
    padding: 2px 6px;
    background: #333;
    border-radius: 4px;
    font-size: 10px;
    color: #bbb;
    white-space: nowrap;
  }

  /* Parts are the contents page; sections indent under them so a long open part
     still reads as belonging to its heading while you scroll past it. */
  .hp-part {
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: #222;
    font-size: 12px;
    font-weight: 600;
    margin-top: 4px;
  }

  .hp-caret {
    display: inline-block;
    color: #777;
    transition: transform 0.15s;
    font-size: 14px;
    line-height: 1;
  }

  .hp-caret.open {
    transform: rotate(90deg);
  }

  .hp-part-title {
    flex: 1;
  }

  .hp-part-count {
    color: #777;
    font-weight: 400;
    font-size: 11px;
  }

  .hp-entry {
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin-left: 14px;
    background: #242424;
    font-size: 12px;
  }

  .hp-section {
    color: #4a9ec9;
    font-size: 11px;
    min-width: 34px;
    flex-shrink: 0;
  }

  .hp-entry-title {
    flex: 1;
    line-height: 1.3;
  }

  .hp-entry .hp-books {
    margin-top: 0;
    flex-shrink: 0;
    flex-wrap: nowrap;
  }
</style>
