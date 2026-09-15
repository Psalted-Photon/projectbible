<script lang="ts">
  /**
   * The lower half of Settings → Privacy while the journal lock is on: the
   * scramble progress bar, and the lock screen when the journal is locked.
   */
  import { journalLock } from '../lib/journalLock/lockState';
  import JournalLockScreen from './JournalLockScreen.svelte';
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
    <p class="jm-note">Unlock the journal to manage fingerprints and the recovery code.</p>
    <JournalLockScreen compact />
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
</style>
