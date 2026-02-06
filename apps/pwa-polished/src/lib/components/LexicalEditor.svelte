<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  
  export let value: string = ''; // HTML input
  export let placeholder: string = 'Start writing...';
  export let isDirty: boolean = false; // Expose dirty state
  
  const dispatch = createEventDispatcher();
  
  let editorInput: HTMLDivElement;
  let editor: any;
  let initialValueSet = false;
  
  export function focus() {
    console.log('[LexicalEditor] focus() called');
    editor?.focus();
    setTimeout(() => {
      console.log('[LexicalEditor] After focus, activeElement:', document.activeElement);
    }, 100);
  }
  
  export function setContent(html: string) {
    if (!editor) return;
    
    console.log('[LexicalEditor] setContent called, html length:', html?.length || 0);
    console.log('[LexicalEditor] Before setContent, activeElement:', document.activeElement);
    
    import('lexical').then(({ $getRoot, $insertNodes }) => {
      import('@lexical/html').then(({ $generateNodesFromDOM }) => {
        editor.update(() => {
          const parser = new DOMParser();
          const dom = parser.parseFromString(html || '<p></p>', 'text/html');
          const nodes = $generateNodesFromDOM(editor, dom);
          const root = $getRoot();
          root.clear();
          $insertNodes(nodes);
        });
        
        // Focus after content is set, but only if not already focused
        // This avoids interrupting natural focus from clicks
        const rootElement = editor.getRootElement();
        console.log('[LexicalEditor] After content update, rootElement:', rootElement);
        console.log('[LexicalEditor] activeElement:', document.activeElement);
        console.log('[LexicalEditor] Should focus?', rootElement && document.activeElement !== rootElement);
        
        if (rootElement && document.activeElement !== rootElement) {
          setTimeout(() => {
            console.log('[LexicalEditor] Calling focus() after timeout');
            editor.focus();
            setTimeout(() => {
              console.log('[LexicalEditor] After focus timeout, activeElement:', document.activeElement);
            }, 100);
          }, 50);
        }
      });
    });
  }
  
  function handleMouseDown(e: MouseEvent) {
    console.log('[LexicalEditor] Wrapper mousedown - stopping propagation');
    e.stopPropagation();
  }
  
  function handleMouseUp(e: MouseEvent) {
    console.log('[LexicalEditor] Wrapper mouseup - stopping propagation');
    e.stopPropagation();
  }
  
  function handleClick(e: MouseEvent) {
    console.log('[LexicalEditor] Wrapper click - stopping propagation');
    e.stopPropagation();
  }
  
  onMount(async () => {
    try {
      // Dynamic import for code-splitting
      const [
        lexicalModule,
        htmlModule,
        richTextModule
      ] = await Promise.all([
        import('lexical'),
        import('@lexical/html'),
        import('@lexical/rich-text')
      ]);
      
      const { createEditor, $getRoot, $insertNodes } = lexicalModule;
      const { $generateHtmlFromNodes, $generateNodesFromDOM } = htmlModule;
      const { registerRichText } = richTextModule;
      
      editor = createEditor({
        namespace: 'JournalEditor',
        theme: {
          paragraph: 'editor-paragraph',
          text: {
            bold: 'editor-text-bold',
            italic: 'editor-text-italic',
            underline: 'editor-text-underline',
          }
        },
        onError: (error: Error) => {
          console.error('Lexical error:', error);
        },
      });
      
      // Set attributes
      editorInput.setAttribute('role', 'textbox');
      editorInput.setAttribute('aria-multiline', 'true');
      editorInput.setAttribute('data-placeholder', placeholder);
      
      editor.setRootElement(editorInput);
      
      // Register rich text plugin
      registerRichText(editor);
      
      // Add focus and blur listeners to editor root
      editorInput.addEventListener('focus', () => {
        console.log('[LexicalEditor] FOCUS event fired');
      });
      
      editorInput.addEventListener('blur', () => {
        console.log('[LexicalEditor] BLUR event fired');
        dispatch('blur');
      });
      
      // Load initial HTML if provided
      if (value) {
        editor.update(() => {
          const parser = new DOMParser();
          const dom = parser.parseFromString(value, 'text/html');
          const nodes = $generateNodesFromDOM(editor, dom);
          const root = $getRoot();
          root.clear();
          $insertNodes(nodes);
        });
      }
      
      initialValueSet = true;
      console.log('[LexicalEditor] Editor initialized, rootElement:', editorInput);
      
      // Listen for changes
      const removeUpdateListener = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }: any) => {
        // Mark as dirty if there are actual changes
        if (dirtyElements.size > 0 || dirtyLeaves.size > 0) {
          isDirty = true;
        }
        
        editorState.read(() => {
          const html = $generateHtmlFromNodes(editor, null);
          dispatch('change', html);
        });
      });
      
      // Store cleanup function
      (window as any).__lexicalCleanup = removeUpdateListener;
    } catch (error) {
      console.error('Failed to initialize Lexical editor:', error);
    }
  });
  
  onDestroy(() => {
    // Clean up listener
    if ((window as any).__lexicalCleanup) {
      (window as any).__lexicalCleanup();
      delete (window as any).__lexicalCleanup;
    }
    
    // Clean up editor safely
    if (editor) {
      try {
        // Remove root element to clean up
        editor.setRootElement(null);
      } catch (e) {
        console.warn('[LexicalEditor] Cleanup error:', e);
      }
    }
  });
  
  async function formatText(format: 'bold' | 'italic' | 'underline') {
    if (!editor) return;
    const { FORMAT_TEXT_COMMAND } = await import('lexical');
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    editor.focus();
  }
</script>

<div class="lexical-editor">
  <div class="toolbar">
    <button 
      on:click={() => formatText('bold')} 
      title="Bold (Ctrl+B)" 
      aria-label="Bold"
      type="button"
    >
      <strong>B</strong>
    </button>
    <button 
      on:click={() => formatText('italic')} 
      title="Italic (Ctrl+I)" 
      aria-label="Italic"
      type="button"
    >
      <em>I</em>
    </button>
    <button 
      on:click={() => formatText('underline')} 
      title="Underline (Ctrl+U)" 
      aria-label="Underline"
      type="button"
    >
      <u>U</u>
    </button>
    {#if isDirty}
      <span class="dirty-indicator" title="Unsaved changes">●</span>
    {/if}
  </div>
  <div 
    class="editor-content"
    on:mousedown={handleMouseDown}
    on:mouseup={handleMouseUp}
    on:click={handleClick}
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
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid var(--border-color, #ddd);
    background: var(--toolbar-bg, #f5f5f5);
    align-items: center;
    flex-shrink: 0;
  }
  
  .toolbar button {
    padding: 6px 12px;
    border: 1px solid var(--border-color, #ddd);
    background: var(--button-bg, white);
    color: var(--text-color, #222);
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    transition: background 0.2s;
    min-width: 32px;
    min-height: 32px;
  }
  
  .toolbar button:hover {
    background: var(--button-hover-bg, #e8e8e8);
  }
  
  .toolbar button:active {
    transform: scale(0.95);
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
  
  :global(.editor-text-bold) { 
    font-weight: bold; 
  }
  
  :global(.editor-text-italic) { 
    font-style: italic; 
  }
  
  :global(.editor-text-underline) { 
    text-decoration: underline; 
  }
  
  :global(.editor-paragraph) {
    margin: 0 0 8px 0;
  }
  
  :global(.editor-paragraph:last-child) {
    margin-bottom: 0;
  }
</style>
