<script lang="ts">
  import type { WorksResolution } from "../adapters/lexicon-lookup";
  import { worksInWindow, type WorkKey } from "../lib/openWork";

  /**
   * The four reference works, across the top of every lookup card.
   *
   * These replaced a row of "bridge pills" that changed depending on which card
   * you were in — the encyclopedia offered Topical and Dictionary, and stepping
   * into Topical changed the set — so there was never a fixed thing to aim at.
   * All four are always drawn, always in this order, and greyed when that work
   * has nothing for the subject. Equal widths, so a tab is in the same place
   * every time regardless of how long the labels are.
   *
   * Availability comes from resolveWorks, which returns the ids rather than
   * booleans — so a tab that is lit is one that will definitely open something.
   */
  export let works: WorksResolution | null = null;
  export let current: WorkKey;
  /** True while the A–Z index is showing, where tabs switch index rather than
   *  subject — there is no subject to cross-reference. */
  export let onIndex = false;
  /** Set when this card is a docked window, which not every work can be. */
  export let inWindow = false;
  export let onSelect: (work: WorkKey) => void;

  const TABS: { key: WorkKey; label: string }[] = [
    { key: "encyclopedia", label: "Encyclopedia" },
    { key: "topical", label: "Topical" },
    { key: "dictionary", label: "Dictionary" },
    { key: "people", label: "People" },
  ];

  function isAvailable(key: WorkKey, w: WorksResolution | null, idx: boolean, win: boolean): boolean {
    // The one you're on is always live: you are demonstrably looking at it,
    // whether or not the resolver has answered yet.
    if (key === current) return true;
    // A pinned window can only hold works that have a window form.
    if (win && !worksInWindow(key)) return false;
    // Browsing an index, the tabs move you between indexes. Every work has one
    // except the dictionary, which has no A–Z list to show.
    if (idx) return key !== "dictionary";
    switch (key) {
      case "dictionary":
        return !!w?.dict;
      case "topical":
        return !!w?.topic;
      case "encyclopedia":
        return !!w?.entry;
      case "people":
        return !!w?.person;
    }
  }

  /** Why a tab is greyed, so hovering it says something useful. */
  function reason(key: WorkKey, win: boolean): string {
    if (win && !worksInWindow(key)) return `${label(key)} can't be pinned into a window yet`;
    return `Nothing in ${label(key)} for this`;
  }

  function label(key: WorkKey): string {
    return TABS.find((t) => t.key === key)?.label ?? key;
  }

  function pick(key: WorkKey) {
    if (key === current || !isAvailable(key, works, onIndex, inWindow)) return;
    onSelect(key);
  }
</script>

<div class="work-tabs" role="tablist" aria-label="Reference works">
  {#each TABS as tab (tab.key)}
    {@const live = isAvailable(tab.key, works, onIndex, inWindow)}
    <button
      class="work-tab"
      class:active={tab.key === current}
      disabled={!live}
      role="tab"
      aria-selected={tab.key === current}
      title={live ? tab.label : reason(tab.key, inWindow)}
      on:click={() => pick(tab.key)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  /* Deliberately not called .tabs: IsbeContent and NavesContent style their
     section tabs as an unqualified `.tabs button`, which would capture this. */
  .work-tabs {
    display: flex;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--border-color, #333);
  }
  .work-tab {
    /* Equal widths so each work keeps the same spot in every card. */
    flex: 1 1 0;
    min-width: 0;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted, #999);
    font-family: inherit;
    font-size: 12px;
    padding: 9px 6px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .work-tab:hover:not(:disabled):not(.active) {
    color: var(--text-color, #fff);
    background: rgba(255, 255, 255, 0.04);
  }
  .work-tab.active {
    color: var(--color-primary, #4a90e2);
    border-bottom-color: var(--color-primary, #4a90e2);
    background: rgba(74, 144, 226, 0.08);
  }
  /* Greyed rather than hidden — the point is that the row never changes shape,
     so you can see at a glance what this subject does and doesn't have. */
  .work-tab:disabled {
    opacity: 0.3;
    cursor: default;
  }
</style>
