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
  let activeBlock = 'paragraph';

  // Link prompt
  let showLinkPrompt = false;
  let linkUrl = '';

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
        listModule,
        linkModule,
        selectionModule,
      ] = await Promise.all([
        import('lexical'),
        import('@lexical/html'),
        import('@lexical/rich-text'),
        import('@lexical/history'),
        import('@lexical/list'),
        import('@lexical/link'),
        import('@lexical/selection'),
      ]);

      const {
        createEditor,
        $getRoot,
        $insertNodes,
        $getSelection,
        $isRangeSelection,
        FORMAT_TEXT_COMMAND,
        UNDO_COMMAND,
        REDO_COMMAND,
      } = lexicalModule;
      const { $generateHtmlFromNodes, $generateNodesFromDOM } = htmlModule;
      const { registerRichText } = richTextModule;
      const { $setBlocksType } = selectionModule;
      const { createEmptyHistoryState, registerHistory } = historyModule;
      const {
        ListNode,
        ListItemNode,
        $isListNode,
        INSERT_ORDERED_LIST_COMMAND,
        INSERT_UNORDERED_LIST_COMMAND,
        INSERT_CHECK_LIST_COMMAND,
        REMOVE_LIST_COMMAND,
        registerList,
      } = listModule;
      const { LinkNode, AutoLinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } = linkModule;

      editor = createEditor({
        namespace: 'JournalEditor',
        nodes: [ListNode, ListItemNode, LinkNode, AutoLinkNode],
        theme: {
          paragraph: 'editor-paragraph',
          heading: {
            h1: 'editor-h1',
            h2: 'editor-h2',
            h3: 'editor-h3',
            h4: 'editor-h4',
          },
          list: {
            ol: 'editor-list-ol',
            ul: 'editor-list-ul',
            listitem: 'editor-listitem',
            listitemChecked: 'editor-listitem-checked',
            listitemUnchecked: 'editor-listitem-unchecked',
            nested: { listitem: 'editor-nested-listitem' },
          },
          text: {
            bold: 'editor-text-bold',
            italic: 'editor-text-italic',
            underline: 'editor-text-underline',
            strikethrough: 'editor-text-strikethrough',
            superscript: 'editor-text-superscript',
            subscript: 'editor-text-subscript',
          },
          link: 'editor-link',
        },
        onError: (error: Error) => console.error('Lexical error:', error),
      });

      editorInput.setAttribute('role', 'textbox');
      editorInput.setAttribute('aria-multiline', 'true');
      editorInput.setAttribute('data-placeholder', placeholder);
      editor.setRootElement(editorInput);

      cleanupFns.push(registerRichText(editor));
      cleanupFns.push(registerHistory(editor, createEmptyHistoryState(), 300));
      cleanupFns.push(registerList(editor));

      editorInput.addEventListener('blur', () => dispatch('blur'));

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
            const newFormats = new Set<string>();
            let block = 'paragraph';

            if ($isRangeSelection(sel)) {
              if (sel.hasFormat('bold')) newFormats.add('bold');
              if (sel.hasFormat('italic')) newFormats.add('italic');
              if (sel.hasFormat('underline')) newFormats.add('underline');
              if (sel.hasFormat('strikethrough')) newFormats.add('strikethrough');
              if (sel.hasFormat('superscript')) newFormats.add('superscript');
              if (sel.hasFormat('subscript')) newFormats.add('subscript');

              const anchorNode = sel.anchor.getNode();
              const element =
                anchorNode.getKey() === 'root'
                  ? anchorNode
                  : anchorNode.getTopLevelElementOrThrow();

              if ($isListNode(element)) {
                const parent = anchorNode.getParent();
                if ($isListNode(parent)) {
                  const listType = parent.getListType();
                  block = listType === 'check' ? 'check' : listType === 'number' ? 'number' : 'bullet';
                }
              } else {
                const tag = (element as any).getTag?.();
                if (tag) block = tag; // h1, h2, h3, h4
              }

              // Link detection
              const node = sel.anchor.getNode();
              if ($isLinkNode(node) || $isLinkNode(node.getParent())) {
                newFormats.add('link');
              }
            }

            activeFormats = newFormats;
            activeBlock = block;

            const html = $generateHtmlFromNodes(editor, null);
            dispatch('change', html);
          });
        })
      );

      // Expose commands for toolbar buttons on the module
      (editor as any).__lexCmd = {
        FORMAT_TEXT_COMMAND,
        UNDO_COMMAND,
        REDO_COMMAND,
        INSERT_ORDERED_LIST_COMMAND,
        INSERT_UNORDERED_LIST_COMMAND,
        INSERT_CHECK_LIST_COMMAND,
        REMOVE_LIST_COMMAND,
        TOGGLE_LINK_COMMAND,
        $setBlocksType,
        $getSelection,
        $isRangeSelection,
        HeadingNode: richTextModule.HeadingNode,
        $createHeadingNode: richTextModule.$createHeadingNode,
        $createParagraphNode: lexicalModule.$createParagraphNode,
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
    const { FORMAT_TEXT_COMMAND } = editor.__lexCmd;
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    editor.focus();
  }

  function undo() { editor?.dispatchCommand(editor.__lexCmd.UNDO_COMMAND, undefined); editor?.focus(); }
  function redo() { editor?.dispatchCommand(editor.__lexCmd.REDO_COMMAND, undefined); editor?.focus(); }

  function setBlock(type: string) {
    if (!editor) return;
    const cmd = editor.__lexCmd;
    if (type === 'bullet') {
      editor.dispatchCommand(
        activeBlock === 'bullet' ? cmd.REMOVE_LIST_COMMAND : cmd.INSERT_UNORDERED_LIST_COMMAND,
        undefined
      );
    } else if (type === 'number') {
      editor.dispatchCommand(
        activeBlock === 'number' ? cmd.REMOVE_LIST_COMMAND : cmd.INSERT_ORDERED_LIST_COMMAND,
        undefined
      );
    } else if (type === 'check') {
      editor.dispatchCommand(
        activeBlock === 'check' ? cmd.REMOVE_LIST_COMMAND : cmd.INSERT_CHECK_LIST_COMMAND,
        undefined
      );
    } else if (type === 'paragraph') {
      editor.update(() => {
        const sel = cmd.$getSelection();
        if (cmd.$isRangeSelection(sel)) {
          cmd.$setBlocksType(sel, () => cmd.$createParagraphNode());
        }
      });
    } else {
      // Heading h1-h4
      editor.update(() => {
        const sel = cmd.$getSelection();
        if (cmd.$isRangeSelection(sel)) {
          if (activeBlock === type) {
            cmd.$setBlocksType(sel, () => cmd.$createParagraphNode());
          } else {
            cmd.$setBlocksType(sel, () => cmd.$createHeadingNode(type));
          }
        }
      });
    }
    editor.focus();
  }

  function handleLinkButton() {
    if (!editor) return;
    if (activeFormats.has('link')) {
      editor.dispatchCommand(editor.__lexCmd.TOGGLE_LINK_COMMAND, null);
      editor.focus();
    } else {
      showLinkPrompt = true;
      linkUrl = 'https://';
    }
  }

  function confirmLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    editor.dispatchCommand(
      editor.__lexCmd.TOGGLE_LINK_COMMAND,
      url && url !== 'https://' ? url : null
    );
    showLinkPrompt = false;
    linkUrl = '';
    editor.focus();
  }

  function cancelLink() {
    showLinkPrompt = false;
    linkUrl = '';
    editor.focus();
  }
