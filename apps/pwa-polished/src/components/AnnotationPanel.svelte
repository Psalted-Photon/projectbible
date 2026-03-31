<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { CommentaryEntry } from "../adapters/CommentaryStore";
  import type { TskEntry } from "../adapters/TskReferenceStore";
  import { getAuthorColor, getAuthorInitials } from "../lib/annotationConfig";
  import { TSK_COLOR } from "../lib/annotationConfig";

  export let open = false;
  export let book = "";
  export let chapter = 0;
  export let verse = 0;
  export let tskEntries: TskEntry[] = [];
  export let commentaryEntries: CommentaryEntry[] = [];
  /** Which tab to show on open: 'references' | 'commentary' */
  export let initialTab: "references" | "commentary" = "references";

  let activeTab: "references" | "commentary" = initialTab;

  $: if (open) activeTab = initialTab;

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch("close");
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  // Group TSK entries by keyword
  $: tskByKeyword = groupTskByKeyword(tskEntries);

  function groupTskByKeyword(entries: TskEntry[]): Array<{ keyword: string | null; refs: string[] }> {
    const map = new Map<string, string[]>();
    const order: Array<string | null> = [];
    for (const entry of entries) {
      const key = entry.keyword ?? "";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(entry.keyword);
      }
      map.get(key)!.push(...entry.references);
    }
    return order.map((k) => ({ keyword: k, refs: map.get(k ?? "") ?? [] }));
  }

  // Group commentary entries by author
  $: commentaryByAuthor = groupCommentaryByAuthor(commentaryEntries);

  function groupCommentaryByAuthor(
    entries: CommentaryEntry[]
  ): Array<{ author: string; entries: CommentaryEntry[] }> {
    const map = new Map<string, CommentaryEntry[]>();
    for (const entry of entries) {
      if (!map.has(entry.author)) map.set(entry.author, []);
      map.get(entry.author)!.push(entry);
    }
    return Array.from(map.entries()).map(([author, entries]) => ({ author, entries }));
  }

  function verseLabel() {
    return verse ? `${book} ${chapter}:${verse}` : `${book} ${chapter}`;
  }
</script>

<!-- Backdrop (click-away to close) -->
{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="panel-backdrop" on:click={handleBackdropClick}></div>
{/if}

<div class="annotation-panel" class:open>
  <!-- Header -->
  <div class="panel-header">
    <div class="panel-tabs">
      <button
        class="tab-btn"
        class:active={activeTab === "references"}
        on:click={() => (activeTab = "references")}
      >
        ◆ References
        {#if tskEntries.length > 0}
          <span class="badge" style="background:{TSK_COLOR}">{tskEntries.length}</span>
        {/if}
      </button>
      <button
        class="tab-btn"
        class:active={activeTab === "commentary"}
        on:click={() => (activeTab = "commentary")}
      >
        ● Commentaries
        {#if commentaryEntries.length > 0}
          <span class="badge" style="background:#666">{commentaryEntries.length}</span>
        {/if}
      </button>
    </div>
    <div class="panel-title">{verseLabel()}</div>
    <button class="close-btn" on:click={close} aria-label="Close">✕</button>
  </div>

  <!-- Content -->
  <div class="panel-body">
    {#if activeTab === "references"}
      {#if tskEntries.length === 0}
        <p class="empty-msg">No TSK cross-references for this verse.<br/><span class="hint">Import the <em>tsk-references.sqlite</em> pack to enable them.</span></p>
      {:else}
        {#each tskByKeyword as group}
          <div class="ref-group">
            {#if group.keyword}
              <div class="ref-keyword">
                <span class="diamond" style="color:{TSK_COLOR}">◆</span>
                <strong>{group.keyword}</strong>
              </div>
            {/if}
            <ul class="ref-list">
              {#each group.refs as ref}
                <li class="ref-item">{ref}</li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    {/if}

    {#if activeTab === "commentary"}
      {#if commentaryEntries.length === 0}
        <p class="empty-msg">No commentary for this verse.<br/><span class="hint">Import the <em>commentaries.sqlite</em> pack to enable them.</span></p>
      {:else}
        {#each commentaryByAuthor as group}
          <div class="commentary-group">
            <div
              class="commentary-author-header"
              style="border-left: 4px solid {getAuthorColor(group.author)}"
            >
              <span
                class="author-badge"
                style="background:{getAuthorColor(group.author)}"
                title={group.author}
              >{getAuthorInitials(group.author)}</span>
              <span class="author-name">{group.author}</span>
            </div>
            {#each group.entries as entry}
              {#if entry.title && entry.title !== group.author}
                <div class="entry-title">{entry.title}</div>
              {/if}
              <div class="entry-text">{@html entry.text}</div>
            {/each}
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 299;
  }

  .annotation-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 52vh;
    min-height: 280px;
    background: #1e1e1e;
    color: #e0e0e0;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.5);
    z-index: 300;
    display: flex;
    flex-direction: column;
    transform: translateY(100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: transform;
  }

  .annotation-panel.open {
    transform: translateY(0);
  }

  /* ——— Header ——— */
  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px 0;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .panel-tabs {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #888;
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .tab-btn.active {
    color: #e0e0e0;
    border-bottom-color: #667eea;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    padding: 0 4px;
  }

  .panel-title {
    font-size: 12px;
    color: #777;
    white-space: nowrap;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: #e0e0e0;
    background: #333;
  }

  /* ——— Body ——— */
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px 24px;
    overscroll-behavior: contain;
  }

  /* ——— References ——— */
  .ref-group {
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #2a2a2a;
  }

  .ref-group:last-child {
    border-bottom: none;
  }

  .ref-keyword {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: #ccc;
  }

  .diamond {
    font-size: 10px;
  }

  .ref-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }

  .ref-item {
    font-size: 12px;
    color: #8ab4f8;
    cursor: default;
  }

  /* ——— Commentary ——— */
  .commentary-group {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid #2a2a2a;
  }

  .commentary-group:last-child {
    border-bottom: none;
  }

  .commentary-author-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding-left: 8px;
  }

  .author-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }

  .author-name {
    font-size: 13px;
    font-weight: 600;
    color: #ccc;
  }

  .entry-title {
    font-size: 12px;
    font-weight: 600;
    color: #888;
    margin-bottom: 4px;
    padding-left: 8px;
  }

  .entry-text {
    font-size: 13px;
    line-height: 1.6;
    color: #d0d0d0;
    padding-left: 8px;
    margin-bottom: 8px;
  }

  /* ——— Empty states ——— */
  .empty-msg {
    color: #666;
    font-size: 13px;
    margin-top: 20px;
    text-align: center;
    line-height: 1.8;
  }

  .hint {
    font-size: 11px;
    color: #555;
  }
</style>
