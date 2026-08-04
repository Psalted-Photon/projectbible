<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import RefAwareEditor from '../lib/components/RefAwareEditor.svelte';
  import JournalNavigationBar from './JournalNavigationBar.svelte';
  import { syncedJournalStore, subscribeToJournalRemoteChanges } from '../adapters/SyncedJournalStore';
  import { localDateStr } from '../stores/clockStore';
  import type { JournalEntry } from '@projectbible/core';
  
  export let windowId: string | undefined = undefined;
  export let initialDate: string | undefined = undefined;
  
  let editorRef: any;
  let currentDate = initialDate ?? localDateStr(new Date()); // YYYY-MM-DD in local timezone
  let currentEntry: JournalEntry | null = null;
  let title = '';
  let text = '';
  let isDirty = false;
  let isSaving = false;
  let saveTimeout: number | null = null;

  let remoteChangeUnsub: (() => void) | null = null;
  
  onMount(() => {
    loadEntry(currentDate);
    
    // Re-load when a remote sync change arrives
    remoteChangeUnsub = subscribeToJournalRemoteChanges(() => {
      // Don't clobber unsaved local edits
      if (!isDirty) {
        console.log('[JournalWriter] Remote change detected, reloading entry');
        loadEntry(currentDate);
      }
    });
  });

  onDestroy(() => {
    // Unsubscribe from remote-change signal
    remoteChangeUnsub?.();
  });
  
  async function loadEntry(date: string) {
    console.log('[JournalWriter] Loading entry for date:', date);
    try {
      const entry = await syncedJournalStore.getEntryByDate(date);
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
      if (currentEntry) {
        await syncedJournalStore.updateEntry(currentEntry.id, {
          title: title.trim() || undefined,
          text,
        });
        currentEntry.title = title.trim() || undefined;
        currentEntry.text = text;
        currentEntry.updatedAt = new Date();
      } else {
        const newEntry = await syncedJournalStore.saveEntry({
          date: currentDate,
          title: title.trim() || undefined,
          text,
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
  
  function navigateDate(offset: number) {
    const date = new Date(currentDate + 'T12:00:00'); // noon avoids any DST boundary issue
    date.setDate(date.getDate() + offset);
    currentDate = localDateStr(date);
    loadEntry(currentDate);
  }
  
  function jumpToToday() {
    currentDate = localDateStr(new Date());
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
    <RefAwareEditor
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
</style>
