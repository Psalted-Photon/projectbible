<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';

  export let value: string = '';
  export let placeholder: string = 'Start writing...';
  export let isDirty: boolean = false;

  const dispatch = createEventDispatcher();

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
          setTimeout(() => editor.focus(), 50);
        }
      }
    );
  }

  function stopProp(e: MouseEvent) { e.stopPropagation(); }

  onMount(async () => {
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
      } = lexicalModule;
      const { $patchStyleText, $getSelectionStyleValueForProperty } = selectionModule;
      const { $generateHtmlFromNodes, $generateNodesFromDOM } = htmlModule;
      lexGetSelection = $getSelection;
      lexIsRangeSelection = $isRangeSelection;
      const { registerRichText } = richTextModule;
      const { createEmptyHistoryState, registerHistory } = historyModule;

      editor = createEditor({
        namespace: 'JournalEditor',
        nodes: [],
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

      editorInput.addEventListener('blur', () => dispatch('blur'));

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

<div class="lexical-editor">
  <div class="toolbar">
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

    {#if isDirty}
      <span class="dirty-indicator" title="Unsaved changes">●</span>
    {/if}
  </div>

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
</div>

<style>
  .lexical-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-color, #fff);
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

  .editor-content {
    flex: 1;
    overflow-y: auto;
    position: relative;
  }

  :global(.editor-input) {
    padding: 16px;
    min-height: 100%;
    font-family: var(--font-family, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    font-size: var(--font-size, 16px);
    line-height: 1.6;
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
</style>
