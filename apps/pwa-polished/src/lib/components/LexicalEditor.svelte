<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  // Aliased on import: Svelte reserves the $ prefix for store subscriptions,
  // so the Lexical naming convention can't be used as a local binding here.
  import { BibleRefNode, $isBibleRefNode as isBibleRefNode } from '../lexical/BibleRefNode';
  import {
    registerBibleRefTransforms,
    $expandRef as expandRefNode,
    $collapseRef as collapseRefNode,
  } from '../lexical/bibleRefTransforms';
  import { CaretUp, Palette } from 'phosphor-svelte';
  import EditorThemePanel from './EditorThemePanel.svelte';
  import { editorThemeVars } from '../editorTheme';
  import { isTextEntry } from '../isTextEntry';
  import {
    getEditorTheme, updateEditorTheme, getEditorBarHidden, setEditorBarHidden,
    DEFAULT_EDITOR_THEME, type EditorSurface, type EditorThemeSettings,
  } from '../../adapters/settings';

  export let value: string = '';
  export let placeholder: string = 'Start writing...';
  export let isDirty: boolean = false;
  /**
   * Which writing surface this editor is. Drives the personal theme and the
   * slide-away toolbar; leaving it unset gives the plain editor exactly as it
   * was before either existed.
   *
   * Verse sticky notes pass 'notes' on purpose — they are a child of the Notes
   * window and wear whatever it is wearing.
   */
  export let surface: EditorSurface | null = null;
  /** Human name for the surface, used in the theme panel's heading. */
  export let surfaceLabel: string = '';

  const dispatch = createEventDispatcher();

  // ── Personal theme + slide-away toolbar ───────────────────────────────────

  /**
   * Broadcast so sibling editors on the same surface keep in step — changing
   * the Notes theme in the pane has to reach any open sticky note, and hiding
   * the toolbar in one should hide it in the other.
   */
  const SURFACE_EVENT = 'editorSurfaceUpdated';

  let theme: EditorThemeSettings = surface ? getEditorTheme(surface) : { ...DEFAULT_EDITOR_THEME };
  let barHidden = surface ? getEditorBarHidden(surface) : false;
  let themeOpen = false;

  /** Nothing is set at all for the default theme, so it stays exactly as shipped. */
  $: themeStyle = surface ? editorThemeVars(theme) : '';

  let toolbarEl: HTMLDivElement;
  /** Measured toolbar height — it wraps to two rows on a narrow phone, so a
      guessed number would leave the slide short or overshooting. */
  let barH = 0;
  /** Suppresses the transition until the first real measurement has landed,
      so the toolbar doesn't animate open on mount. */
  let animate = false;
  let barObserver: ResizeObserver | null = null;

  function measureBar() {
    if (toolbarEl) barH = toolbarEl.offsetHeight;
  }

  function toggleBar() {
    if (!surface) return;
    barHidden = !barHidden;
    // A picker floating over a canvas you just cleared makes no sense.
    if (barHidden) themeOpen = false;
    setEditorBarHidden(surface, barHidden);
    announceSurface();
  }

  function announceSurface() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(SURFACE_EVENT, { detail: surface }));
  }

  // Persist theme edits. Debounced because a colour drag fires continuously,
  // and localStorage plus the Supabase push don't need every tick of it.
  const THEME_PERSIST_MS = 200;
  let themeHydrated = false;
  let lastPersisted = surface ? JSON.stringify(theme) : '';
  let themeTimer: ReturnType<typeof setTimeout> | null = null;

  function flushTheme() {
    if (themeTimer) { clearTimeout(themeTimer); themeTimer = null; }
    if (!surface) return;
    const json = JSON.stringify(theme);
    if (json === lastPersisted) return;
    lastPersisted = json;
    updateEditorTheme(surface, theme);
    announceSurface();
  }

  function scheduleThemePersist() {
    if (themeTimer) clearTimeout(themeTimer);
    themeTimer = setTimeout(() => { themeTimer = null; flushTheme(); }, THEME_PERSIST_MS);
  }

  $: if (surface && themeHydrated) { theme; scheduleThemePersist(); }

  /**
   * Re-read after a sibling editor changed this surface, or after a sync pull
   * applied newer settings from another device.
   */
  function refreshFromStorage(e: Event) {
    if (!surface) return;
    if (e.type === SURFACE_EVENT && (e as CustomEvent).detail !== surface) return;
    const next = getEditorTheme(surface);
    const json = JSON.stringify(next);
    if (json !== lastPersisted) {
      // Adopt it as already-persisted so the reactive block doesn't echo it back.
      lastPersisted = json;
      theme = next;
    }
    barHidden = getEditorBarHidden(surface);
  }

  let editorInput: HTMLDivElement;
  let editor: any;
  let isSettingContent = false;

  // Toolbar active state
  let activeFormats = new Set<string>();
  let activeAlign = 'left';
  let fontSize = '16';

  // Stored for pointerdown re-apply (assigned in onMount)
  let lexGetSelection: any = null;
  let lexIsRangeSelection: any = null;
  let lexGetNodeByKey: any = null;

  /** Print the verse inside a reference and lock the pair. */
  export function expandRef(key: string, verseText: string) {
    if (!editor || !lexGetNodeByKey) return;
    editor.update(() => {
      const node = lexGetNodeByKey(key);
      if (isBibleRefNode(node)) expandRefNode(node, verseText);
    });
  }

  /** Strip the verse back off and hand the reference back to the keyboard. */
  export function collapseRef(key: string) {
    if (!editor || !lexGetNodeByKey) return;
    editor.update(() => {
      const node = lexGetNodeByKey(key);
      if (isBibleRefNode(node)) collapseRefNode(node);
    });
  }

  // Cleanup functions — no window globals, supports multiple instances
  const cleanupFns: Array<() => void> = [];

  export function focus() {
    editor?.focus();
  }

  export function setContent(html: string) {
    if (!editor) return;
    isSettingContent = true;
    Promise.all([import('lexical'), import('@lexical/html')]).then(
      ([{ $getRoot, $insertNodes }, { $generateNodesFromDOM }]) => {
        editor.update(
          () => {
            const dom = new DOMParser().parseFromString(html || '<p></p>', 'text/html');
            const nodes = $generateNodesFromDOM(editor, dom);
            $getRoot().clear();
            $insertNodes(nodes);
          },
          { onUpdate: () => { isSettingContent = false; } }
        );
        const root = editor.getRootElement();
        if (root && document.activeElement !== root) {
          setTimeout(() => {
            // Re-check on the way in, not just on the way out. Loading content
            // is often the same moment a title or search field is being clicked
            // — 50ms later the user is mid-word, and grabbing focus here takes
            // the caret out from under them.
            const active = document.activeElement;
            if (active && active !== root && isTextEntry(active)) return;
            editor.focus();
          }, 50);
        }
      }
    );
  }

  function stopProp(e: MouseEvent) { e.stopPropagation(); }

  onMount(async () => {
    // Measure before anything awaits, so the toolbar is at its real height on
    // the first paint rather than snapping open a tick later.
    measureBar();
    if (typeof ResizeObserver !== 'undefined' && toolbarEl) {
      barObserver = new ResizeObserver(measureBar);
      barObserver.observe(toolbarEl);
    }
    requestAnimationFrame(() => { animate = true; });
    themeHydrated = true;

    if (surface) {
      window.addEventListener(SURFACE_EVENT, refreshFromStorage);
      window.addEventListener('settingsUpdated', refreshFromStorage);
    }

    try {
      const [
        lexicalModule,
        htmlModule,
        richTextModule,
        historyModule,
        selectionModule,
      ] = await Promise.all([
        import('lexical'),
        import('@lexical/html'),
        import('@lexical/rich-text'),
        import('@lexical/history'),
        import('@lexical/selection'),
      ]);

      const {
        createEditor,
        $getRoot,
        $insertNodes,
        $getSelection,
        $isRangeSelection,
        FORMAT_TEXT_COMMAND,
        FORMAT_ELEMENT_COMMAND,
        UNDO_COMMAND,
        REDO_COMMAND,
        $getNearestNodeFromDOMNode,
        $getNodeByKey,
      } = lexicalModule;
      lexGetNodeByKey = $getNodeByKey;
      const { $patchStyleText, $getSelectionStyleValueForProperty } = selectionModule;
      const { $generateHtmlFromNodes, $generateNodesFromDOM } = htmlModule;
      lexGetSelection = $getSelection;
      lexIsRangeSelection = $isRangeSelection;
      const { registerRichText } = richTextModule;
      const { createEmptyHistoryState, registerHistory } = historyModule;

      editor = createEditor({
        namespace: 'JournalEditor',
        // BibleRefNode makes a typed reference a real thing the editor knows
        // about, so it survives editing and round-trips through save/reload.
        nodes: [BibleRefNode],
        theme: {
          paragraph: 'editor-paragraph',
          text: {
            bold: 'editor-text-bold',
            italic: 'editor-text-italic',
            underline: 'editor-text-underline',
            strikethrough: 'editor-text-strikethrough',
            superscript: 'editor-text-superscript',
            subscript: 'editor-text-subscript',
          },
        },
        onError: (error: Error) => console.error('Lexical error:', error),
      });

      editorInput.setAttribute('role', 'textbox');
      editorInput.setAttribute('aria-multiline', 'true');
      editorInput.setAttribute('data-placeholder', placeholder);
      editor.setRootElement(editorInput);

      cleanupFns.push(registerRichText(editor));
      cleanupFns.push(registerHistory(editor, createEmptyHistoryState(), 300));
      cleanupFns.push(registerBibleRefTransforms(editor));

      editorInput.addEventListener('blur', () => dispatch('blur'));

      // Clicking a reference asks the host what to do with it, rather than
      // acting here — the popover belongs to whoever mounted this editor.
      editorInput.addEventListener('click', (e: MouseEvent) => {
        const el = (e.target as HTMLElement | null)?.closest?.('.bible-ref') as HTMLElement | null;
        // A pending link is mid-edit with no destination — leave the click alone
        // so it just places the caret.
        if (!el || el.classList.contains('is-pending')) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();

        // Which Lexical node is this element? Must be editor.read(), not
        // editorState.read() — the lookup needs the editor itself, and the
        // state-only form throws. Isolated in a try because only expand and
        // collapse need the key; navigating uses the attributes below, so a
        // failure here costs one feature rather than the whole menu.
        let key = '';
        try {
          editor.read(() => {
            key = $getNearestNodeFromDOMNode(el)?.getKey() ?? '';
          });
        } catch (err) {
          console.warn('[LexicalEditor] Could not resolve reference node:', err);
        }

        dispatch('refClick', {
          key,
          ref: el.getAttribute('data-ref') ?? '',
          book: el.getAttribute('data-book') ?? '',
          chapter: parseInt(el.getAttribute('data-chapter') ?? '1', 10),
          verse: parseInt(el.getAttribute('data-verse') ?? '1', 10),
          expanded: el.getAttribute('data-expanded') === 'true',
          x: rect.left + rect.width / 2,
          y: rect.top,
        });
      });

      // Re-apply active pending formats when user clicks a new cursor position
      editorInput.addEventListener('pointerdown', () => {
        if (activeFormats.size === 0) return;
        requestAnimationFrame(() => {
          if (!editor) return;
          editor.update(() => {
            const sel = lexGetSelection();
            if (!lexIsRangeSelection(sel)) return;
            activeFormats.forEach((f: string) => {
              if (!sel.hasFormat(f)) sel.formatText(f);
            });
          });
        });
      });

      if (value) {
        editor.update(() => {
          const dom = new DOMParser().parseFromString(value, 'text/html');
          const nodes = $generateNodesFromDOM(editor, dom);
          $getRoot().clear();
          $insertNodes(nodes);
        });
      }

      // Update listener: track active formats + emit changes
      cleanupFns.push(
        editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }: any) => {
          if (isSettingContent) return;
          if (dirtyElements.size > 0 || dirtyLeaves.size > 0) isDirty = true;

          editorState.read(() => {
            const sel = $getSelection();

            if ($isRangeSelection(sel)) {
              // Block alignment
              try {
                const anchor = sel.anchor.getNode();
                const element = anchor.getKey() === 'root' ? anchor : anchor.getTopLevelElementOrThrow();
                const fmt = (element as any).getFormatType?.();
                activeAlign = fmt || 'left';
              } catch {}

              // Font size
              const rawSize = $getSelectionStyleValueForProperty(sel as any, 'font-size', '');
              if (rawSize) fontSize = rawSize.replace('px', '');
            }

            const html = $generateHtmlFromNodes(editor, null);
            dispatch('change', html);
          });
        })
      );

      // Expose commands for toolbar buttons
      (editor as any).__lexCmd = {
        FORMAT_TEXT_COMMAND,
        FORMAT_ELEMENT_COMMAND,
        UNDO_COMMAND,
        REDO_COMMAND,
        $patchStyleText,
        $getSelection,
        $isRangeSelection,
      };
    } catch (error) {
      console.error('Failed to initialize Lexical editor:', error);
    }
  });

  onDestroy(() => {
    cleanupFns.forEach(fn => { try { fn(); } catch {} });
    try { editor?.setRootElement(null); } catch {}
    barObserver?.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener(SURFACE_EVENT, refreshFromStorage);
      window.removeEventListener('settingsUpdated', refreshFromStorage);
    }
    // A theme edited right up to the moment the pane closed still counts.
    flushTheme();
  });

  // --- Toolbar action helpers ---

  function fmt(format: string) {
    if (!editor) return;
    const next = new Set(activeFormats);
    if (next.has(format)) next.delete(format); else next.add(format);
    activeFormats = next;
    editor.dispatchCommand(editor.__lexCmd.FORMAT_TEXT_COMMAND, format);
    editor.focus();
  }

  function undo() { editor?.dispatchCommand(editor.__lexCmd.UNDO_COMMAND, undefined); editor?.focus(); }
  function redo() { editor?.dispatchCommand(editor.__lexCmd.REDO_COMMAND, undefined); editor?.focus(); }

  function alignBlock(type: string) {
    if (!editor) return;
    editor.dispatchCommand(editor.__lexCmd.FORMAT_ELEMENT_COMMAND, type);
    editor.focus();
  }

  function setFontSize(val: string) {
    if (!editor || !val) return;
    const { $patchStyleText, $getSelection, $isRangeSelection } = editor.__lexCmd;
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        $patchStyleText(sel, { 'font-size': val + 'px' });
      }
    });
    fontSize = val;
    editor.focus();
  }
