<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import LexicalEditor from '../lib/components/LexicalEditor.svelte';
  import JournalNavigationBar from './JournalNavigationBar.svelte';
  import { IndexedDBJournalStore } from '../adapters/JournalStore';
  import type { JournalEntry } from '@projectbible/core';
  
  export let windowId: string | undefined = undefined;
  
  let editorRef: any;
  let journalStore: IndexedDBJournalStore;
  let currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let currentEntry: JournalEntry | null = null;
  let title = '';
  let text = '';
  let isDirty = false;
  let isSaving = false;
  let saveTimeout: number | null = null;
  
  // Bible book names for reference detection
  const BIBLE_BOOKS = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
    '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah',
    'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
    'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke',
    'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians',
    'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
    'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'
  ];
  
  function handleReferenceClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.classList.contains('bible-reference')) {
      event.preventDefault();
      const book = target.dataset.book;
      const chapter = parseInt(target.dataset.chapter || '1');
      const verse = parseInt(target.dataset.verse || '1');
      
      // Import navigationStore dynamically to navigate
      import('../stores/navigationStore').then(({ navigationStore }) => {
        navigationStore.navigateTo('WEB', book!, chapter, verse);
      });
    }
  }
  
  onMount(() => {
    journalStore = new IndexedDBJournalStore();
    loadEntry(currentDate);
    
    // Add global click handler for Bible references
    document.addEventListener('click', handleReferenceClick);
  });
  
  onDestroy(() => {
    // Clean up click handler
    document.removeEventListener('click', handleReferenceClick);
  });
  
  async function loadEntry(date: string) {
    console.log('[JournalWriter] Loading entry for date:', date);
    try {
      const entry = await journalStore.getEntryByDate(date);
      if (entry) {
        console.log('[JournalWriter] Found entry:', entry.id);
        currentEntry = entry;
        title = entry.title || '';
        text = entry.text;
      } else {
        console.log('[JournalWriter] No entry found, creating new');
        currentEntry = null;
        title = '';
        text = '';
      }
      
      // Update editor content explicitly
      if (editorRef) {
        console.log('[JournalWriter] Calling editorRef.setContent');
        editorRef.setContent(text);
      } else {
        console.log('[JournalWriter] WARNING: editorRef is null!');
      }
      
      isDirty = false;
    } catch (error) {
      console.error('Failed to load journal entry:', error);
    }
  }
  
  // Debounced auto-save (2s)
  function debouncedSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = window.setTimeout(() => {
      saveEntry();
    }, 2000);
  }
  
  async function saveEntry() {
    if (isSaving) return;
    isSaving = true;
    
    try {
      // Parse and linkify Bible references
      const linkified = linkifyReferences(text);
      
      if (currentEntry) {
        await journalStore.updateEntry(currentEntry.id, {
          title: title.trim() || undefined,
          text,
          textLinkified: linkified
        });
        currentEntry.title = title.trim() || undefined;
        currentEntry.text = text;
        currentEntry.textLinkified = linkified;
        currentEntry.updatedAt = new Date();
      } else {
        const newEntry = await journalStore.saveEntry({
          date: currentDate,
          title: title.trim() || undefined,
          text,
          textLinkified: linkified
        });
        currentEntry = newEntry;
      }
      
      isDirty = false;
    } catch (error) {
      console.error('Failed to save journal entry:', error);
    } finally {
      isSaving = false;
    }
  }
  
  function handleTextChange(event: CustomEvent<string>) {
    text = event.detail;
    isDirty = true;
    debouncedSave();
  }
  
  function handleTitleChange(event: CustomEvent<string>) {
    title = event.detail;
    isDirty = true;
    debouncedSave();
  }
  
  // Save on blur (in addition to debounce)
  function handleBlur() {
    if (isDirty) {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      saveEntry();
    }
  }
  
  function linkifyReferences(html: string): string {
    // Create regex pattern for Bible references
    const bookPattern = BIBLE_BOOKS.join('|');
    const pattern = new RegExp(`\\b(${bookPattern})\\s+(\\d+):(\\d+)`, 'gi');
    
    return html.replace(pattern, (match, book, chapter, verse) => {
      return `<a href="#" data-book="${book}" data-chapter="${chapter}" data-verse="${verse}" class="bible-reference">${match}</a>`;
    });
  }
  
  function navigateDate(offset: number) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + offset);
    currentDate = date.toISOString().split('T')[0];
    loadEntry(currentDate);
  }
  
  function jumpToToday() {
    currentDate = new Date().toISOString().split('T')[0];
    loadEntry(currentDate);
  }
  
  function handleDateChange(event: CustomEvent<string>) {
    currentDate = event.detail;
    loadEntry(currentDate);
  }
</script>

<div class="journal-writer">
  <JournalNavigationBar
    {currentDate}
    {title}
    {isDirty}
    {isSaving}
    on:prev={() => navigateDate(-1)}
    on:next={() => navigateDate(1)}
    on:today={jumpToToday}
    on:dateChange={handleDateChange}
    on:titleChange={handleTitleChange}
    on:titleBlur={handleBlur}
  />
  
  <div class="editor-container">
    <LexicalEditor
      bind:this={editorRef}
      bind:isDirty
      value={text}
      placeholder="What's on your heart today? (Tip: Type Bible references like 'John 3:16' and they'll become clickable links!)"
      on:change={handleTextChange}
      on:blur={handleBlur}
    />
  </div>
</div>

<style>
  .journal-writer {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: var(--background-color, #fff);
  }
  
  .editor-container {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  :global(.bible-reference) {
    color: var(--link-color, #007aff);
    text-decoration: underline;
    cursor: pointer;
  }
  
  :global(.bible-reference:hover) {
    opacity: 0.8;
  }
</style>
