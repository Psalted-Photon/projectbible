<script lang="ts">
  /**
   * "irisBible has a new home": shown on hexapla.app to anyone with something
   * on the device, until they have moved to irisbible.com.
   *
   * It only ever adds safety. It uploads what is waiting, makes a fresh
   * recovery code for a fingerprint-locked journal (a fingerprint only opens
   * the journal on the address it was set up on), and saves a backup file for
   * a signed-out device. It never signs out, clears storage or deletes
   * anything, and "Not now" is always there: this address works until it
   * lapses.
   *
   * "Open irisBible" stays disabled until everything is safe: no upload
   * waiting, a connection, and the journal step done or skipped.
   */
  import { onDestroy, onMount } from 'svelte';
  import { Check, CloudArrowUp, FileArrowDown, LockSimple, Copy } from 'phosphor-svelte';
  import { movingScreenOpen, snoozeMove, isSignedIn, deviceHoldsData } from '../lib/move/moveCheck';
  import { newAddressFor, NEW_ORIGIN } from '../lib/move/address';
  import { syncQueue } from '../lib/sync/SyncQueueService';
  import { syncService } from '../lib/sync';
  import { journalLock } from '../lib/journalLock/lockState';
  import { replaceRecoveryCode, JournalLockError } from '../lib/journalLock/actions';
  import { generateRecoveryCode } from '../lib/journalLock/recoveryCode';
  import { prepareBackup, type PreparedBackup } from '../lib/backup/backupFile';
  import { saveFile } from '../lib/backup/saveFile';
  import { userProfileStore } from '../stores/userProfileStore';
  import { errorText } from '../stores/noticeStore';
  import JournalLockScreen from './JournalLockScreen.svelte';
  import BrandSpinner from './BrandSpinner.svelte';

  // ── Who is here ───────────────────────────────────────────────────────────

  let sessionKnown = false;
  let signedInSession = false;
  let holdsData = false;

  $: signedIn = signedInSession || $userProfileStore.isSignedIn;

  // ── Step 1: everything waiting reaches the account ────────────────────────

  type UploadState = 'idle' | 'working' | 'done' | 'offline' | 'waiting';
  let upload: UploadState = 'idle';
  let waiting = 0;
  let uploading = false;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function runUploads() {
    if (uploading) return;
    uploading = true;
    try {
      if (!navigator.onLine) {
        upload = 'offline';
        return;
      }
      upload = 'working';
      await syncQueue.resetFailed();
      try {
        await syncService.forceSync();
      } catch (err) {
        console.warn('[Move] Sync before moving did not finish:', err);
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        await syncQueue.processQueue();
        waiting = await syncQueue.getPendingCount();
        if (waiting === 0) {
          upload = 'done';
          return;
        }
        await sleep(2000);
      }
      upload = 'waiting';
    } catch (err) {
      console.warn('[Move] Upload check failed:', err);
      waiting = await syncQueue.getPendingCount().catch(() => waiting);
      upload = 'waiting';
    } finally {
      uploading = false;
    }
  }

  // ── Step 2: a fingerprint-locked journal gets a fresh recovery code ───────

  $: lockOn = $journalLock.mode === 'on';
  $: hasFingerprint = $journalLock.slots.some((s) => s.kind === 'passkey');
  $: journalStepNeeded = signedIn && lockOn && hasFingerprint;

  type CodeState = 'idle' | 'showing' | 'saving' | 'done';
  let codeState: CodeState = 'idle';
  let newCode = '';
  let codeSaved = false;
  let codeNote = '';
  let codeError = '';
  let journalSkipped = false;

  function makeCode() {
    newCode = generateRecoveryCode();
    codeSaved = false;
    codeError = '';
    codeState = 'showing';
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(newCode);
      codeNote = 'Copied';
    } catch {
      codeNote = 'Couldn’t copy. Write it down instead.';
    }
  }

  async function useCode() {
    if (!codeSaved || codeState === 'saving') return;
    codeState = 'saving';
    codeError = '';
    try {
      await replaceRecoveryCode(newCode);
      codeState = 'done';
      newCode = '';
    } catch (err) {
      // The new code can be saved while the old one could not be retired;
      // either way the new code works, so the step is done.
      if (err instanceof JournalLockError && /new code is saved/i.test(err.message)) {
        codeError = err.message;
        codeState = 'done';
        return;
      }
      codeError = err instanceof JournalLockError ? err.message : errorText(err);
      codeState = 'showing';
    }
  }

  // ── Step 3: a backup file, for a device with no account ───────────────────

  type BackupState = 'idle' | 'preparing' | 'ready' | 'saved';
  let backupState: BackupState = 'idle';
  let prepared: PreparedBackup | null = null;
  let backupError = '';
  let backupSkipped = false;
  let savingFile = false;

  async function prepareFile() {
    backupState = 'preparing';
    backupError = '';
    try {
      prepared = await prepareBackup({ includeJournal: !$journalLock.needsUnlock });
      backupState = 'ready';
    } catch (err) {
      backupError = `Couldn’t get your data ready: ${errorText(err)}`;
      backupState = 'idle';
    }
  }

  async function saveBackup() {
    if (!prepared || savingFile) return;
    savingFile = true;
    try {
      const result = await saveFile(prepared.file);
      if (result !== 'cancelled') backupState = 'saved';
    } catch (err) {
      backupError = `Couldn’t save the file: ${errorText(err)}`;
    } finally {
      savingFile = false;
    }
  }

  // ── Leaving ───────────────────────────────────────────────────────────────

  $: backupNeeded = !signedIn && holdsData;
  $: uploadsOk = !signedIn || upload === 'done';
  $: journalOk = !journalStepNeeded || codeState === 'done' || journalSkipped;
  $: backupOk = !backupNeeded || backupState === 'saved' || backupSkipped;
  $: canOpen = sessionKnown && $journalLock.ready && uploadsOk && journalOk && backupOk && online;

  let online = true;
  function onOnline() {
    online = true;
    if (signedIn && upload !== 'done') void runUploads();
  }
  function onOffline() {
    online = false;
  }

  function openNew() {
    if (!canOpen) return;
    window.location.href = newAddressFor();
  }

  function notNow() {
    snoozeMove();
    movingScreenOpen.set(false);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') notNow();
  }

  onMount(async () => {
    online = navigator.onLine;
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('keydown', onKeydown);
    signedInSession = await isSignedIn();
    holdsData = await deviceHoldsData();
    sessionKnown = true;
    if (signedIn) void runUploads();
  });

  onDestroy(() => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('keydown', onKeydown);
  });

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<div class="mv-backdrop" role="dialog" aria-modal="true" aria-label="irisBible has a new home">
  <div class="mv-card">
    <h2 class="mv-title">irisBible has a new home</h2>
    <p class="mv-lead">
      Hexapla is now irisBible, at <strong>{NEW_ORIGIN.replace('https://', '')}</strong>. This address keeps
      working for a while, and nothing here is deleted. A few quick steps first, so everything you've made
      comes with you.
    </p>

    {#if !sessionKnown}
      <p class="mv-note"><BrandSpinner size={16} title="Checking" /> Checking this device…</p>
    {:else}
      {#if signedIn}
        <section class="mv-step" class:done={upload === 'done'}>
          <div class="mv-step-head">
            <span class="mv-badge">{#if upload === 'done'}<Check size={14} weight="bold" />{:else}<CloudArrowUp size={14} weight="bold" />{/if}</span>
            <h3>Send everything to your account</h3>
          </div>
          {#if upload === 'working' || upload === 'idle'}
            <p class="mv-note"><BrandSpinner size={16} title="Uploading" /> Uploading your changes…</p>
          {:else if upload === 'done'}
            <p class="mv-note">Everything is in your account.</p>
          {:else if upload === 'offline'}
            <p class="mv-note">You’re offline. Connect to the internet and this finishes by itself.</p>
          {:else}
            <p class="mv-note">
              {waiting > 0 ? plural(waiting, 'change hasn’t', 'changes haven’t') : 'Some changes haven’t'} reached your account yet.
              Check your connection and try again.
            </p>
            <button class="mv-btn-secondary" on:click={runUploads} disabled={uploading}>Try again</button>
          {/if}
        </section>
      {/if}

      {#if journalStepNeeded}
        <section class="mv-step" class:done={codeState === 'done' || journalSkipped}>
          <div class="mv-step-head">
            <span class="mv-badge">{#if codeState === 'done' || journalSkipped}<Check size={14} weight="bold" />{:else}<LockSimple size={14} weight="bold" />{/if}</span>
            <h3>Your locked journal</h3>
          </div>
          {#if codeState === 'done'}
            <p class="mv-note">Your new recovery code is saved. On irisBible, use it to open the journal, then add a fingerprint there.</p>
            {#if codeError}<p class="mv-error">{codeError}</p>{/if}
          {:else if journalSkipped}
            <p class="mv-note">Skipped. You’ll need the recovery code you already have to open the journal on irisBible.</p>
          {:else if $journalLock.needsUnlock}
            <p class="mv-note">A fingerprint only opens the journal on the address it was set up on. Unlock it here once, and you’ll get a fresh recovery code to open it on irisBible.</p>
            <JournalLockScreen compact />
          {:else if codeState === 'idle'}
            <p class="mv-note">A fingerprint only opens the journal on the address it was set up on. Make a fresh recovery code, and use it to open the journal on irisBible.</p>
            <button class="mv-btn-primary" on:click={makeCode}>Make a new recovery code</button>
          {:else}
            <p class="mv-note">Save this code somewhere safe, like a password manager. It’s shown only once.</p>
            <div class="mv-code" aria-label="New recovery code">{newCode}</div>
            <div class="mv-row">
              <button class="mv-btn-secondary" on:click={copyCode}><Copy size={16} /> Copy</button>
              {#if codeNote}<span class="mv-note small">{codeNote}</span>{/if}
            </div>
            <label class="mv-check">
              <input type="checkbox" bind:checked={codeSaved} />
              <span>I’ve saved this code</span>
            </label>
            {#if codeError}<p class="mv-error">{codeError}</p>{/if}
            <button class="mv-btn-primary" on:click={useCode} disabled={!codeSaved || codeState === 'saving'}>
              {codeState === 'saving' ? 'Saving…' : 'Use this code'}
            </button>
          {/if}
          {#if codeState !== 'done' && !journalSkipped && codeState !== 'saving'}
            <button class="mv-link" on:click={() => (journalSkipped = true)}>I already have my recovery code</button>
          {/if}
        </section>
      {/if}

      {#if backupNeeded}
        <section class="mv-step" class:done={backupState === 'saved' || backupSkipped}>
          <div class="mv-step-head">
            <span class="mv-badge">{#if backupState === 'saved' || backupSkipped}<Check size={14} weight="bold" />{:else}<FileArrowDown size={14} weight="bold" />{/if}</span>
            <h3>Save a backup file</h3>
          </div>
          {#if backupState === 'saved'}
            <p class="mv-note">Saved. On irisBible, open Profile → Settings → Your Data → Restore, and choose the file.</p>
          {:else if backupSkipped}
            <p class="mv-note">Skipped. What’s on this device stays on this address.</p>
          {:else}
            <p class="mv-note">You’re not signed in, so your notes, highlights and settings live only on this device. A backup file carries them to irisBible.</p>
            {#if backupState === 'idle'}
              <button class="mv-btn-primary" on:click={prepareFile}>Get my file ready</button>
            {:else if backupState === 'preparing'}
              <p class="mv-note"><BrandSpinner size={16} title="Preparing" /> Gathering your data…</p>
            {:else}
              <button class="mv-btn-primary" on:click={saveBackup} disabled={savingFile}>
                {savingFile ? 'Saving…' : 'Save the file'}
              </button>
            {/if}
            {#if backupError}<p class="mv-error">{backupError}</p>{/if}
            <button class="mv-link" on:click={() => (backupSkipped = true)}>Skip the backup</button>
          {/if}
        </section>
      {/if}

      <section class="mv-step final">
        <h3>Then move over</h3>
        <ol class="mv-list">
          <li>Open irisBible{signedIn ? ' and sign in with the same email' : ''}.</li>
          <li>Install it from your browser’s menu.</li>
          <li>Remove the old Hexapla icon from your home screen, so you don’t get every alarm twice.</li>
        </ol>
        {#if !online}<p class="mv-note">You’re offline. Connect to the internet to open irisBible.</p>{/if}
        <button class="mv-btn-primary big" on:click={openNew} disabled={!canOpen}>Open irisBible</button>
      </section>
    {/if}

    <button class="mv-link center" on:click={notNow}>Not now</button>
  </div>
</div>

<style>
  .mv-backdrop {
    position: fixed;
    inset: 0;
    /* Over the tutorial (--tut-z is 100000), under the in-app questions. */
    z-index: 100010;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 16px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.7);
  }

  .mv-card {
    width: min(100%, 460px);
    margin: auto;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 20px 20px 14px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    color: rgba(255, 255, 255, 0.9);
  }

  .mv-title {
    margin: 0 0 8px;
    font-size: 1.15rem;
    font-weight: 700;
  }

  .mv-lead {
    margin: 0 0 14px;
    font-size: 0.88rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.7);
  }

  .mv-step {
    margin: 0 0 12px;
    padding: 12px 14px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mv-step.done {
    border-color: rgba(134, 239, 172, 0.35);
  }
  .mv-step.final {
    border-color: rgba(165, 180, 252, 0.4);
  }

  .mv-step-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mv-step h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
  }

  .mv-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(165, 180, 252, 0.18);
    color: #a5b4fc;
    flex-shrink: 0;
  }
  .done .mv-badge {
    background: rgba(134, 239, 172, 0.18);
    color: #86efac;
  }

  .mv-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.65);
  }
  .mv-note.small {
    font-size: 0.78rem;
  }

  .mv-error {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: #fca5a5;
  }

  .mv-list {
    margin: 0;
    padding-left: 1.2rem;
    font-size: 0.85rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.7);
  }

  .mv-code {
    padding: 10px 12px;
    border-radius: 8px;
    background: #111;
    border: 1px solid rgba(255, 255, 255, 0.15);
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    word-break: break-all;
    user-select: all;
  }

  .mv-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .mv-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .mv-btn-primary {
    background: #a5b4fc;
    color: #111;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .mv-btn-primary.big {
    padding: 12px 16px;
    font-size: 1rem;
  }
  .mv-btn-primary:hover:not(:disabled) {
    background: #c7d2fe;
  }

  .mv-btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 0.85rem;
    cursor: pointer;
    align-self: flex-start;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .mv-link {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 4px 0;
    color: #a5b4fc;
    font-size: 0.82rem;
    text-decoration: underline;
    cursor: pointer;
  }
  .mv-link.center {
    display: block;
    margin: 4px auto 0;
  }
</style>
