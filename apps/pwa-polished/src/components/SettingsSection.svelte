<script lang="ts">
  /**
   * A collapsible group in the Settings pane.
   *
   * Closed, it is a single row: icon, title, and a summary of what is set
   * inside — so the whole pane reads as a five-line contents page. Open, it
   * reveals its slot. Sections toggle independently; nothing closes anything
   * else.
   *
   * `sub` renders the quieter second-level variant (Interlinear inside
   * Reader), matching the two-level pattern already used in IsbeContent.
   */
  import { CaretRight } from "phosphor-svelte";

  export let title: string;
  /** Short live description of the current values, shown when closed. */
  export let summary = "";
  export let open = false;
  export let sub = false;
</script>

<div class="sec" class:sub>
  <button
    class="sec-head"
    class:open
    aria-expanded={open}
    on:click={() => (open = !open)}
  >
    <span class="sec-caret"><CaretRight size={sub ? 10 : 12} weight="bold" /></span>
    {#if $$slots.icon}
      <span class="sec-icon"><slot name="icon" /></span>
    {/if}
    <span class="sec-title">{title}</span>
    {#if summary && !open}
      <span class="sec-summary">{summary}</span>
    {/if}
  </button>

  {#if open}
    <div class="sec-body">
      <slot />
    </div>
  {/if}
</div>

<style>
  .sec {
    border-bottom: 1px solid #333;
  }

  .sec-head {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 0.9rem 0.25rem;
    background: none;
    border: none;
    color: #f0f0f0;
    font-family: inherit;
    font-size: 1rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: color 0.15s;
  }

  .sec-head:hover {
    color: #8b9cf5;
  }

  .sec-caret {
    display: inline-flex;
    flex-shrink: 0;
    color: #888;
    transition: transform 0.18s ease, color 0.15s;
  }

  .sec-head.open .sec-caret {
    transform: rotate(90deg);
    color: #667eea;
  }

  .sec-head:hover .sec-caret {
    color: #667eea;
  }

  .sec-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: #667eea;
  }

  .sec-title {
    flex-shrink: 0;
  }

  /* Pushed right, and the first thing to give up room on a narrow pane. */
  .sec-summary {
    flex: 1;
    min-width: 0;
    text-align: right;
    color: #888;
    font-size: 0.8rem;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sec-body {
    padding: 0.35rem 0 1.25rem 0.25rem;
  }

  /* ── Second level ── */
  .sec.sub {
    border-bottom: none;
    border-left: 2px solid #333;
    padding-left: 0.75rem;
    margin-top: 0.5rem;
  }

  .sec.sub .sec-head {
    padding: 0.5rem 0;
    font-size: 0.95rem;
    font-weight: 500;
    color: #ccc;
  }

  .sec.sub .sec-body {
    padding: 0.25rem 0 0.5rem 0;
  }

  @media (max-width: 480px) {
    .sec-head {
      padding: 0.75rem 0.25rem;
      font-size: 0.9rem;
    }

    .sec-summary {
      font-size: 0.72rem;
    }
  }
</style>
