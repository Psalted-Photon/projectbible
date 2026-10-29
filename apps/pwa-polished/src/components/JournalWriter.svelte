<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import RefAwareEditor from '../lib/components/RefAwareEditor.svelte';
  import JournalNavigationBar from './JournalNavigationBar.svelte';
  import { syncedJournalStore, subscribeToJournalRemoteChanges } from '../adapters/SyncedJournalStore';
  import { localDateStr } from '../stores/clockStore';
  import { onBeforeLock } from '../lib/journalLock/lockState';
  import type { JournalEntry } from '@projectbible/core';
  import { showNotice } from '../stores/noticeStore';
  import { userProfileStore } from '../stores/userProfileStore';
  import { recorder, recordingLive, startRecording } from '../lib/recorder/recorder';
  import { registerJournalWriter, placeRecordingChip, stopAndAsk } from '../lib/voice/transcribe';
  import { OPEN_JOURNAL_DAY } from '../lib/openJournalDay';
  
  export let initialDate: string | undefined = undefined;
  
  let editorRef: any;
  let currentDate = initialDate ?? localDateStr(new Date()); // YYYY-MM-DD in local timezone
  let currentEntry: JournalEntry | null = null;
  let title = '';
  let text = '';
  let isDirty = false;
  let isSaving = false;
  /** Autosave retries every couple of seconds; say so once, not on every try. */
  let saveFailureShown = false;
  let saveTimeout: number | null = null;
  /**
   * Set when the day's entry is scrambled and can't be shown: 'locked' while
   * the journal key isn't in memory, 'unreadable' when the key can't open it.
   * Either way nothing may be saved over it.
   */
  let blocked: 'locked' | 'unreadable' | null = null;

  let remoteChangeUnsub: (() => void) | null = null;
  let beforeLockUnsub: (() => void) | null = null;
  
  /** Something asked for a day: Recordings' Open the day, a transcript's Open. */
  function onOpenDay(e: Event) {
    const date = (e as CustomEvent<string>).detail;
    if (date && date !== (goingTo ?? currentDate)) void goToDate(date);
  }

  onMount(() => {
    loadEntry(currentDate);
    window.addEventListener(OPEN_JOURNAL_DAY, onOpenDay);

    // The journal is about to lock: save unsaved typing while the key is
    // still in memory, so the 2-second autosave can't lose words.
    beforeLockUnsub = onBeforeLock(flushTyping);
    
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
    window.removeEventListener(OPEN_JOURNAL_DAY, onOpenDay);
    unregisterWriter?.();
    // Unsubscribe from remote-change signal
    remoteChangeUnsub?.();
    beforeLockUnsub?.();
    // Closed inside the 2-second autosave: the words still go in.
    if (isDirty) void flushTyping();
  });

  async function flushTyping() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    // A save already under way may have started before the last keystrokes.
    for (let i = 0; i < 40 && isSaving; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (isDirty) await saveEntry();
  }
  
  /** Days tapped through quickly can load out of order; only the last one shows. */
  let loadToken = 0;
  /** The day the editor holds now. A transcript waits while another is loading. */
  let loadedDate: string | null = null;

  async function loadEntry(date: string) {
    console.log('[JournalWriter] Loading entry for date:', date);
    const token = ++loadToken;
    loadedDate = null;
    try {
      const entry = await syncedJournalStore.getEntryByDate(date);
      if (token !== loadToken) return;
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
      loadedDate = date;
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
  
  /**
   * Asked to save while a save was already running. The typing since went in
   * after that save read the entry, so it gets a save of its own when that one
   * ends; dropping it lost the last words if the day changed or the journal
   * closed straight after.
   */
  let saveAgain = false;

  async function saveEntry() {
    if (blocked) return;
    if (isSaving) {
      saveAgain = true;
      return;
    }
    isSaving = true;
    saveAgain = false;
    // What this save writes. Typing during it changes title and text, which
    // then still count as unsaved.
    const savedTitle = title.trim() || undefined;
    const savedText = text;

    try {
      if (currentEntry) {
        await syncedJournalStore.updateEntry(currentEntry.id, {
          title: savedTitle,
          text: savedText,
        });
        currentEntry.title = savedTitle;
        currentEntry.text = savedText;
        currentEntry.updatedAt = new Date();
      } else {
        const newEntry = await syncedJournalStore.saveEntry({
          date: currentDate,
          title: savedTitle,
          text: savedText,
        });
        currentEntry = newEntry;
      }

      isDirty = (title.trim() || undefined) !== savedTitle || text !== savedText;
      saveFailureShown = false;
    } catch (error) {
      console.error('Failed to save journal entry:', error);
      if (!saveFailureShown) {
        saveFailureShown = true;
        showNotice("Your journal entry couldn't be saved. Keep it open; it tries again as you type.", 'error');
      }
    } finally {
      isSaving = false;
    }
    if (saveAgain && isDirty) void saveEntry();
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
  
  /** The day being moved to, while typing still waiting to save is saved first. */
  let goingTo: string | null = null;

  /**
   * Typing still waiting on the 2-second autosave belongs to the day it was
   * typed on, so it is saved before the day changes under it. Without this it
   * was dropped, or saved onto the next day.
   */
  async function goToDate(date: string) {
    goingTo = date;
    await flushTyping();
    if (goingTo !== date) return; // a later tap took over
    goingTo = null;
    currentDate = date;
    await loadEntry(date);
  }

  function navigateDate(offset: number) {
    const date = new Date((goingTo ?? currentDate) + 'T12:00:00'); // noon avoids any DST boundary issue
    date.setDate(date.getDate() + offset);
    void goToDate(localDateStr(date));
  }

  function jumpToToday() {
    void goToDate(localDateStr(new Date()));
  }

  function handleDateChange(event: CustomEvent<string>) {
    void goToDate(event.detail);
  }

  // ─── Recording ─────────────────────────────────────────────────────────────
  // A recording made here is tied to the day's entry. Its pill goes in at
  // the cursor, and once it is written out the words land in front of it,
  // through this editor while the day is open and through the journal store
  // otherwise (lib/voice/transcribe.ts). While the lock is on, the recording
  // is scrambled with the entries.

  $: recordingHere = recordingLive($recorder) && $recorder.journal?.date === currentDate;

  function record() {
    if (blocked) return;
    void startRecording({
      journal: { date: currentDate, userId: get(userProfileStore).userId },
      onStarted: (rec) => void placeRecordingChip(rec),
    });
  }

  /** Ready for a transcript's words: the editor holds this day, and it opened. */
  const ready = (date: string) => !blocked && loadedDate === date && date === currentDate && !goingTo;

  let unregisterWriter: (() => void) | null = null;
  $: setWriter(blocked ? null : currentDate);

  function setWriter(date: string | null) {
    unregisterWriter?.();
    unregisterWriter = date
      ? registerJournalWriter(date, {
          write: (recId, blocks, tail) => (ready(date) ? editorRef?.writeTranscript(recId, blocks, tail) : undefined),
          place: (recId) => (ready(date) ? (editorRef?.placeRecording(recId) ?? false) : false),
          remove: (recId) => (ready(date) ? editorRef?.removeRecording(recId) : undefined),
          save: async () => {
            // The editor tells this writer about its last change a moment after making it.
            await new Promise((r) => setTimeout(r, 0));
            await flushTyping();
            return !isDirty;
          },
        })
      : null;
  }
</script>

<div class="journal-writer">
  <JournalNavigationBar
    {currentDate}
    {title}
    {isDirty}
    {isSaving}
    recording={recordingHere}
    stopping={$recorder.phase === 'stopping'}
    recordDisabled={!!blocked || recordingLive($recorder)}
    on:record={record}
    on:stop={stopAndAsk}
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
