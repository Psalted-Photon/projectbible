<script lang="ts">
  /**
   * The lower half of Settings → Privacy while the journal lock is on.
   *
   * Locked: the lock screen, since managing the lock needs the journal key.
   * Unlocked: the fingerprint devices (with remove), adding this device's
   * fingerprint, a new recovery code, and finishing a turn-off that stopped
   * partway. The dialogs themselves belong to SettingsPane.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { Fingerprint, Plus, Key, Trash } from 'phosphor-svelte';
  import { journalLock } from '../lib/journalLock/lockState';
  import { addThisDeviceFingerprint, JournalLockError, removeFingerprint } from '../lib/journalLock/actions';
  import { currentRpId, fingerprintSupport, PasskeyError } from '../lib/journalLock/passkey';
  import type { DBJournalKeySlot } from '../adapters/db';
  import JournalLockScreen from './JournalLockScreen.svelte';

  const dispatch = createEventDispatcher<{ dialog: 'new-code' | 'turn-off' }>();

  let support: 'yes' | 'no' | 'maybe' = 'maybe';
  let busy = false;
  let message = '';
  let error = '';
  let confirmingRemove: DBJournalKeySlot | null = null;
  const rpId = currentRpId();

  onMount(() => {
    fingerprintSupport().then((s) => (support = s));
  });

  $: passkeys = $journalLock.slots
    .filter((s) => s.kind === 'passkey')
    .sort((a, b) => a.createdAt - b.createdAt);

  function added(slot: DBJournalKeySlot): string {
    return new Date(slot.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function addDevice() {
    busy = true;
    message = '';
    error = '';
    try {
      await addThisDeviceFingerprint();
      message = 'This device’s fingerprint now opens the journal.';
    } catch (err) {
      if (err instanceof PasskeyError) {
        error = {
          cancelled: 'Cancelled.',
          unsupported: 'This browser can’t use a fingerprint for the journal.',
          'already-added': 'This device already has a fingerprint for the journal.',
          'no-match': 'Something went wrong. Try again.',
          failed: 'Something went wrong. Try again.',
        }[err.problem];
        if (err.detail && err.problem !== 'cancelled' && err.problem !== 'already-added') error += ` (${err.detail})`;
        console.warn(`[JournalLock] Adding a fingerprint failed: ${err.problem}${err.detail ? ` — ${err.detail}` : ''}`);
      } else if (err instanceof JournalLockError) {
        error = err.message;
      } else {
        console.error('[JournalLock] Adding a fingerprint failed:', err);
        error = 'Something went wrong. Try again.';
      }
    } finally {
      busy = false;
    }
  }

  async function remove(slot: DBJournalKeySlot) {
    busy = true;
    message = '';
    error = '';
    try {
      await removeFingerprint(slot.id);
      confirmingRemove = null;
      message = `${slot.label || 'That device'} was removed.`;
    } catch (err) {
      error = err instanceof JournalLockError ? err.message : 'Something went wrong. Try again.';
      if (!(err instanceof JournalLockError)) console.error('[JournalLock] Removing a fingerprint failed:', err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="jm">
  {#if $journalLock.work}
    <div class="jm-work">
      <span>
        {$journalLock.work.kind === 'scramble' ? 'Scrambling' : 'Unscrambling'} your journal…
        {$journalLock.work.done} of {$journalLock.work.total}
      </span>
      <div class="jm-bar"><div style="width: {Math.round(($journalLock.work.done / Math.max(1, $journalLock.work.total)) * 100)}%"></div></div>
    </div>
  {/if}

  {#if $journalLock.needsUnlock}
    <p class="jm-note">Unlock the journal to manage fingerprints and the recovery code, or to turn the lock off.</p>
    <JournalLockScreen compact />
  {:else if $journalLock.unlocked && $journalLock.mode !== 'off'}
    {#if $journalLock.mode === 'turning_off'}
      <div class="jm-warn">Turning the lock off didn’t finish. Your journal stays locked until it does.</div>
      <button class="jm-btn" on:click={() => dispatch('dialog', 'turn-off')} disabled={busy}>
        Finish turning off
      </button>
    {/if}

    <div class="jm-head">Fingerprint devices</div>
    {#if passkeys.length === 0}
      <p class="jm-note">None yet. The journal opens with the recovery code only.</p>
    {:else}
      <ul class="jm-list">
        {#each passkeys as slot (slot.id)}
          <li class="jm-row">
            <span class="jm-row-icon"><Fingerprint size={16} weight="bold" /></span>
            <span class="jm-row-text">
              <span class="jm-row-name">{slot.label || 'A device'}</span>
              <span class="jm-row-sub">
                Added {added(slot)}{slot.rpId && slot.rpId !== rpId ? ` · works at ${slot.rpId}` : ''}
              </span>
            </span>
            {#if confirmingRemove?.id === slot.id}
              <button class="jm-small" on:click={() => (confirmingRemove = null)} disabled={busy}>Cancel</button>
              <button class="jm-small danger" on:click={() => remove(slot)} disabled={busy}>Remove</button>
            {:else}
              <button class="jm-icon-btn" aria-label="Remove {slot.label || 'this device'}" on:click={() => { confirmingRemove = slot; message = ''; error = ''; }} disabled={busy}>
                <Trash size={16} weight="bold" />
              </button>
            {/if}
          </li>
          {#if confirmingRemove?.id === slot.id}
            <li class="jm-confirm">Its fingerprint won’t open the journal anymore. Your recovery code still will.</li>
          {/if}
        {/each}
      </ul>
    {/if}

    {#if support !== 'no'}
      <button class="jm-btn" on:click={addDevice} disabled={busy}>
        <Plus size={16} weight="bold" /> Add this device’s fingerprint
      </button>
    {/if}
    <button class="jm-btn" on:click={() => dispatch('dialog', 'new-code')} disabled={busy}>
      <Key size={16} weight="bold" /> Make a new recovery code
    </button>

    {#if message}<p class="jm-message">{message}</p>{/if}
    {#if error}<p class="jm-error" role="alert">{error}</p>{/if}
  {/if}
</div>

<style>
  .jm {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .jm-note {
    margin: 0;
    color: #aaa;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .jm-warn {
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(224, 169, 74, 0.1);
    border: 1px solid rgba(224, 169, 74, 0.35);
    color: #f5d08a;
    font-size: 0.85rem;
    line-height: 1.45;
  }

  .jm-work {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: #ccc;
    font-size: 0.85rem;
  }

  .jm-bar {
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .jm-bar > div {
    height: 100%;
    background: #a5b4fc;
    transition: width 0.2s ease;
  }

  .jm-head {
    font-size: 0.95rem;
    color: #ccc;
    font-weight: 500;
  }

  .jm-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .jm-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #1a1a1a;
    border: 1px solid #333;
  }

  .jm-row-icon {
    display: inline-flex;
    color: #a5b4fc;
    flex-shrink: 0;
  }

  .jm-row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .jm-row-name {
    color: #e0e0e0;
    font-size: 0.9rem;
  }
  .jm-row-sub {
    color: #888;
    font-size: 0.75rem;
  }

  .jm-confirm {
    color: #fca5a5;
    font-size: 0.8rem;
    padding: 0 10px 4px;
  }

  .jm-icon-btn {
    display: inline-flex;
    background: none;
    border: none;
    color: #888;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
  }
  .jm-icon-btn:hover:not(:disabled) {
    color: #f87171;
    background: rgba(248, 113, 113, 0.1);
  }

  .jm-small {
    background: rgba(255, 255, 255, 0.07);
    color: #ccc;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .jm-small.danger {
    background: #f87171;
    border-color: #f87171;
    color: #111;
    font-weight: 600;
  }

  .jm-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 0.7rem 1rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.2s;
  }
  .jm-btn:hover:not(:disabled) {
    border-color: #667eea;
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .jm-message {
    margin: 0;
    color: #9ccc65;
    font-size: 0.85rem;
  }
  .jm-error {
    margin: 0;
    color: #fca5a5;
    font-size: 0.85rem;
  }
</style>
