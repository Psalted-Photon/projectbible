<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import LexicalEditor from '../lib/components/LexicalEditor.svelte';
  import { syncedUserDataStore } from '../adapters/SyncedUserDataStore';

  export let book: string;
  export let chapter: number;
  export let verse: number;
  export let initialContent: string = '';
  export let noteId: string | null = null;
  export let x: number = 0;
  export let y: number = 0;
  export let width: number = 320;
  export let height: number = 240;

  const dispatch = createEventDispatcher();
  const userDataStore = syncedUserDataStore;

  // Position & size (mutable local state)
  let left = x;
  let top = y;
  let w = width;
  let h = height;

  const MIN_W = 200;
  const MIN_H = 150;

  // Save state
  let currentNoteId: string | null = noteId;
  let currentContent = initialContent;
  let isDirty = false;
  let isSaving = false;
  let saveTimeout: number | null = null;
  // Interaction state
  type InteractMode = 'move' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w' | null;
  let interactMode: InteractMode = null;
  let activeEdge: string | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startW = 0;
  let startH = 0;

  $: label = `${book} ${chapter}:${verse}`;
  $: posKey = `verse-note-pos-${book}-${chapter}-${verse}`;

  onMount(async () => {
    // Reset dirty flag after LexicalEditor initial content load settles
    await tick();
    setTimeout(() => { isDirty = false; }, 150);
  });

  onDestroy(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
    removeWindowListeners();
  });

  // ---- Auto-save logic ----

  function handleChange(e: CustomEvent<string>) {
    currentContent = e.detail;
    isDirty = true;
    debouncedSave();
  }

  function handleBlur() {
    if (isDirty) saveNote();
  }

  function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => saveNote(), 2000);
  }

  async function saveNote() {
    if (isSaving) return;
    isSaving = true;
    const wasDirty = isDirty;
    isDirty = false;
    if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }

    try {
      const empty = isContentEmpty(currentContent);
      if (empty) {
        if (currentNoteId) {
          await userDataStore.deleteNote(currentNoteId);
          currentNoteId = null;
          dispatch('noteDeleted', { book, chapter, verse });
        }
      } else {
        if (currentNoteId) {
          await userDataStore.updateNote(currentNoteId, currentContent);
        } else {
          const saved = await userDataStore.saveNote({
            reference: { book, chapter, verse },
            text: currentContent,
          });
          currentNoteId = saved.id;
        }
        dispatch('noteSaved', { book, chapter, verse, noteId: currentNoteId });
      }
    } catch (err) {
      console.error('[NotePopup] Save error:', err);
      isDirty = wasDirty; // restore dirty on failure
    } finally {
      isSaving = false;
    }
  }

  function isContentEmpty(html: string): boolean {
    if (!html) return true;
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').trim() === '';
  }

  // ---- Close ----

  function handleClose() {
    if (isDirty) saveNote();
    dispatch('close');
  }

  // ---- Drag-move (3 corners: top-left, bottom-left, bottom-right) ----

  function startMove(e: PointerEvent) {
    e.preventDefault();
    interactMode = 'move';
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    startLeft = left;
    startTop = top;
    addWindowListeners();
  }

  // ---- Resize (4 edges) ----

  function startResize(e: PointerEvent, edge: 'n' | 's' | 'e' | 'w') {
    e.preventDefault();
    interactMode = `resize-${edge}` as InteractMode;
    activeEdge = edge;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    startLeft = left;
    startTop = top;
    startW = w;
    startH = h;
    addWindowListeners();
  }

  function addWindowListeners() {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function removeWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;

    if (interactMode === 'move') {
      left = startLeft + dx;
      top = startTop + dy;
    } else if (interactMode === 'resize-n') {
      const newH = Math.max(MIN_H, startH - dy);
      top = startTop + (startH - newH);
      h = newH;
    } else if (interactMode === 'resize-s') {
      h = Math.max(MIN_H, startH + dy);
    } else if (interactMode === 'resize-e') {
      w = Math.max(MIN_W, startW + dx);
    } else if (interactMode === 'resize-w') {
      const newW = Math.max(MIN_W, startW - dx);
      left = startLeft + (startW - newW);
      w = newW;
    }
  }

  function onPointerUp() {
    interactMode = null;
    activeEdge = null;
    removeWindowListeners();
    // Persist position & size to localStorage
    try {
      localStorage.setItem(posKey, JSON.stringify({ x: left, y: top, w, h }));
    } catch { /* quota exceeded or private mode — ignore */ }
  }
</script>

<div
  class="note-popup"
  class:interacting={interactMode !== null}
  style="left:{left}px; top:{top}px; width:{w}px; height:{h}px;"