</script>

<div class="lexical-editor">
  <div class="toolbar">
    <!-- Undo / Redo -->
    <button on:click={undo} title="Undo (Ctrl+Z)" aria-label="Undo" type="button">↩</button>
    <button on:click={redo} title="Redo (Ctrl+Y)" aria-label="Redo" type="button">↪</button>

    <span class="sep"></span>

    <!-- Block type -->
    <button
      on:click={() => setBlock('paragraph')}
      title="Normal paragraph"
      aria-label="Paragraph"
      type="button"
      class:active={activeBlock === 'paragraph'}
    >¶</button>
    <button
      on:click={() => setBlock('h1')}
      title="Heading 1"
      aria-label="Heading 1"
      type="button"
      class:active={activeBlock === 'h1'}
    >H1</button>
    <button
      on:click={() => setBlock('h2')}
      title="Heading 2"
      aria-label="Heading 2"
      type="button"
      class:active={activeBlock === 'h2'}
    >H2</button>
    <button
      on:click={() => setBlock('h3')}
      title="Heading 3"
      aria-label="Heading 3"
      type="button"
      class:active={activeBlock === 'h3'}
    >H3</button>
    <button
      on:click={() => setBlock('h4')}
      title="Heading 4"
      aria-label="Heading 4"
      type="button"
      class:active={activeBlock === 'h4'}
    >H4</button>

    <span class="sep"></span>

    <!-- Inline formats -->
    <button
      on:click={() => fmt('bold')}
      title="Bold (Ctrl+B)"
      aria-label="Bold"
      type="button"
      class:active={activeFormats.has('bold')}
    ><strong>B</strong></button>
    <button
      on:click={() => fmt('italic')}
      title="Italic (Ctrl+I)"
      aria-label="Italic"
      type="button"
      class:active={activeFormats.has('italic')}
    ><em>I</em></button>
    <button
      on:click={() => fmt('underline')}
      title="Underline (Ctrl+U)"
      aria-label="Underline"
      type="button"
      class:active={activeFormats.has('underline')}
    ><u>U</u></button>
    <button
      on:click={() => fmt('strikethrough')}
      title="Strikethrough"
      aria-label="Strikethrough"
      type="button"
      class:active={activeFormats.has('strikethrough')}
    ><s>S</s></button>
    <button
      on:click={() => fmt('superscript')}
      title="Superscript"
      aria-label="Superscript"
      type="button"
      class:active={activeFormats.has('superscript')}
    >x<sup>2</sup></button>
    <button
      on:click={() => fmt('subscript')}
      title="Subscript"
      aria-label="Subscript"
      type="button"
      class:active={activeFormats.has('subscript')}
    >x<sub>2</sub></button>

    <span class="sep"></span>

    <!-- Lists -->
    <button
      on:click={() => setBlock('bullet')}
      title="Bullet list"
      aria-label="Bullet list"
      type="button"
      class:active={activeBlock === 'bullet'}
    >• List</button>
    <button
      on:click={() => setBlock('number')}
      title="Numbered list"
      aria-label="Numbered list"
      type="button"
      class:active={activeBlock === 'number'}
    >1. List</button>
    <button
      on:click={() => setBlock('check')}
      title="Checklist"
      aria-label="Checklist"
      type="button"
      class:active={activeBlock === 'check'}
    >☑ Check</button>

    <span class="sep"></span>

    <!-- Link -->
    <button
      on:click={handleLinkButton}
      title="Insert / remove link"
      aria-label="Link"
      type="button"
      class:active={activeFormats.has('link')}
    >🔗</button>

    {#if isDirty}
      <span class="dirty-indicator" title="Unsaved changes">●</span>
    {/if}
  </div>

  {#if showLinkPrompt}
    <div class="link-prompt">
      <input
        type="url"
        bind:value={linkUrl}
        placeholder="https://"
        on:keydown={(e) => { if (e.key === 'Enter') confirmLink(); if (e.key === 'Escape') cancelLink(); }}
        on:mousedown={stopProp}
        on:click={stopProp}
      />
      <button type="button" on:click={confirmLink}>OK</button>
      <button type="button" on:click={cancelLink}>✕</button>
    </div>
  {/if}

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

  .link-prompt {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    background: var(--toolbar-bg, #f5f5f5);
    border-bottom: 1px solid var(--border-color, #ddd);
    flex-shrink: 0;
  }

  .link-prompt input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    font-size: 13px;
    background: var(--button-bg, white);
    color: var(--text-color, #222);
  }

  .link-prompt button {
    padding: 4px 10px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    background: var(--button-bg, white);
    color: var(--text-color, #222);
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

  /* Headings */
  :global(.editor-h1) { font-size: 2em; font-weight: 700; margin: 0 0 8px 0; }
  :global(.editor-h2) { font-size: 1.5em; font-weight: 700; margin: 0 0 8px 0; }
  :global(.editor-h3) { font-size: 1.25em; font-weight: 600; margin: 0 0 8px 0; }
  :global(.editor-h4) { font-size: 1em; font-weight: 600; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; }

  /* Inline text */
  :global(.editor-text-bold) { font-weight: bold; }
  :global(.editor-text-italic) { font-style: italic; }
  :global(.editor-text-underline) { text-decoration: underline; }
  :global(.editor-text-strikethrough) { text-decoration: line-through; }
  :global(.editor-text-superscript) { font-size: 0.75em; vertical-align: super; }
  :global(.editor-text-subscript) { font-size: 0.75em; vertical-align: sub; }

  /* Lists */
  :global(.editor-list-ol) { list-style-type: decimal; padding-left: 24px; margin: 0 0 8px 0; }
  :global(.editor-list-ul) { list-style-type: disc; padding-left: 24px; margin: 0 0 8px 0; }
  :global(.editor-listitem) { margin: 2px 0; }
  :global(.editor-nested-listitem) { list-style-type: none; }

  /* Checklist */
  :global(.editor-listitem-checked),
  :global(.editor-listitem-unchecked) {
    position: relative;
    margin-left: 8px;
    padding-left: 24px;
    list-style-type: none;
    outline: none;
  }
  :global(.editor-listitem-unchecked::before),
  :global(.editor-listitem-checked::before) {
    content: '';
    width: 14px;
    height: 14px;
    top: 4px;
    left: 0;
    position: absolute;
    border: 1px solid #aaa;
    border-radius: 3px;
    background: white;
    cursor: pointer;
  }
  :global(.editor-listitem-checked::before) {
    background: var(--accent-color, #007aff);
    border-color: var(--accent-color, #007aff);
  }
  :global(.editor-listitem-checked::after) {
    content: '✓';
    position: absolute;
    top: 1px;
    left: 2px;
    font-size: 11px;
    color: white;
    font-weight: bold;
  }
  :global(.editor-listitem-checked > span) { text-decoration: line-through; opacity: 0.6; }

  /* Links */
  :global(.editor-link) {
    color: var(--accent-color, #007aff);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
