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
  /**
   * Set when the day's entry is scrambled and can't be shown: 'locked' while
   * the journal key isn't in memory, 'unreadable' when the key can't open it.
   * Either way nothing may be saved over it.
   */
  let blocked: 'locked' | 'unreadable' | null = null;

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
      blocked = entry?.locked ? 'locked' : entry?.unreadable ? 'unreadable' : null;
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
    if (isSaving || blocked) return;
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
    if (blocked) return;
    text = event.detail;
    isDirty = true;
    debouncedSave();
  }
  
  function handleTitleChange(event: CustomEvent<string>) {
    if (blocked) return;
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
      surface="journal"
      surfaceLabel="Journal"
      value={text}
      placeholder="What's on your heart today? (Tip: Type Bible references like 'John 3:16' and they'll become clickable links!)"
      on:change={handleTextChange}
      on:blur={handleBlur}
    />
    {#if blocked}
      <div class="entry-blocked" role="status">
        {#if blocked === 'locked'}
          <p class="blocked-title">This entry is locked</p>
          <p>Unlock the journal to read it.</p>
        {:else}
          <p class="blocked-title">This entry couldn’t be opened</p>
          <p>It may have been scrambled with an older journal key, or damaged. It’s been left exactly as it is, and it can’t be written over.</p>
        {/if}
      </div>
    {/if}
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
    position: relative;
  }

  /* Covers the editor so nothing can be typed over an entry that didn't open. */
  .entry-blocked {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    background: #1c1c1e;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .entry-blocked p {
    margin: 0;
    max-width: 340px;
  }
  .entry-blocked .blocked-title {
    font-weight: 700;
    color: rgba(255, 255, 255, 0.88);
  }
</style>
