<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import RefAwareEditor from '../lib/components/RefAwareEditor.svelte';
  import { syncedUserDataStore } from '../adapters/SyncedUserDataStore';
  import { getEditorTheme } from '../adapters/settings';
  import { editorThemeVars } from '../lib/editorTheme';
  import { fixedOrigin } from '../lib/fixedOrigin';

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

  /** How much of the note must stay on screen, so it can always be grabbed back. */
  const KEEP_VISIBLE = 60;

  let popupEl: HTMLDivElement;

  // Save state
  let currentNoteId: string | null = noteId;
  let currentContent = initialContent;
  let isDirty = false;
  let isSaving = false;
  let saveTimeout: number | null = null;
  // Interaction state.
  //
  // An edge is one letter, a corner is two — 'sw' both moves the bottom edge
  // and the left edge — so one set of branches in onPointerMove covers both by
  // asking whether the handle name contains each letter.
  //
  // No 'n' anywhere: the top of the note is the drag bar and nothing else.
  type Handle = 's' | 'e' | 'w' | 'sw' | 'se';
  let interactMode: 'move' | 'resize' | null = null;
  let activeHandle: Handle | null = null;
  let gestureBounds: { width: number; height: number } | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startW = 0;
  let startH = 0;

  $: label = `${book} ${chapter}:${verse}`;
  $: posKey = `verse-note-pos-${book}-${chapter}-${verse}`;

  /**
   * A sticky note is a child of the Notes window and wears whatever it is
   * wearing. The editor inside handles its own theming from the same source;
   * this copy exists so the header bar and frame follow along too, instead of
   * leaving a blue lip on top of someone's black-and-amber note.
   *
   * On the default theme this is the empty string, so the baby-blue values in
   * the stylesheet below stay in charge.
   */
  let noteTheme = editorThemeVars(getEditorTheme('notes'));

  function refreshNoteTheme() {
    noteTheme = editorThemeVars(getEditorTheme('notes'));
  }

  onMount(async () => {
    // Retheme when the Notes pane changes its look, or a sync pull brings a
    // newer one down from another device.
    window.addEventListener('editorSurfaceUpdated', refreshNoteTheme);
    window.addEventListener('settingsUpdated', refreshNoteTheme);

    // A note saved off-screen — or saved on a wider screen, or before the phone
    // was rotated — would otherwise open somewhere the user cannot reach it.
    window.addEventListener('resize', clampIntoView);
    await tick();
    clampIntoView();

    // Reset dirty flag after LexicalEditor initial content load settles
    setTimeout(() => { isDirty = false; }, 150);
  });

  onDestroy(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
    removeWindowListeners();
    window.removeEventListener('editorSurfaceUpdated', refreshNoteTheme);
    window.removeEventListener('settingsUpdated', refreshNoteTheme);
    window.removeEventListener('resize', clampIntoView);
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
    // Also persist here: the mount clamp and a rotation can move the note
    // without any pointerup to save it.
    savePosition();
    dispatch('close');
  }

  // ---- Geometry ----

  /**
   * The box this note is laid out against — usually the viewport, but not when a
   * filter on `.themed` makes an ancestor the containing block. See
   * lib/fixedOrigin.ts. Only the size matters here: `left`/`top` are already
   * expressed relative to this box, so no offset has to be subtracted.
   */
  function bounds(): { width: number; height: number } {
    // Measured once per gesture: fixedOrigin walks ancestors reading computed
    // styles, which is not something to do on every pointermove.
    if (gestureBounds) return gestureBounds;
    const origin = fixedOrigin(popupEl);
    return { width: origin.width, height: origin.height };
  }

  /**
   * Keeps the note grabbable. The header is the only way to move it, so the top
   * never goes negative, and a sliver of the note always stays inside each other
   * edge — otherwise a note flicked off the screen is saved off the screen and
   * is gone for good the next time that verse is opened.
   */
  function clampIntoView() {
    const { width, height } = bounds();
    w = Math.min(w, Math.max(MIN_W, width));
    h = Math.min(h, Math.max(MIN_H, height));
    left = Math.min(Math.max(left, KEEP_VISIBLE - w), Math.max(0, width - KEEP_VISIBLE));
    top = Math.min(Math.max(top, 0), Math.max(0, height - KEEP_VISIBLE));
  }

  // ---- Drag-move (header bar) ----

  function startMove(e: PointerEvent) {
    beginInteraction(e);
    interactMode = 'move';
  }

  // ---- Resize (side + bottom edges, bottom corners) ----

  function startResize(e: PointerEvent, handle: Handle) {
    beginInteraction(e);
    interactMode = 'resize';
    activeHandle = handle;
  }

  function beginInteraction(e: PointerEvent) {
    e.preventDefault();
    const origin = fixedOrigin(popupEl);
    gestureBounds = { width: origin.width, height: origin.height };
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    startLeft = left;
    startTop = top;
    startW = w;
    startH = h;
    // Capture keeps the gesture alive when the pointer outruns the handle, which
    // it always does on a small target.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety — the window listeners below still work */
    }
    addWindowListeners();
  }

  function addWindowListeners() {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function removeWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    if (!interactMode) return;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;

    if (interactMode === 'move') {
      left = startLeft + dx;
      top = startTop + dy;
    } else if (activeHandle) {
      const { width, height } = bounds();
      // Each letter in the handle name is one edge that moves. A corner has two,
      // so both axes change in a single gesture. The top edge never moves — see
      // the Handle type.
      if (activeHandle.includes('s')) {
        h = Math.min(Math.max(MIN_H, startH + dy), Math.max(MIN_H, height - startTop));
      }
      if (activeHandle.includes('w')) {
        const newW = Math.min(Math.max(MIN_W, startW - dx), startLeft + startW);
        left = startLeft + (startW - newW);
        w = newW;
      } else if (activeHandle.includes('e')) {
        w = Math.min(Math.max(MIN_W, startW + dx), Math.max(MIN_W, width - startLeft));
      }
    }

    clampIntoView();
  }

  function onPointerUp() {
    if (!interactMode) return;
    interactMode = null;
    activeHandle = null;
    gestureBounds = null;
    removeWindowListeners();
    savePosition();
  }

  function savePosition() {
    try {
      localStorage.setItem(posKey, JSON.stringify({ x: left, y: top, w, h }));
    } catch { /* quota exceeded or private mode — ignore */ }
  }
