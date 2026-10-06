<script lang="ts">
  /**
   * A row of tabs that splits a settings panel into sections, the way the
   * share card's controls are split — one section on screen at a time, so a
   * long panel doesn't have to be scrolled past color boxes and sliders that
   * catch the finger meant for scrolling.
   *
   * Scales with Bar size, like every other tab strip in the app.
   */
  export let tabs: { id: string; label: string }[];
  export let value: string;
  export let label: string;
</script>

<div class="st" role="tablist" aria-label={label}>
  {#each tabs as t}
    <button
      type="button"
      class="st-tab"
      class:active={value === t.id}
      role="tab"
      aria-selected={value === t.id}
      on:click={() => (value = t.id)}
    >{t.label}</button>
  {/each}
</div>

<style>
  /* The dividing line is an inset shadow, not a border, so the active tab's
     underline paints over it without a negative margin the scroller would clip. */
  .st {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    box-shadow: inset 0 -1px 0 #333;
  }

  .st-tab {
    flex: 1 0 auto;
    margin: 0;
    padding: calc(8px * var(--bar-scale, 1)) calc(10px * var(--bar-scale, 1));
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: #888;
    font-family: inherit;
    font-size: calc(0.8rem * var(--bar-scale, 1));
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .st-tab:hover { color: #ccc; }
  .st-tab.active {
    color: #f0f0f0;
    border-bottom-color: #667eea;
  }
  .st-tab:focus-visible {
    outline: 2px solid #667eea;
    outline-offset: -2px;
  }
</style>
