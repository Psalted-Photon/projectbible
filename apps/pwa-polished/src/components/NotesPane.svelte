<script lang="ts">
  /**
   * NotesPane — the desk.
   *
   * Two things live here, both signed-in only:
   *   1. Every verse note, in the same book dropdown the search results use.
   *   2. Notebooks the user names themselves, each holding free-form pages.
   *
   * Layout is a drill-down: list → tap → full-panel editor → ‹ Back. One shape
   * at every panel width, so a 20%-wide sliver and a 50/50 split both work.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { CaretDown, CaretRight, ArrowLeft, Trash } from 'phosphor-svelte';
  import RefAwareEditor from '../lib/components/RefAwareEditor.svelte';
  import SearchResultsTree from './SearchResultsTree.svelte';
  import { groupResultsByBook } from '../lib/searchTree';
  import type { SearchTreeNode } from '../lib/searchTree';
  import type { SearchResult } from '../lib/services/searchService';
  import { syncedUserDataStore, subscribeToUserDataRemoteChanges } from '../adapters/SyncedUserDataStore';
  import { syncedNotebookStore, subscribeToNotebookRemoteChanges } from '../adapters/SyncedNotebookStore';
  import type { Notebook, NotebookPage } from '../adapters/NotebookStore';
  import { userProfileStore } from '../stores/userProfileStore';
  import { profileModalStore } from '../stores/profileModalStore';
  import { navigationStore } from '../stores/navigationStore';
  import { windowStore } from '../lib/stores/windowStore';

  export let windowId: string | undefined = undefined;
  export let contentState: any = {};
  /** Which screen edge this panel is docked to — drives the resize-grip gutter below. */
  export let edge: 'left' | 'right' | 'top' | 'bottom' = 'right';

  const QUICK_NOTES = 'Quick Notes';

  // Window.svelte's resize strip is 32px wide with 8px hanging outside the
  // panel, so 24px of it sits on top of our content along the inner edge and
  // swallows every tap. Pad that side clear, with a finger's margin beyond it.
  // A bottom-docked panel needs nothing: its grip runs along the top, where the
  // window's own header already covers it.
  $: gutterL = edge === 'right' ? '32px' : '0px';
  $: gutterR = edge === 'left' ? '32px' : '0px';
  $: gutterB = edge === 'top' ? '32px' : '0px';

  type Target =
    | { kind: 'verse'; noteId: string | null; book: string; chapter: number; verse: number }
    | { kind: 'page'; pageId: string; notebookId: string };

  let view: 'browse' | 'editor' = 'browse';
  let target: Target | null = null;

  // ─── Browse data ────────────────────────────────────────────────────────────
  let verseNotes: { id: string; book: string; chapter: number; verse: number; text: string }[] = [];
  let notebooks: Notebook[] = [];
  let pagesByNotebook = new Map<string, NotebookPage[]>();
  // Verse Notes opens expanded on a fresh panel — it is the thing you came for.
  let expanded = new Set<string>(contentState?.expanded ?? ['versenotes']);
  let loading = true;

  // ─── Inline row state ───────────────────────────────────────────────────────
  let creatingNotebook = false;
  let newNotebookName = '';
  let renamingId: string | null = null;
  let renameValue = '';
  let confirmDeleteNotebookId: string | null = null;
  let confirmDeletePageId: string | null = null;
  let openMenuId: string | null = null;

  // ─── Editor state ───────────────────────────────────────────────────────────
  let editorTitle = '';
  let editorText = '';
  let isDirty = false;
  let isSaving = false;
  let saveTimeout: number | null = null;
  let confirmDeleteOpen = false;
  let settling = false; // editor is loading its initial content, not being edited

  $: isSignedIn = $userProfileStore.isSignedIn;

  // ─── Verse-note tree ────────────────────────────────────────────────────────
  // Shaped as SearchResults so SearchResultsTree renders it unchanged — the
  // book caps, counts, canonical order and reader colours all come free.
  $: verseTree = buildVerseTree(verseNotes);

  function buildVerseTree(notes: typeof verseNotes): SearchTreeNode[] {
    const results: SearchResult[] = notes
      .slice()
      .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)
      .map((n) => ({
        type: 'note' as const,
        title: `${n.book} ${n.chapter}:${n.verse}`,
        subtitle: preview(n.text),
        data: { book: n.book, chapter: n.chapter, verse: n.verse, noteId: n.id },
        score: 0,
      }));

    return [
      {
        key: 'versenotes',
        label: 'Verse Notes',
        count: results.length,
        children: groupResultsByBook('versenotes', results),
      },
    ];
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  async function loadAll() {
    if (!isSignedIn) {
      loading = false;
      return;
    }
    try {
      const [notes, books] = await Promise.all([
        syncedUserDataStore.getNotes(),
        syncedNotebookStore.getNotebooks(),
      ]);

      verseNotes = notes
        .filter((n) => stripHtml(n.text))
        .map((n) => ({
          id: n.id,
          book: n.reference.book,
          chapter: n.reference.chapter,
          verse: n.reference.verse,
          text: n.text,
        }));

      notebooks = books;

      // One read for every page, then bucket in memory — cheaper than a query
      // per notebook just to show counts.
      const allPages = await syncedNotebookStore.getAllPages();
      const buckets = new Map<string, NotebookPage[]>();
      for (const page of allPages) {
        const bucket = buckets.get(page.notebookId);
        if (bucket) bucket.push(page);
        else buckets.set(page.notebookId, [page]);
      }
      pagesByNotebook = buckets;
    } catch (err) {
      console.error('[NotesPane] load error:', err);
    } finally {
      loading = false;
    }
  }

  let unsubUserData: (() => void) | null = null;
  let unsubNotebooks: (() => void) | null = null;

  onMount(async () => {
    await loadAll();
    await restoreFromContentState();

    const reload = () => {
      // Never clobber unsaved edits with a remote pull.
      if (!isDirty) void loadAll();
    };
    unsubUserData = subscribeToUserDataRemoteChanges(reload);
    unsubNotebooks = subscribeToNotebookRemoteChanges(reload);
  });

  onDestroy(() => {
    unsubUserData?.();
    unsubNotebooks?.();
    // The panel can be closed by dragging it off the edge — flush before we go.
    if (isDirty) void save();
    if (saveTimeout) clearTimeout(saveTimeout);
  });

  /** Reopen whatever the panel was showing before a reload or an edge change. */
  async function restoreFromContentState() {
    const saved = contentState?.target as Target | undefined;
    if (contentState?.view !== 'editor' || !saved) return;

    if (saved.kind === 'page') {
      const page = await syncedNotebookStore.getPage(saved.pageId);
      if (!page) return;
      editorTitle = page.title ?? '';
      editorText = page.text;
    } else {
      const note = verseNotes.find((n) => n.id === saved.noteId);
      if (!note) return;
      editorTitle = `${note.book} ${note.chapter}:${note.verse}`;
      editorText = note.text;
    }
    target = saved;
    openEditor();
  }

  function persistState() {
    if (!windowId) return;
    windowStore.updateContentState(windowId, {
      view,
      target,
      expanded: [...expanded],
    });
  }

  // ─── Browse actions ─────────────────────────────────────────────────────────

  function toggleNode(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    expanded = expanded;
    persistState();
  }

  function openVerseNote(result: SearchResult) {
    const { book, chapter, verse, noteId } = result.data;
    const note = verseNotes.find((n) => n.id === noteId);
    editorTitle = `${book} ${chapter}:${verse}`;
    editorText = note?.text ?? '';
    target = { kind: 'verse', noteId, book, chapter, verse };
    openEditor();
  }

  async function openPage(page: NotebookPage) {
    editorTitle = page.title ?? '';
    editorText = page.text;
    target = { kind: 'page', pageId: page.id, notebookId: page.notebookId };
    openEditor();
  }

  function openEditor() {
    isDirty = false;
    confirmDeleteOpen = false;
    // LexicalEditor's update listener fires for its own initial content load,
    // which would otherwise mark a note dirty and bump updatedAt just for being
    // opened — reshuffling the page list every time you read something.
    settling = true;
    view = 'editor';
    void tick().then(() =>
      setTimeout(() => {
        settling = false;
        isDirty = false;
      }, 200),
    );
    persistState();
  }

  async function backToBrowse() {
    if (isDirty) await save();
    view = 'browse';
    target = null;
    confirmDeleteOpen = false;
    await loadAll();
    persistState();
  }

  /** The notebook every quick note lands in. Created the first time it's needed. */
  async function ensureQuickNotes(): Promise<Notebook> {
    const existing = notebooks.find((n) => n.name === QUICK_NOTES);
    if (existing) return existing;
    const created = await syncedNotebookStore.createNotebook(QUICK_NOTES);
    notebooks = [...notebooks, created];
    return created;
  }

  async function newQuickNote() {
    const notebook = await ensureQuickNotes();
    await newPage(notebook.id);
  }

  async function newPage(notebookId: string) {
    const page = await syncedNotebookStore.createPage({ notebookId, title: '', text: '' });
    const bucket = pagesByNotebook.get(notebookId) ?? [];
    pagesByNotebook.set(notebookId, [page, ...bucket]);
    pagesByNotebook = pagesByNotebook;
    expanded.add(`nb::${notebookId}`);
    expanded = expanded;
    await openPage(page);
  }

  async function commitNewNotebook() {
    // Enter and the blur that follows it both land here — clear the field
    // before awaiting so the second call is a no-op instead of a duplicate.
    const name = newNotebookName.trim();
    newNotebookName = '';
    creatingNotebook = false;
    if (!name) return;
    const created = await syncedNotebookStore.createNotebook(name);
    notebooks = [...notebooks, created];
    expanded.add(`nb::${created.id}`);
    expanded = expanded;
    creatingNotebook = false;
    newNotebookName = '';
    persistState();
  }

  function startRename(notebook: Notebook) {
    openMenuId = null;
    renamingId = notebook.id;
    renameValue = notebook.name;
  }

  async function commitRename() {
    const id = renamingId;
    const name = renameValue.trim();
    renamingId = null;
    if (!id || !name) return;
    await syncedNotebookStore.renameNotebook(id, name);
    notebooks = notebooks.map((n) => (n.id === id ? { ...n, name } : n));
  }

  async function deleteNotebook(id: string) {
    confirmDeleteNotebookId = null;
    openMenuId = null;
    await syncedNotebookStore.deleteNotebook(id);
    notebooks = notebooks.filter((n) => n.id !== id);
    pagesByNotebook.delete(id);
    pagesByNotebook = pagesByNotebook;
  }

  /** Delete a page straight from the list, without opening it first. */
  async function deletePage(page: NotebookPage) {
    confirmDeletePageId = null;
    await syncedNotebookStore.deletePage(page.id);
    const remaining = pagesFor(page.notebookId).filter((p) => p.id !== page.id);
    pagesByNotebook.set(page.notebookId, remaining);
    pagesByNotebook = pagesByNotebook;
  }

  // ─── Editor ─────────────────────────────────────────────────────────────────

  function handleTextChange(e: CustomEvent<string>) {
    editorText = e.detail;
    if (settling) return;
    isDirty = true;
    debouncedSave();
  }

  function handleTitleInput() {
    isDirty = true;
    debouncedSave();
  }

  function handleBlur() {
    if (isDirty) void save();
  }

  function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => void save(), 2000);
  }

  async function save() {
    if (isSaving || !target) return;
    isSaving = true;
    const wasDirty = isDirty;
    isDirty = false;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }

    try {
      if (target.kind === 'verse') {
        // Emptying a verse note deletes it, same as the floating NotePopup —
        // an anchor with nothing behind it would leave a ✎ pointing at nothing.
        if (!stripHtml(editorText)) {
          const deletedId = target.noteId;
          if (deletedId) {
            await syncedUserDataStore.deleteNote(deletedId);
            verseNotes = verseNotes.filter((n) => n.id !== deletedId);
            target = { ...target, noteId: null };
          }
        } else if (target.noteId) {
          await syncedUserDataStore.updateNote(target.noteId, editorText);
        } else {
          const saved = await syncedUserDataStore.saveNote({
            reference: { book: target.book, chapter: target.chapter, verse: target.verse },
            text: editorText,
          });
          target = { ...target, noteId: saved.id };
        }
      } else {
        // Pages are never auto-deleted: a titled page the user emptied on
        // purpose should still be there tomorrow. Deleting is explicit.
        await syncedNotebookStore.updatePage(target.pageId, {
          title: editorTitle.trim(),
          text: editorText,
        });
      }
      persistState();
    } catch (err) {
      console.error('[NotesPane] save error:', err);
      isDirty = wasDirty;
    } finally {
      isSaving = false;
    }
  }

  async function deleteCurrent() {
    if (!target) return;
    confirmDeleteOpen = false;
    isDirty = false;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    try {
      if (target.kind === 'verse') {
        if (target.noteId) await syncedUserDataStore.deleteNote(target.noteId);
      } else {
        await syncedNotebookStore.deletePage(target.pageId);
      }
    } catch (err) {
      console.error('[NotesPane] delete error:', err);
    }
    view = 'browse';
    target = null;
    await loadAll();
    persistState();
  }

  async function jumpToVerse() {
    if (!target || target.kind !== 'verse') return;
    if (isDirty) await save();
    navigationStore.navigateToVerse(
      $navigationStore.translation,
      target.book,
      target.chapter,
      target.verse,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function stripHtml(html: string): string {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function preview(html: string): string {
    const text = stripHtml(html);
    return text.length > 140 ? text.slice(0, 140) + '…' : text;
  }

  function pageLabel(page: NotebookPage): string {
    const title = (page.title ?? '').trim();
    if (title) return title;
    const body = stripHtml(page.text);
    return body ? body.slice(0, 40) : 'Untitled';
  }

  function formatDate(d: Date): string {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function pagesFor(id: string): NotebookPage[] {
    return pagesByNotebook.get(id) ?? [];
  }

  /**
   * Focus a field the moment it appears. Must be synchronous: mobile browsers
   * only raise the keyboard for a focus() that happens inside the tap that
   * caused it, so deferring this to a tick or a timeout gets a caret with no
   * keyboard behind it.
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

<div
  class="notes-pane"
  style="--gut-l:{gutterL}; --gut-r:{gutterR}; --gut-b:{gutterB};"
>
  {#if !isSignedIn}
    <!-- ── Signed out ──────────────────────────────────────────────────────── -->
    <div class="auth-wall">
      <div class="auth-wall-icon">📝</div>
      <p class="auth-wall-text">
        Sign in to write notes and keep them synced across all your devices.
      </p>
      <button class="auth-wall-btn" on:click={() => profileModalStore.open()}>
        Sign In to Continue →
      </button>
    </div>
  {:else if view === 'editor'}
    <!-- ── Editor ──────────────────────────────────────────────────────────── -->
    <div class="editor-header">
      <button class="back-btn" on:click={backToBrowse}>
        <ArrowLeft size={14} weight="duotone" />
        <span>Back</span>
      </button>

      {#if target?.kind === 'page'}
        <input
          class="title-input"
          placeholder="Untitled"
          bind:value={editorTitle}
          on:input={handleTitleInput}
          on:blur={handleBlur}
          on:mousedown={guardPointer}
          on:touchstart={guardPointer}
          on:click={guardPointer}
        />
      {:else}
        <span class="title-static">{editorTitle}</span>
      {/if}

      {#if isSaving}
        <span class="save-status">Saving…</span>
      {:else if isDirty}
        <span class="save-status dirty">●</span>
      {/if}

      {#if target?.kind === 'verse'}
        <button class="icon-btn" title="Go to this verse" on:click={jumpToVerse}>↗</button>
      {/if}

      <button
        class="icon-btn"
        title="Delete"
        on:click={() => (confirmDeleteOpen = !confirmDeleteOpen)}>⋯</button
      >
    </div>

    {#if confirmDeleteOpen}
      <div class="confirm-bar">
        <span>Delete this {target?.kind === 'verse' ? 'note' : 'page'}?</span>
        <button class="confirm-yes" on:click={deleteCurrent}>Delete</button>
        <button class="confirm-no" on:click={() => (confirmDeleteOpen = false)}>Cancel</button>
      </div>
    {/if}

    <div class="editor-body">
      <RefAwareEditor
        bind:isDirty
        surface="notes"
        surfaceLabel="Notes"
        value={editorText}
        placeholder="Start writing…"
        on:change={handleTextChange}
        on:blur={handleBlur}
      />
    </div>
  {:else}
    <!-- ── Browse ──────────────────────────────────────────────────────────── -->
    <div class="browse-header">
      <span class="browse-title">Notes</span>
      <button class="primary-btn" on:click={newQuickNote}>+ New note</button>
    </div>

    <div class="browse-body">
      {#if loading}
        <p class="muted">Loading…</p>
      {:else}
        <!-- Verse notes: the same book dropdown the search results use -->
        <section class="section">
          {#if verseNotes.length === 0}
            <div class="section-head">
              <span class="section-label">Verse Notes</span>
              <span class="section-count">(0)</span>
            </div>
            <p class="muted small">
              Select a verse while reading and choose Notes — anything you write there shows up here.
            </p>
          {:else}
            <SearchResultsTree
              nodes={verseTree}
              {expanded}
              onToggle={toggleNode}
              onSelect={openVerseNote}
            />
          {/if}
        </section>

        <!-- Notebooks -->
        <section class="section">
          <div class="section-head">
            <span class="section-label">Notebooks</span>
            <span class="section-count">({notebooks.length})</span>
          </div>

          {#if notebooks.length === 0 && !creatingNotebook}
            <p class="muted small">Create a notebook and start taking notes.</p>
          {/if}

          {#each notebooks as notebook (notebook.id)}
            {@const pages = pagesFor(notebook.id)}
            {@const key = `nb::${notebook.id}`}
            <div class="nb">
              <div class="nb-row">
                {#if renamingId === notebook.id}
                  <!-- The field REPLACES the row button. Nesting an input inside
                       a button is invalid and the browser yanks focus back to
                       the button, which is what ate the caret. -->
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
                  <button class="nb-header" on:click={() => toggleNode(key)}>
                    <span class="nb-caret">
                      {#if expanded.has(key)}
                        <CaretDown size={11} weight="bold" />
                      {:else}
                        <CaretRight size={11} weight="bold" />
                      {/if}
                    </span>
                    <span class="nb-label">{notebook.name}</span>
                    <span class="nb-count">({pages.length})</span>
                  </button>

                  <button class="row-btn" title="New page" on:click={() => newPage(notebook.id)}>+</button>
                  <button
                    class="row-btn"
                    title="Notebook options"
                    on:click={() => (openMenuId = openMenuId === notebook.id ? null : notebook.id)}
                    >⋯</button
                  >
                {/if}
              </div>

              {#if openMenuId === notebook.id}
                <div class="row-menu">
                  <button on:click={() => startRename(notebook)}>Rename</button>
                  <button
                    class="danger"
                    on:click={() => {
                      openMenuId = null;
                      confirmDeleteNotebookId = notebook.id;
                    }}>Delete notebook</button
                  >
                </div>
              {/if}

              {#if confirmDeleteNotebookId === notebook.id}
                <div class="confirm-bar">
                  <span>
                    Delete “{notebook.name}”{pages.length
                      ? ` and its ${pages.length} page${pages.length === 1 ? '' : 's'}`
                      : ''}?
                  </span>
                  <button class="confirm-yes" on:click={() => deleteNotebook(notebook.id)}>Delete</button>
                  <button class="confirm-no" on:click={() => (confirmDeleteNotebookId = null)}>Cancel</button>
                </div>
              {/if}

              {#if expanded.has(key)}
                <div class="nb-pages">
                  {#if pages.length === 0}
                    <p class="muted small indent">No pages yet.</p>
                  {/if}
                  {#each pages as page (page.id)}
                    <div class="page-row-wrap">
                      <button class="page-row" on:click={() => openPage(page)}>
                        <span class="page-title">{pageLabel(page)}</span>
                        <span class="page-sub">
                          {preview(page.text) || 'Empty'} · {formatDate(page.updatedAt)}
                        </span>
                      </button>
                      <button
                        class="row-btn trash-btn"
                        title="Delete page"
                        aria-label="Delete page"
                        on:click={() => (confirmDeletePageId =
                          confirmDeletePageId === page.id ? null : page.id)}
                      >
                        <Trash size={14} weight="bold" />
                      </button>
                    </div>

                    {#if confirmDeletePageId === page.id}
                      <div class="confirm-bar">
                        <span>Delete “{pageLabel(page)}”?</span>
                        <button class="confirm-yes" on:click={() => deletePage(page)}>Delete</button>
                        <button class="confirm-no" on:click={() => (confirmDeletePageId = null)}>Cancel</button>
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}

          {#if creatingNotebook}
            <input
              class="new-nb-input"
              placeholder="Notebook name…"
              bind:value={newNotebookName}
              use:focusOnMount
              on:mousedown={guardPointer}
              on:touchstart={guardPointer}
              on:click={guardPointer}
              on:blur={commitNewNotebook}
              on:keydown={(e) => {
                if (e.key === 'Enter') commitNewNotebook();
                if (e.key === 'Escape') {
                  creatingNotebook = false;
                  newNotebookName = '';
                }
              }}
            />
          {:else}
            <button class="ghost-btn" on:click={() => (creatingNotebook = true)}>+ New notebook</button>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .notes-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: #1a1a1a;
    color: #e0e0e0;
  }

  /* ── Signed out ─────────────────────────────────────────── */
  .auth-wall {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px 24px;
    text-align: center;
  }

  .auth-wall-icon {
    font-size: 44px;
  }

  .auth-wall-text {
    color: #aaa;
    font-size: 0.9rem;
    line-height: 1.5;
    max-width: 320px;
  }

  .auth-wall-btn {
    padding: 10px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }

  /* ── Headers ────────────────────────────────────────────── */
  /* The --gut-* values keep content clear of the window's resize strip, which
     overlaps 24px of the panel along whichever edge it is docked against. */
  .browse-header,
  .editor-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px calc(10px + var(--gut-r)) 8px calc(10px + var(--gut-l));
    border-bottom: 1px solid #333;
    flex-shrink: 0;
    min-height: 44px;
  }

  .editor-body {
    padding-left: var(--gut-l);
    padding-right: var(--gut-r);
  }

  .browse-title {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .primary-btn {
    padding: 5px 12px;
    background: #667eea;
    border: none;
    border-radius: 5px;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .primary-btn:hover {
    background: #7c8ef0;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: #bbb;
    font-size: 1.1rem;
    line-height: 1;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  /* Matches the app's other back affordances — icon plus the word, Milonga
     inherited from the global font. */
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 0.85rem;
    padding: 8px 8px 8px 4px;
    border-radius: 4px;
    cursor: pointer;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .title-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: #e0e0e0;
    /* 16px keeps iOS from zooming the whole panel when the field takes focus. */
    font-size: 16px;
    font-weight: 600;
    min-height: 44px;
    padding: 4px 2px;
  }

  .title-input:focus {
    outline: none;
    border-bottom: 1px solid #667eea;
  }

  .title-static {
    flex: 1;
    min-width: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #60a5fa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .save-status {
    font-size: 0.75rem;
    color: #888;
    flex-shrink: 0;
  }

  .save-status.dirty {
    font-size: 1rem;
    color: #667eea;
  }

  /* ── Editor ─────────────────────────────────────────────── */
  .editor-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── Browse ─────────────────────────────────────────────── */
  .browse-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px calc(6px + var(--gut-r)) calc(24px + var(--gut-b)) calc(6px + var(--gut-l));
  }

  .section + .section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #2c2c2c;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .section-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-count {
    flex-shrink: 0;
    margin-right: auto;
    color: #888;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
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

  .nb-rename,
  .new-nb-input {
    flex: 1;
    min-width: 0;
    background: #262626;
    border: 1px solid #667eea;
    border-radius: 4px;
    color: #e0e0e0;
    /* 16px / 44px: iOS zooms below the first and mis-taps below the second. */
    font-size: 16px;
    min-height: 44px;
    padding: 5px 8px;
  }

  .nb-rename:focus,
  .new-nb-input:focus {
    outline: none;
  }

  .new-nb-input {
    width: calc(100% - 20px);
    margin: 4px 10px;
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

  .ghost-btn {
    display: block;
    width: calc(100% - 20px);
    margin: 6px 10px 0;
    padding: 7px 10px;
    background: transparent;
    border: 1px dashed #444;
    border-radius: 5px;
    color: #999;
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
  }

  .ghost-btn:hover {
    border-color: #667eea;
    color: #ccc;
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
    border-left: 2px solid #444;
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
    color: #60a5fa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-sub {
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
    .browse-header,
    .editor-header {
      padding: 6px 8px;
    }

    .section-head,
    .nb-header {
      font-size: 0.8rem;
    }
  }
</style>