</script>

<div
  bind:this={popupEl}
  class="note-popup"
  class:interacting={interactMode !== null}
  style="left:{left}px; top:{top}px; width:{w}px; height:{h}px; {noteTheme}"
>
  <!-- Resize handles: side and bottom edges for one axis, bottom corners for
       both at once. All of them are wider than they look, so a finger can land
       on them. -->
  {#each ['s', 'e', 'w'] as edge}
    <div
      class="edge edge-{edge}"
      class:active={activeHandle === edge}
      role="separator"
      aria-label="Resize note"
      on:pointerdown={(e) => startResize(e, edge as Handle)}
    ></div>
  {/each}

  <!-- Bottom corners only. Nothing resizes along the top: that whole strip is
       the drag bar, and a handle sharing it just means you grab the wrong one.
       Move the note and resize from the bottom instead. -->
  {#each ['sw', 'se'] as corner}
    <div
      class="corner corner-{corner}"
      class:active={activeHandle === corner}
      role="separator"
      aria-label="Resize note"
      title="Drag to resize"
      on:pointerdown={(e) => startResize(e, corner as Handle)}
    ></div>
  {/each}

  <!-- Top-right: close button only -->
  <button class="close-btn" on:click={handleClose} aria-label="Close note" title="Close">
    ✕
  </button>

  <!-- Header bar doubles as the drag handle — the obvious place to grab a
       window is its title bar, and it is the one target big enough for a
       thumb. No role here, matching Window.svelte's title bar, so the label
       and status inside keep their own semantics. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="note-header"
    class:dragging={interactMode === 'move'}
    title="Drag to move"
    on:pointerdown={startMove}
  >
    <span class="drag-grip" aria-hidden="true"></span>
    <span class="note-label">{label}</span>
    {#if isSaving}
      <span class="save-status">Saving...</span>
    {:else if isDirty}
      <span class="save-status dirty">●</span>
    {/if}
  </div>

  <!-- Content (LexicalEditor fills this area) -->
  <div class="note-content">
    <RefAwareEditor
      bind:isDirty
      autofocus
      surface="notes"
      surfaceLabel="Notes"
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

  /* ── Resize handles ─────────────────────────────────────────
     Sized for a fingertip, not a mouse cursor. The old 8px strips and 20px
     corners were nearly impossible to hit on a phone, so these are 16px and
     30px and hang a few px outside the frame — enough to grab, little enough
     that the dead zone over the text behind the note stays small.

     touch-action is the important part: preventDefault on pointerdown does
     NOT stop a touch from scrolling the chapter underneath, only this does. */
  .edge,
  .corner {
    position: absolute;
    background: transparent;
    touch-action: none;
    transition: background 0.15s;
  }

  .edge { z-index: 10; }
  .corner { z-index: 11; width: 30px; height: 30px; }

  .edge:hover,
  .edge.active,
  .corner:hover,
  .corner.active {
    background: rgba(102, 126, 234, 0.3);
  }

  /* The side edges start below the header (35px incl. its border) so the drag
     bar is never shared with a resize handle, and stop short of the bottom
     corners so those two never fight over a pointer. */
  .edge-s { bottom: -5px; left: 26px;  right: 26px;  height: 16px; cursor: ns-resize; }
  .edge-e { right: -5px;  top: 38px;   bottom: 26px; width: 16px;  cursor: ew-resize; }
  .edge-w { left: -5px;   top: 38px;   bottom: 26px; width: 16px;  cursor: ew-resize; }

  .corner-sw { bottom: -5px; left: -5px;  cursor: nesw-resize; border-radius: 0 0 0 4px; }
  .corner-se { bottom: -5px; right: -5px; cursor: nwse-resize; border-radius: 0 0 4px 0; }

  /* The classic diagonal grip, so at least one corner announces itself. Drawn
     on the handle rather than the frame so it moves with it. */
  .corner-se::after {
    content: '';
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 9px;
    height: 9px;
    opacity: 0.55;
    background:
      linear-gradient(
        135deg,
        transparent 0 45%,
        var(--placeholder-color, #5b8db8) 45% 60%,
        transparent 60% 100%
      ),
      linear-gradient(
        135deg,
        transparent 0 70%,
        var(--placeholder-color, #5b8db8) 70% 85%,
        transparent 85% 100%
      );
  }

  /* ── Close button (top-right corner exclusively) ────────── */
  .close-btn {
    position: absolute;
    top: 0;
    right: 0;
    width: 34px;
    height: 34px;
    z-index: 12;
    background: transparent;
    border: none;
    color: #c0392b;
    font-size: 13px;
    cursor: pointer;
    touch-action: manipulation;
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

  /* ── Header bar ─────────────────────────────────────────────
     Reads from the same variables the editor does, so a custom Notes theme
     carries the header with it instead of leaving a blue lip on top. The
     fallbacks are the sticky note's own pale blue, which is what shows on the
     default theme. */
  .note-header {
    display: flex;
    align-items: center;
    gap: 6px;
    /* Nothing to dodge on the left any more — no resize handle shares this bar.
       Right clears the close button. */
    padding: 4px 38px 4px 10px;
    background: var(--toolbar-bg, #d1e3f5);
    border-bottom: 1px solid var(--border-color, #bed5eb);
    flex-shrink: 0;
    /* Tall enough to be a thumb-sized drag target rather than a label. */
    min-height: 34px;
    border-radius: 4px 4px 0 0;
    cursor: grab;
    /* Without this a finger drag scrolls the chapter instead of moving the
       note. Same reason as Window.svelte's title bar. */
    touch-action: none;
  }

  .note-header:focus {
    outline: none;
  }

  .note-header.dragging {
    cursor: grabbing;
  }

  /* Grip dots: two columns of three, the standard "this drags" mark. */
  .drag-grip {
    flex-shrink: 0;
    width: 7px;
    height: 15px;
    opacity: 0.5;
    background-image: radial-gradient(
      circle,
      var(--text-color, #2c5282) 1px,
      transparent 1.2px
    );
    background-size: 4px 5px;
    background-position: 0 0;
  }

  .note-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-color, #2c5282);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .save-status {
    font-size: 12px;
    color: var(--placeholder-color, #4a6fa5);
    flex-shrink: 0;
  }

  .save-status.dirty {
    font-size: 18px;
    color: var(--accent-color, #4a90d9);
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
    /* Pale sky-blue — barely tinted, so it reads as paper rather than as a
       blue box, while still being obviously a sticky note. */
    background-color: #e4f1fa;
    /* CSS custom-property defaults consumed by LexicalEditor. A custom Notes
       theme sets the same variables inline on the editor itself, which is a
       closer ancestor, so these are only what the default theme looks like. */
    --background-color: transparent;
    --toolbar-bg: #d7e7f5;
    --border-color: #bed5eb;
    --button-bg: #e4f1fa;
    --button-hover-bg: #d1e3f5;
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
