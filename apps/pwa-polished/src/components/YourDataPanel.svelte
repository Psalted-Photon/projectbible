<script lang="ts">
  /**
   * Profile → Settings → Your Data: download everything personal as one file,
   * or restore from one.
   *
   * Download takes two taps on purpose. The first gathers the data (a sync,
   * then a read of every store), which can take a few seconds; the second
   * saves it. Phones only open the share sheet straight after a tap, so the
   * file has to be ready before that tap happens.
   *
   * Restore shows what's in the file first, with a tickbox per kind, and only
   * adds and updates. Done reloads the app so every screen shows the result.
   */
  import { journalLock } from '../lib/journalLock/lockState';
  import { JournalLockedError } from '../lib/journalLock/entryCrypto';
  import { prepareBackup, type BackupFile, type PreparedBackup } from '../lib/backup/backupFile';
  import {
    backupContents, readBackupFile, restoreBackup, type PartResult, type RestorePart, type RestoreSummary,
  } from '../lib/backup/restoreFile';
  import { saveFile } from '../lib/backup/saveFile';
  import { showNotice, errorText } from '../stores/noticeStore';
  import JournalLockScreen from './JournalLockScreen.svelte';
  import BrandSpinner from './BrandSpinner.svelte';

  function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  // ── Download ──────────────────────────────────────────────────────────────

  type Step = 'idle' | 'needs-unlock' | 'preparing' | 'ready';
  let step: Step = 'idle';
  let prepared: PreparedBackup | null = null;
  let saving = false;

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

  // ── Restore ───────────────────────────────────────────────────────────────

  type RestoreStep = 'idle' | 'preview' | 'needs-unlock' | 'restoring' | 'done';
  let restoreStep: RestoreStep = 'idle';
  let fileInput: HTMLInputElement;
  let backup: BackupFile | null = null;
  let contents: Record<RestorePart, number> | null = null;
  let chosen: Record<RestorePart, boolean> = { notes: true, notebooks: true, highlights: true, journal: true, settings: true };
  let result: RestoreSummary | null = null;

  const PART_ORDER: RestorePart[] = ['notes', 'notebooks', 'highlights', 'journal', 'settings'];

  function partLabel(part: RestorePart, n: number): string {
    switch (part) {
      case 'notes': return plural(n, 'verse note', 'verse notes');
      case 'notebooks': return plural(n, 'notebook page', 'notebook pages');
      case 'highlights': return plural(n, 'highlight', 'highlights');
      case 'journal': return plural(n, 'journal entry', 'journal entries');
      case 'settings': return 'Settings';
    }
  }

  const PART_NAMES: Record<Exclude<RestorePart, 'settings'>, string> = {
    notes: 'Verse notes',
    notebooks: 'Notebook pages',
    highlights: 'Highlights',
    journal: 'Journal',
  };

  $: availableParts = contents ? PART_ORDER.filter((p) => contents![p] > 0) : [];
  $: anyChosen = availableParts.some((p) => chosen[p]);
  $: backupDate = backup ? formatDate(backup.exportedAt) : '';
  // Writing into a locked journal needs the key: the entries get scrambled on the way in.
  $: journalNeedsKey = $journalLock.mode === 'on' && !$journalLock.unlocked;
  $: resultLines = result ? describeResult(result) : [];
  $: anySkipped = result ? Object.values(result.results).some((r) => r && r.skipped > 0) : false;

  function formatDate(value: string): string {
    const d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function describePart(r: PartResult): string {
    const bits: string[] = [];
    if (r.added) bits.push(`${r.added} added`);
    if (r.updated) bits.push(`${r.updated} updated`);
    if (r.skipped) bits.push(`${r.skipped} left out`);
    return bits.length ? bits.join(', ') : 'already up to date';
  }

  function describeResult(r: RestoreSummary): string[] {
    const lines: string[] = [];
    for (const part of PART_ORDER) {
      if (part === 'settings') continue;
      const partResult = r.results[part];
      if (partResult) lines.push(`${PART_NAMES[part]}: ${describePart(partResult)}`);
    }
    if (r.settingsApplied) lines.push('Settings: restored');
    if (r.alarmProblem) lines.push(`Wake alarm: ${r.alarmProblem}`);
    return lines;
  }

  function chooseFile() {
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  async function handleFileSelected(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const read = await readBackupFile(file);
      const counts = backupContents(read);
      if (!PART_ORDER.some((p) => counts[p] > 0)) {
        showNotice('This backup file is empty.', 'error');
        return;
      }
      backup = read;
      contents = counts;
      chosen = { notes: true, notebooks: true, highlights: true, journal: true, settings: true };
      restoreStep = 'preview';
    } catch (err) {
      showNotice(errorText(err), 'error');
    }
  }

  function startRestore() {
    if (!backup || !anyChosen) return;
    if (chosen.journal && (contents?.journal ?? 0) > 0 && journalNeedsKey) {
      restoreStep = 'needs-unlock';
      return;
    }
    void runRestore();
  }

  $: if (restoreStep === 'needs-unlock' && !journalNeedsKey) void runRestore();

  async function runRestore() {
    if (!backup) return;
    restoreStep = 'restoring';
    const parts = new Set(availableParts.filter((p) => chosen[p]));
    try {
      result = await restoreBackup(backup, parts);
      restoreStep = 'done';
    } catch (err) {
      console.error('[Backup] Restore failed:', err);
      if (err instanceof JournalLockedError) {
        showNotice('Your journal locked during the restore. Unlock it and restore again; nothing already restored is lost.', 'error');
      } else {
        showNotice(`Couldn't finish the restore: ${errorText(err)}`, 'error');
      }
      resetRestore();
    }
  }

  function resetRestore() {
    restoreStep = 'idle';
    backup = null;
    contents = null;
    result = null;
  }

  function finishRestore() {
    window.location.reload();
  }
</script>

<div class="setting-group your-data">
  <p class="setting-label">Your Data</p>
  <p class="data-note">
    Save a copy of your notes, notebooks, highlights, journal, reading plans and settings to a file, or bring one back.
  </p>

  {#if restoreStep === 'idle'}
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
  {/if}

  {#if step === 'idle'}
    {#if restoreStep === 'idle'}
      <button class="secondary-btn" on:click={chooseFile}>Restore from file</button>
    {:else if restoreStep === 'preview' && contents}
      <div class="restore-card">
        <p class="restore-title">Restore from this backup{backupDate ? ` (${backupDate})` : ''}</p>
        {#each availableParts as part (part)}
          <label class="restore-choice">
            <input type="checkbox" bind:checked={chosen[part]} />
            <span>{partLabel(part, contents[part])}</span>
          </label>
        {/each}
        <p class="data-note">
          Adds anything missing and updates older copies. Nothing on this device is deleted, so anything you deleted
          after making this backup comes back.
        </p>
        <button class="primary-btn" on:click={startRestore} disabled={!anyChosen}>Restore</button>
        <button class="secondary-btn" on:click={resetRestore}>Cancel</button>
      </div>
    {:else if restoreStep === 'needs-unlock'}
      <p class="data-note">Your journal is locked. Unlock it so the restored entries can be locked too.</p>
      <div class="lock-holder">
        <JournalLockScreen compact />
      </div>
      <button class="secondary-btn" on:click={() => (restoreStep = 'preview')}>Back</button>
    {:else if restoreStep === 'restoring'}
      <div class="preparing">
        <BrandSpinner size={16} title="Restoring…" />
        <span>Restoring… keep the app open.</span>
      </div>
    {:else if restoreStep === 'done'}
      <div class="restore-card">
        <p class="restore-title">Restore finished</p>
        {#each resultLines as line}
          <p class="data-summary">{line}</p>
        {/each}
        {#if anySkipped}
          <p class="data-note">
            Left out: a verse that already had a different note or highlight, or a day that already had a different
            journal entry. The one on this device was kept.
          </p>
        {/if}
        <button class="primary-btn" on:click={finishRestore}>Done</button>
      </div>
    {/if}
  {/if}

  <input
    class="hidden-input"
    type="file"
    accept=".json,application/json"
    bind:this={fileInput}
    on:change={handleFileSelected}
  />

  <p class="data-warning">
    Anyone who opens a backup file can read what's in it, including your journal. Keep it somewhere private.
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
  .data-warning,
  .restore-title {
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

  .restore-title {
    font-size: 13px;
    color: #ddd;
    font-weight: 600;
  }

  .restore-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #202020;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 12px;
  }

  .restore-choice {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #ccc;
    cursor: pointer;
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

  .hidden-input {
    display: none;
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
