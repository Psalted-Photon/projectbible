<script lang="ts">
  /**
   * Profile → Settings → Your Data: download everything personal as one file.
   *
   * Two taps on purpose. The first gathers the data (a sync, then a read of
   * every store), which can take a few seconds; the second saves it. Phones
   * only open the share sheet straight after a tap, so the file has to be
   * ready before that tap happens.
   */
  import { journalLock } from '../lib/journalLock/lockState';
  import { prepareBackup, type PreparedBackup } from '../lib/backup/backupFile';
  import { saveFile } from '../lib/backup/saveFile';
  import { showNotice, errorText } from '../stores/noticeStore';
  import JournalLockScreen from './JournalLockScreen.svelte';
  import BrandSpinner from './BrandSpinner.svelte';

  type Step = 'idle' | 'needs-unlock' | 'preparing' | 'ready';
  let step: Step = 'idle';
  let prepared: PreparedBackup | null = null;
  let saving = false;

  function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  $: summary = prepared
    ? [
        plural(prepared.counts.notes, 'verse note', 'verse notes'),
        plural(prepared.counts.notebookPages, 'notebook page', 'notebook pages'),
        plural(prepared.counts.highlights, 'highlight', 'highlights'),
        plural(prepared.counts.journal, 'journal entry', 'journal entries'),
        plural(prepared.counts.readingPlans, 'reading plan', 'reading plans'),
        'your settings',
      ].join(' · ')
    : '';

  function start() {
    if ($journalLock.needsUnlock) {
      step = 'needs-unlock';
      return;
    }
    void prepare(true);
  }

  // Unlocking from the lock screen below carries straight on.
  $: if (step === 'needs-unlock' && !$journalLock.needsUnlock) void prepare(true);

  async function prepare(includeJournal: boolean) {
    step = 'preparing';
    try {
      prepared = await prepareBackup({ includeJournal });
      step = 'ready';
    } catch (err) {
      console.error('[Backup] Could not prepare the file:', err);
      showNotice(`Couldn't get your data ready: ${errorText(err)}`, 'error');
      reset();
    }
  }

  async function save() {
    if (!prepared || saving) return;
    saving = true;
    try {
      const result = await saveFile(prepared.file);
      if (result === 'cancelled') return;
      const leftOut = prepared.journalLeftOut;
      showNotice(
        leftOut > 0
          ? `Backup saved. ${plural(leftOut, 'journal entry', 'journal entries')} couldn't be opened and ${leftOut === 1 ? 'was' : 'were'} left out.`
          : result === 'shared' ? 'Backup saved' : 'Backup downloaded',
        leftOut > 0 ? 'error' : 'success',
      );
      reset();
    } catch (err) {
      showNotice(`Couldn't save the file: ${errorText(err)}`, 'error');
    } finally {
      saving = false;
    }
  }

  function reset() {
    step = 'idle';
    prepared = null;
  }
</script>

<div class="setting-group your-data">
  <p class="setting-label">Your Data</p>
  <p class="data-note">
    Save a copy of your notes, notebooks, highlights, journal, reading plans and settings to a file.
  </p>

  {#if step === 'idle'}
    <button class="primary-btn" on:click={start}>Download my data</button>
  {:else if step === 'needs-unlock'}
    <p class="data-note">Your journal is locked. Unlock it to include it in the file.</p>
    <div class="lock-holder">
      <JournalLockScreen compact />
    </div>
    <button class="link-btn" on:click={() => prepare(false)}>Leave the journal out this time</button>
    <button class="secondary-btn" on:click={reset}>Cancel</button>
  {:else if step === 'preparing'}
    <div class="preparing">
      <BrandSpinner size={16} title="Getting your data ready…" />
      <span>Getting your data ready…</span>
    </div>
  {:else if prepared}
    <p class="data-summary">{summary}</p>
    <button class="primary-btn" on:click={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save file'}
    </button>
    <button class="secondary-btn" on:click={reset} disabled={saving}>Cancel</button>
  {/if}

  <p class="data-warning">
    Anyone who opens this file can read what's in it, including your journal. Keep it somewhere private.
  </p>
</div>

<style>
  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .your-data {
    border-top: 1px solid #2a2a2a;
    padding-top: 12px;
  }

  .setting-label {
    margin: 0;
    font-size: 13px;
    color: #ccc;
  }

  .data-note,
  .data-summary,
  .data-warning {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
  }

  .data-note {
    color: #aaa;
  }

  .data-summary {
    color: #9ccc65;
  }

  .data-warning {
    color: #e0b25c;
  }

  .preparing {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #ccc;
  }

  .lock-holder {
    border: 1px solid #2a2a2a;
    border-radius: 8px;
  }

  .primary-btn,
  .secondary-btn,
  .link-btn {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
    background: #2a2a2a;
    color: inherit;
    cursor: pointer;
  }

  .primary-btn {
    background: #4caf50;
    border-color: #4caf50;
    color: #fff;
  }

  .secondary-btn {
    background: #1f1f1f;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: #9ccc65;
    text-align: left;
    padding: 0;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
