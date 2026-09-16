<script lang="ts" context="module">
  /**
   * A badge on a row: two letters and a colour, drawn by AuthorPill. The list
   * is handed one already worked out — whose badge it is, and where the colour
   * came from, is the caller's business.
   */
  export interface ListPill {
    color: string;
    initials: string;
    title: string;
  }

  /** One page as a row. Whoever supplies it has already worked out the wording. */
  export interface ListPage {
    id: string;
    /** The heading — a title, or the first line where there isn't one. */
    label: string;
    /** The line underneath: a preview, a date, an author. */
    sub: string;
    pinned?: boolean;
    /** Marks a page nobody but its author may rewrite. */
    closed?: boolean;
    /** Whoever wrote it, as their badge. Local pages are all yours, so none. */
    pill?: ListPill;
    /**
     * Overrides `canDeletePage` for this row alone. Local notebooks are all
     * yours so the list-wide flag settles it; in a shared notebook the answer
     * changes page by page — your own pages, plus anybody's if you own the
     * notebook.
     */
    canDelete?: boolean;
  }

  /** One notebook, with its pages already loaded. */
  export interface ListNotebook {
    id: string;
    name: string;
    pages: ListPage[];
    /** A quiet second line on the notebook row — "Group · 4 people" and such. */
    meta?: string;
    /** Your own badge in this notebook, which is also how the picker is found. */
    pill?: ListPill;
    /**
     * Overrides `canAddPage` for this notebook alone. You can be an admin of
     * one shared notebook and a reader of the next, so the list-wide flag
     * cannot answer for both.
     */
    canAddPage?: boolean;
  }
</script>

<script lang="ts">
  /**
   * The notebook → pages list, with its rows.
   *
   * Pulled out of NotesPane so Local and Shared are the same list rather than
   * two that drift apart. What differs between them is not the layout but what
   * you are allowed to do, so everything optional is a capability flag: a
   * notebook you are only reading simply gets none of them, and the row draws
   * itself accordingly instead of needing a second implementation.
   *
   * Transient row state — which row is being renamed, which menu is open, which
   * delete is waiting to be confirmed — lives here rather than in the parent.
   * It is nobody else's business, and keeping it here is what stopped this
   * extraction from just moving the same clutter somewhere else.
   */
  import { createEventDispatcher } from 'svelte';
  import { CaretDown, CaretRight, Trash, PushPin, Lock } from 'phosphor-svelte';
  import AuthorPill from './AuthorPill.svelte';

  export let notebooks: ListNotebook[] = [];
  /** Which rows are open. Owned by the parent so it survives a panel reload. */
  export let expanded: Set<string>;
  /**
   * Namespaces the open/closed keys. Local and Shared can both be on screen
   * across two panels, and a shared notebook that happened to share an id with
   * a local one would otherwise open and close it too.
   */
  export let keyPrefix = 'nb';
  /** The line and focus colour. Local is indigo; Shared gets its own. */
  export let accent = '#667eea';
  /** Page titles. Distinct from the accent so a row still reads as a link. */
  export let pageAccent = '#60a5fa';

  /**
   * The list-wide answers. A notebook or a page may override its own with the
   * fields above; these are what applies when it doesn't.
   */
  export let canAddPage = false;
  export let canRenameNotebook = false;
  export let canDeleteNotebook = false;
  export let canDeletePage = false;
  /** Hand this notebook's join code out. Shared notebooks only. */
  export let canInvite = false;
  /**
   * Offer the badge picker. Shared notebooks only, and only where the row
   * carries a badge to change — a notebook you are not a member of has none.
   */
  export let canEditBadge = false;

  export let emptyPagesText = 'No pages yet.';
  /**
   * What taking a page away is called. Deleting a local page destroys it;
   * taking a shared page out of a notebook is a different act and saying
   * "Delete" for both would misdescribe one of them.
   */
  export let pageDeleteWord = 'Delete';

  const dispatch = createEventDispatcher<{
    toggle: string;
    openPage: { notebookId: string; pageId: string };
    newPage: string;
    rename: { id: string; name: string };
    deleteNotebook: string;
    deletePage: { notebookId: string; pageId: string };
    invite: string;
    editBadge: string;
  }>();

  let renamingId: string | null = null;
  let renameValue = '';
  let openMenuId: string | null = null;
  let confirmDeleteNotebookId: string | null = null;
  let confirmDeletePageId: string | null = null;

  $: hasRowMenu = canRenameNotebook || canDeleteNotebook || canInvite || canEditBadge;

  function keyFor(id: string): string {
    return `${keyPrefix}::${id}`;
  }

  function startRename(notebook: ListNotebook) {
    openMenuId = null;
    renamingId = notebook.id;
    renameValue = notebook.name;
  }

  function commitRename() {
    const id = renamingId;
    const name = renameValue.trim();
    renamingId = null;
    if (!id || !name) return;
    dispatch('rename', { id, name });
  }

  function confirmDeleteNotebook(id: string) {
    confirmDeleteNotebookId = null;
    openMenuId = null;
    dispatch('deleteNotebook', id);
  }

  function confirmDeletePage(notebookId: string, pageId: string) {
    confirmDeletePageId = null;
    dispatch('deletePage', { notebookId, pageId });
  }

  function pageLabel(page: ListPage): string {
    return page.label || 'Untitled';
  }

  /**
   * Focus a field the moment it appears. Must be synchronous: mobile browsers
   * only raise the keyboard for a focus() that happens inside the tap that
   * caused it, so deferring this gets a caret with no keyboard behind it.
   */
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  /**
   * EdgeGestureDetector watches mousedown and touchstart on the whole window to
   * spot edge swipes, and only excuses rich-text areas — a plain input loses
   * focus to it mid-tap. Every input in the app that works stops these first.
   */
  function guardPointer(e: Event) {
    e.stopPropagation();
  }