>
  <!-- Edge resize strips (8px, inside the border) -->
  <div
    class="edge edge-n"
    class:active={activeEdge === 'n'}
    role="separator"
    aria-label="Resize top"
    on:pointerdown={(e) => startResize(e, 'n')}
  ></div>
  <div
    class="edge edge-s"
    class:active={activeEdge === 's'}
    role="separator"
    aria-label="Resize bottom"
    on:pointerdown={(e) => startResize(e, 's')}
  ></div>
  <div
    class="edge edge-e"
    class:active={activeEdge === 'e'}
    role="separator"
    aria-label="Resize right"
    on:pointerdown={(e) => startResize(e, 'e')}
  ></div>
  <div
    class="edge edge-w"
    class:active={activeEdge === 'w'}
    role="separator"
    aria-label="Resize left"
    on:pointerdown={(e) => startResize(e, 'w')}
  ></div>

  <!-- Corner drag handles (top-left, bottom-left, bottom-right → move entire note) -->
  <div
    class="corner corner-tl"
    role="button"
    tabindex="0"
    aria-label="Drag to move note"
    title="Drag to move"
    on:pointerdown={startMove}
    on:keydown={(e) => e.key === ' ' && e.preventDefault()}
  ></div>
  <div
    class="corner corner-bl"
    role="button"
    tabindex="0"
    aria-label="Drag to move note"
    title="Drag to move"
    on:pointerdown={startMove}
    on:keydown={(e) => e.key === ' ' && e.preventDefault()}
  ></div>
  <div
    class="corner corner-br"
    role="button"
    tabindex="0"
    aria-label="Drag to move note"
    title="Drag to move"
    on:pointerdown={startMove}
    on:keydown={(e) => e.key === ' ' && e.preventDefault()}
  ></div>

  <!-- Top-right: close button only -->
  <button class="close-btn" on:click={handleClose} aria-label="Close note" title="Close">
    ✕
  </button>

  <!-- Header bar -->
  <div class="note-header" aria-label="Note header">
    <span class="note-label">{label}</span>
    {#if isSaving}
      <span class="save-status">Saving...</span>
    {:else if isDirty}
      <span class="save-status dirty">●</span>
    {/if}
  </div>

  <!-- Content (LexicalEditor fills this area) -->
  <div class="note-content">
    <LexicalEditor
      bind:isDirty
      value={initialContent}
      placeholder="Write your note here..."
      on:change={handleChange}
      on:blur={handleBlur}
    />
  </div>
</div>

<style>
  .note-popup {
    position: fixed;
    z-index: 9500;
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    overflow: visible; /* edges and corners extend slightly outside */
    /* Prevent text selection while dragging */
    user-select: none;
  }

  /* ── Edge resize strips ─────────────────────────────────── */
  .edge {
    position: absolute;
    z-index: 10;
    background: transparent;
    transition: background 0.15s;
  }

  .edge:hover,
  .edge.active {
    background: rgba(102, 126, 234, 0.35);
  }

  /* Spans between corners (leave 20px on each end for corners) */
  .edge-n { top: 0;    left: 20px;  right: 20px; height: 8px; cursor: ns-resize; }
  .edge-s { bottom: 0; left: 20px;  right: 20px; height: 8px; cursor: ns-resize; }
  .edge-e { top: 20px; right: 0;    bottom: 20px; width: 8px; cursor: ew-resize; }
  .edge-w { top: 20px; left: 0;     bottom: 20px; width: 8px; cursor: ew-resize; }

  /* ── Corner drag handles ────────────────────────────────── */
  .corner {
    position: absolute;
    width: 20px;
    height: 20px;
    z-index: 11;
    cursor: move;
    background: transparent;
    transition: background 0.15s;
  }

  .corner:hover {
    background: rgba(102, 126, 234, 0.25);
  }

  .corner-tl { top: 0;    left: 0;  border-radius: 4px 0 0 0; }
  .corner-bl { bottom: 0; left: 0;  border-radius: 0 0 0 4px; }
  .corner-br { bottom: 0; right: 0; border-radius: 0 0 4px 0; }

  /* ── Close button (top-right corner exclusively) ────────── */
  .close-btn {
    position: absolute;
    top: 0;
    right: 0;
    width: 28px;
    height: 28px;
    z-index: 12;
    background: transparent;
    border: none;
    color: #c0392b;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0 4px 0 0;
    transition: background 0.15s, color 0.15s;
    line-height: 1;
    padding: 0;
  }

  .close-btn:hover {
    background: rgba(192, 57, 43, 0.18);
    color: #e74c3c;
  }

  /* ── Header bar ─────────────────────────────────────────── */
  .note-header {
    display: flex;
    align-items: center;
    gap: 6px;
    /* left: clears corner handle; right: clears close button */
    padding: 4px 32px 4px 24px;
    background: #b8d4f0;
    border-bottom: 1px solid #9bbfe0;
    flex-shrink: 0;
    min-height: 28px;
    border-radius: 4px 4px 0 0;
  }

  .note-label {
    font-size: 11px;
    font-weight: 600;
    color: #2c5282;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .save-status {
    font-size: 12px;
    color: #4a6fa5;
    flex-shrink: 0;
  }

  .save-status.dirty {
    font-size: 18px;
    color: #4a90d9;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }

  /* ── Content area (LexicalEditor host) ─────────────────── */
  .note-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border-radius: 0 0 4px 4px;
    /* Baby sky-blue with horizontal ruling lines */
    background-color: #d6eaf8;
    /* CSS custom-property overrides consumed by LexicalEditor */
    --background-color: transparent;
    --toolbar-bg: #c2daf0;
    --border-color: #9bbfe0;
    --button-bg: #d6eaf8;
    --button-hover-bg: #b8d4f0;
    --text-color: #1a3a5c;
    --placeholder-color: #5b8db8;
    --accent-color: #4a90d9;
    /* Allow text selection inside the editor */
    user-select: text;
  }

  /* While actively dragging/resizing, prevent text cursor flickering */
  .note-popup.interacting .note-content {
    pointer-events: none;
  }
</style>