</script>

<div class="lexical-editor" style={themeStyle}>
  <!-- The wrapper is what actually slides: it clips to a measured height so
       the toolbar can wrap to two rows and still land exactly. `inert` keeps
       the hidden buttons out of the tab order while they are clipped away. -->
  <div
    class="toolbar-wrap"
    class:animated={animate}
    style={surface ? `height: ${barHidden ? 0 : barH}px` : ''}
    inert={barHidden || undefined}
  >
    <div class="toolbar" bind:this={toolbarEl}>
      <!-- Undo / Redo -->
      <button on:mousedown|preventDefault on:click={undo} title="Undo (Ctrl+Z)" aria-label="Undo" type="button">↩</button>
      <button on:mousedown|preventDefault on:click={redo} title="Redo (Ctrl+Y)" aria-label="Redo" type="button">↪</button>

      <span class="sep"></span>

      <!-- Inline formats -->
      <button
        on:mousedown|preventDefault
        on:click={() => fmt('bold')}
        title="Bold (Ctrl+B)"
        aria-label="Bold"
        type="button"
        class:active={activeFormats.has('bold')}
      ><strong>B</strong></button>
      <button
        on:mousedown|preventDefault
        on:click={() => fmt('italic')}
        title="Italic (Ctrl+I)"
        aria-label="Italic"
        type="button"
        class:active={activeFormats.has('italic')}
      ><em>I</em></button>
      <button
        on:mousedown|preventDefault
        on:click={() => fmt('underline')}
        title="Underline (Ctrl+U)"
        aria-label="Underline"
        type="button"
        class:active={activeFormats.has('underline')}
      ><u>U</u></button>
      <button
        on:mousedown|preventDefault
        on:click={() => fmt('strikethrough')}
        title="Strikethrough"
        aria-label="Strikethrough"
        type="button"
        class:active={activeFormats.has('strikethrough')}
      ><s>S</s></button>
      <button
        on:mousedown|preventDefault
        on:click={() => fmt('superscript')}
        title="Superscript"
        aria-label="Superscript"
        type="button"
        class:active={activeFormats.has('superscript')}
      >x<sup>2</sup></button>
      <button
        on:mousedown|preventDefault
        on:click={() => fmt('subscript')}
        title="Subscript"
        aria-label="Subscript"
        type="button"
        class:active={activeFormats.has('subscript')}
      >x<sub>2</sub></button>

      <span class="sep"></span>

      <!-- Alignment -->
      <button on:mousedown|preventDefault on:click={() => alignBlock('left')} title="Align left" aria-label="Align left" type="button" class:active={activeAlign === 'left'}>
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="0" y="0" width="14" height="2" rx="1" fill="currentColor"/>
          <rect x="0" y="5" width="9" height="2" rx="1" fill="currentColor"/>
          <rect x="0" y="10" width="11" height="2" rx="1" fill="currentColor"/>
        </svg>
      </button>
      <button on:mousedown|preventDefault on:click={() => alignBlock('center')} title="Align center" aria-label="Align center" type="button" class:active={activeAlign === 'center'}>
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="0" y="0" width="14" height="2" rx="1" fill="currentColor"/>
          <rect x="2.5" y="5" width="9" height="2" rx="1" fill="currentColor"/>
          <rect x="1.5" y="10" width="11" height="2" rx="1" fill="currentColor"/>
        </svg>
      </button>
      <button on:mousedown|preventDefault on:click={() => alignBlock('right')} title="Align right" aria-label="Align right" type="button" class:active={activeAlign === 'right'}>
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="0" y="0" width="14" height="2" rx="1" fill="currentColor"/>
          <rect x="5" y="5" width="9" height="2" rx="1" fill="currentColor"/>
          <rect x="3" y="10" width="11" height="2" rx="1" fill="currentColor"/>
        </svg>
      </button>

      <span class="sep"></span>

      <!-- Font size -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <select
        class="toolbar-select"
        value={fontSize}
        on:change={(e) => setFontSize((e.target as HTMLSelectElement).value)}
        on:mousedown={stopProp}
        title="Font size"
        aria-label="Font size"
      >
        {#each ['10','12','14','16','18','20','24','28','32'] as sz}
          <option value={sz}>{sz}</option>
        {/each}
      </select>

      <!-- Colors and typeface ride along with the rest of the text options. -->
      {#if surface}
        <button
          on:mousedown|preventDefault
          on:click={() => (themeOpen = !themeOpen)}
          title="Colors and typeface"
          aria-label="Colors and typeface"
          aria-expanded={themeOpen}
          type="button"
          class:active={themeOpen}
        ><Palette size={14} weight="bold" /></button>
      {/if}

      {#if isDirty}
        <span class="dirty-indicator" title="Unsaved changes">●</span>
      {/if}
    </div>
  </div>

  <!-- The bumper stays put while the toolbar slides behind it — the pill is
       the only handle, so it must never be the thing that disappears. -->
  {#if surface}
    <div class="bumper">
      <button
        class="bumper-pill"
        class:animated={animate}
        type="button"
        on:mousedown|preventDefault|stopPropagation
        on:click={toggleBar}
        aria-expanded={!barHidden}
        title={barHidden ? 'Show formatting' : 'Hide formatting'}
        aria-label={barHidden ? 'Show formatting toolbar' : 'Hide formatting toolbar'}
      >
        <span class="bumper-caret" class:flipped={barHidden}>
          <CaretUp size={11} weight="bold" />
        </span>
      </button>
    </div>
  {/if}

  <div class="editor-area">
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="editor-content"
      on:mousedown={stopProp}
      on:mouseup={stopProp}
      on:click={stopProp}
    >
      <div
        bind:this={editorInput}
        class="editor-input"
        contenteditable="true"
      ></div>
    </div>

    {#if surface && themeOpen}
      <EditorThemePanel
        bind:theme
        surfaceLabel={surfaceLabel || surface}
        on:close={() => (themeOpen = false)}
      />
    {/if}
  </div>
</div>

<style>
  .lexical-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-color, #fff);

    /* A stone door rolling aside, not a menu snapping shut. Roughly three
       times a normal UI slide: gentle to start, carries through the middle,
       and settles rather than stopping dead. */
    --slide-ms: 750ms;
    --slide-ease: cubic-bezier(0.5, 0.02, 0.2, 1);
  }

  /* Clips the toolbar to a measured height so it can slide away. Height is set
     inline; the transition only switches on after the first measurement, which
     is what stops it animating open on mount. */
  .toolbar-wrap {
    flex-shrink: 0;
    overflow: hidden;
  }
  .toolbar-wrap.animated {
    transition: height var(--slide-ms) var(--slide-ease);
  }

  /* ── Bumper ──────────────────────────────────────────────────────────────
     A thin lip below the toolbar with one pill in the middle. It never moves,
     so there is always something to grab once the toolbar is gone. */
  .bumper {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 14px;
    background: var(--toolbar-bg, #f5f5f5);
    border-bottom: 1px solid var(--border-color, #ddd);
  }

  .bumper-pill {
    /* Visually a small lozenge, but the negative margins give it a full-height
       hit area — 14px of bumper is not a touch target. */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 26px;
    margin: -6px 0;
    padding: 0;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 13px;
    background: var(--button-bg, #fff);
    color: var(--text-color, #222);
    opacity: 0.65;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
  }
  .bumper-pill:hover {
    opacity: 1;
    background: var(--button-hover-bg, #e8e8e8);
  }
  .bumper-pill:focus-visible {
    outline: 2px solid var(--accent-color, #007aff);
    outline-offset: 2px;
    opacity: 1;
  }

  /* Rotates over the same stretch as the slide, so the pill and the wall read
     as one movement rather than an icon swap at the end. */
  .bumper-caret {
    display: flex;
  }
  .bumper-pill.animated .bumper-caret {
    transition: transform var(--slide-ms) var(--slide-ease);
  }
  .bumper-caret.flipped {
    transform: rotate(180deg);
  }

  /* Anything this slow is worse than nothing for someone who asked for less
     motion — snap instead. */
  @media (prefers-reduced-motion: reduce) {
    .toolbar-wrap.animated,
    .bumper-pill.animated .bumper-caret {
      transition-duration: 0.01ms;
    }
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color, #ddd);
    background: var(--toolbar-bg, #f5f5f5);
    align-items: center;
    flex-shrink: 0;
  }

  .toolbar button {
    padding: 4px 8px;
    border: 1px solid var(--border-color, #ddd);
    background: var(--button-bg, white);
    color: var(--text-color, #222);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1.4;
    transition: background 0.15s;
    min-width: 28px;
    min-height: 28px;
    white-space: nowrap;
  }

  .toolbar button:hover {
    background: var(--button-hover-bg, #e8e8e8);
  }

  .toolbar button:active {
    transform: scale(0.95);
  }

  .toolbar button.active {
    background: var(--accent-color, #007aff);
    color: white;
    border-color: var(--accent-color, #007aff);
  }

  .sep {
    width: 1px;
    height: 20px;
    background: var(--border-color, #ddd);
    flex-shrink: 0;
    margin: 0 2px;
  }

  .toolbar-select {
    padding: 3px 4px;
    border: 1px solid var(--border-color, #ddd);
    background: var(--button-bg, white);
    color: var(--text-color, #222);
    border-radius: 4px;
    font-size: 13px;
    min-height: 28px;
    cursor: pointer;
  }

  .dirty-indicator {
    color: var(--accent-color, #007aff);
    font-size: 20px;
    margin-left: auto;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Positioning context for the theme panel. It has to sit outside
     .editor-content, whose own scrolling would carry an inset overlay up and
     down the page with the text. */
  .editor-area {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .editor-content {
    flex: 1;
    overflow-y: auto;
    position: relative;
  }

  :global(.editor-input) {
    padding: 16px;
    min-height: 100%;
    font-family: var(--font-family, 'Milonga', cursive);
    font-size: var(--font-size, 16px);
    /* A variable so a chosen face can carry its own leading — Rock Salt and
       Gloria Hallelujah crowd themselves at 1.6. Unset for every other case. */
    line-height: var(--editor-lead, 1.6);
    color: var(--text-color, #222);
    outline: none;
  }

  :global(.editor-input[data-placeholder]:empty::before) {
    content: attr(data-placeholder);
    color: var(--placeholder-color, #999);
    opacity: 0.5;
    pointer-events: none;
    position: absolute;
  }

  :global(.editor-paragraph) {
    margin: 0 0 8px 0;
  }
  :global(.editor-paragraph:last-child) {
    margin-bottom: 0;
  }

  /* Inline text */
  :global(.editor-text-bold) { font-weight: bold; }
  :global(.editor-text-italic) { font-style: italic; }
  :global(.editor-text-underline) { text-decoration: underline; }
  :global(.editor-text-strikethrough) { text-decoration: line-through; }
  :global(.editor-text-superscript) { font-size: 0.75em; vertical-align: super; }
  :global(.editor-text-subscript) { font-size: 0.75em; vertical-align: sub; }

  /* Bible references. --ref-color is the book's own category colour, set on the
     element by BibleRefNode, so a gospel reads gospel-red and so on. */
  :global(.bible-ref) {
    color: var(--ref-color, #c0392b);
    cursor: pointer;
    border-bottom: 1px dotted currentColor;
  }

  :global(.bible-ref:hover) {
    background: color-mix(in srgb, var(--ref-color, #c0392b) 14%, transparent);
    border-radius: 3px;
  }

  /* Mid-edit, nothing to point at yet. Still reads as one piece, but doesn't
     pretend to be a working link. */
  :global(.bible-ref.is-pending) {
    border-bottom: 1px dotted transparent;
    cursor: text;
    opacity: 0.75;
  }

  :global(.bible-ref.is-pending:hover) {
    background: none;
  }

  /* Expanded: the verse text rides along in italic, one shade quieter. */
  :global(.bible-ref.is-expanded) {
    border-bottom: none;
  }

  :global(.bible-ref.is-expanded > span:last-child),
  :global(.bible-ref.is-expanded) {
    font-style: italic;
  }

  :global(.bible-ref.is-expanded)::selection,
  :global(.bible-ref.is-expanded *)::selection {
    background: color-mix(in srgb, var(--ref-color, #c0392b) 30%, transparent);
  }
</style>