</script>

<div class="nb-list" style="--accent:{accent}; --page-accent:{pageAccent};">
  {#each notebooks as notebook (notebook.id)}
    {@const key = keyFor(notebook.id)}
    <div class="nb">
      <div class="nb-row">
        {#if renamingId === notebook.id}
          <!-- The field REPLACES the row button. Nesting an input inside a
               button is invalid and the browser yanks focus back to the
               button, which is what ate the caret. -->
          <input
            class="nb-rename"
            bind:value={renameValue}
            use:focusOnMount
            on:mousedown={guardPointer}
            on:touchstart={guardPointer}
            on:click={guardPointer}
            on:blur={commitRename}
            on:keydown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') renamingId = null;
            }}
          />
        {:else}
          <button class="nb-header" on:click={() => dispatch('toggle', key)}>
            <span class="nb-caret">
              {#if expanded.has(key)}
                <CaretDown size={11} weight="bold" />
              {:else}
                <CaretRight size={11} weight="bold" />
              {/if}
            </span>
            {#if notebook.pill}
              <!-- Your own badge in this notebook, on the row that opens it.
                   It is also the only place it is visible before you have
                   written anything, which is what makes the picker in the ⋯
                   menu findable rather than a setting nobody meets. -->
              <AuthorPill
                color={notebook.pill.color}
                initials={notebook.pill.initials}
                title={notebook.pill.title}
              />
            {/if}
            <span class="nb-text">
              <span class="nb-line">
                <span class="nb-label">{notebook.name}</span>
                <span class="nb-count">({notebook.pages.length})</span>
              </span>
              {#if notebook.meta}
                <span class="nb-meta">{notebook.meta}</span>
              {/if}
            </span>
          </button>

          {#if notebook.canAddPage ?? canAddPage}
            <button
              class="row-btn"
              title="New page"
              aria-label="New page"
              on:click={() => dispatch('newPage', notebook.id)}>+</button
            >
          {/if}
          {#if hasRowMenu}
            <button
              class="row-btn"
              title="Notebook options"
              aria-label="Notebook options"
              on:click={() => (openMenuId = openMenuId === notebook.id ? null : notebook.id)}
              >⋯</button
            >
          {/if}
        {/if}
      </div>

      {#if openMenuId === notebook.id}
        <div class="row-menu">
          {#if canInvite}
            <button
              on:click={() => {
                openMenuId = null;
                dispatch('invite', notebook.id);
              }}>Invite people</button
            >
          {/if}
          {#if canEditBadge && notebook.pill}
            <button
              on:click={() => {
                openMenuId = null;
                dispatch('editBadge', notebook.id);
              }}>Your badge</button
            >
          {/if}
          {#if canRenameNotebook}
            <button on:click={() => startRename(notebook)}>Rename</button>
          {/if}
          {#if canDeleteNotebook}
            <button
              class="danger"
              on:click={() => {
                openMenuId = null;
                confirmDeleteNotebookId = notebook.id;
              }}>Delete notebook</button
            >
          {/if}
        </div>
      {/if}

      {#if confirmDeleteNotebookId === notebook.id}
        <div class="confirm-bar">
          <span>
            Delete “{notebook.name}”{notebook.pages.length
              ? ` and its ${notebook.pages.length} page${notebook.pages.length === 1 ? '' : 's'}`
              : ''}?
          </span>
          <button class="confirm-yes" on:click={() => confirmDeleteNotebook(notebook.id)}>
            Delete
          </button>
          <button class="confirm-no" on:click={() => (confirmDeleteNotebookId = null)}>
            Cancel
          </button>
        </div>
      {/if}

      {#if expanded.has(key)}
        <div class="nb-pages">
          {#if notebook.pages.length === 0}
            <p class="muted small indent">{emptyPagesText}</p>
          {/if}
          {#each notebook.pages as page (page.id)}
            <div class="page-row-wrap">
              <button
                class="page-row"
                on:click={() => dispatch('openPage', { notebookId: notebook.id, pageId: page.id })}
              >
                <span class="page-title">
                  {#if page.pinned}
                    <span class="page-flag" title="Pinned"><PushPin size={11} weight="fill" /></span>
                  {/if}
                  {#if page.closed}
                    <span class="page-flag" title="Only its author can edit this page">
                      <Lock size={11} weight="fill" />
                    </span>
                  {/if}
                  {pageLabel(page)}
                </span>
                <span class="page-sub">
                  {#if page.pill}
                    <AuthorPill
                      color={page.pill.color}
                      initials={page.pill.initials}
                      title={page.pill.title}
                    />
                  {/if}
                  <span class="page-sub-text">{page.sub}</span>
                </span>
              </button>
              {#if page.canDelete ?? canDeletePage}
                <button
                  class="row-btn trash-btn"
                  title="{pageDeleteWord} page"
                  aria-label="{pageDeleteWord} page"
                  on:click={() =>
                    (confirmDeletePageId = confirmDeletePageId === page.id ? null : page.id)}
                >
                  <Trash size={14} weight="bold" />
                </button>
              {/if}
            </div>

            {#if confirmDeletePageId === page.id}
              <div class="confirm-bar">
                <span>{pageDeleteWord} “{pageLabel(page)}”?</span>
                <button
                  class="confirm-yes"
                  on:click={() => confirmDeletePage(notebook.id, page.id)}>{pageDeleteWord}</button
                >
                <button class="confirm-no" on:click={() => (confirmDeletePageId = null)}>
                  Cancel
                </button>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .nb-list {
    display: contents;
  }

  .muted {
    color: #888;
    padding: 6px 10px;
  }

  .muted.small {
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .indent {
    padding-left: 26px;
  }

  /* ── Notebook rows ──────────────────────────────────────── */
  .nb-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .nb-header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #e0e0e0;
    cursor: pointer;
    text-align: left;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .nb-header:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .nb-caret {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: #888;
  }

  .nb-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .nb-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  /* Label sizes to its text and the count sits right beside it; the leftover
     space goes after the pair, so they stay married at any panel width. */
  .nb-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nb-count {
    flex-shrink: 0;
    margin-right: auto;
    color: #888;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }

  .nb-meta {
    color: #7a7a7a;
    font-size: 0.72rem;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nb-rename {
    flex: 1;
    min-width: 0;
    background: #262626;
    border: 1px solid var(--accent, #667eea);
    border-radius: 4px;
    color: #e0e0e0;
    /* 16px / 44px: iOS zooms below the first and mis-taps below the second. */
    font-size: 16px;
    min-height: 44px;
    padding: 5px 8px;
  }

  .nb-rename:focus {
    outline: none;
  }

  .row-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #888;
    font-size: 0.95rem;
    line-height: 1;
    min-width: 34px;
    min-height: 38px;
    padding: 6px 7px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .row-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .trash-btn:hover {
    background: rgba(192, 57, 43, 0.18);
    color: #f08a7a;
  }

  .row-menu {
    display: flex;
    gap: 4px;
    padding: 2px 10px 6px 26px;
  }

  .row-menu button {
    background: #262626;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #ccc;
    font-size: 0.75rem;
    padding: 4px 10px;
    cursor: pointer;
  }

  .row-menu button:hover {
    background: #333;
  }

  .row-menu button.danger {
    color: #f08a7a;
    border-color: #5a3230;
  }

  /* ── Page rows ──────────────────────────────────────────── */
  .nb-pages {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 3px 0 6px;
    padding-left: 26px;
    padding-right: 4px;
  }

  .page-row-wrap {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }

  .page-row {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    padding: 7px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: none;
    border-left: 2px solid var(--accent, #444);
    border-radius: 0 4px 4px 0;
    color: #ddd;
    cursor: pointer;
    text-align: left;
    flex: 1;
  }

  .page-row:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .page-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--page-accent, #60a5fa);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-flag {
    display: inline-flex;
    vertical-align: baseline;
    margin-right: 3px;
    color: #9a9a9a;
  }

  /* A flex row so the author's badge sits on the line rather than above it.
     The truncation moves onto the text inside, which is the part that has to
     give way when the panel is narrow — the badge never does. */
  .page-sub {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .page-sub-text {
    font-size: 0.8rem;
    line-height: 1.45;
    color: #999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Confirm bar ────────────────────────────────────────── */
  .confirm-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 2px 10px 6px;
    padding: 7px 10px;
    background: rgba(192, 57, 43, 0.12);
    border: 1px solid #5a3230;
    border-radius: 5px;
    font-size: 0.78rem;
    color: #e8b4ac;
  }

  .confirm-bar span {
    flex: 1;
    min-width: 120px;
  }

  .confirm-yes,
  .confirm-no {
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    padding: 4px 10px;
    cursor: pointer;
  }

  .confirm-yes {
    background: #c0392b;
    color: #fff;
  }

  .confirm-no {
    background: #333;
    color: #ccc;
  }

  @media (max-width: 480px) {
    .nb-header {
      font-size: 0.8rem;
    }
  }
</style>
