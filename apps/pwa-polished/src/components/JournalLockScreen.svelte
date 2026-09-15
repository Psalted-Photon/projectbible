<script lang="ts">
  /**
   * The journal's lock screen: a fingerprint button and a recovery-code way in.
   *
   * Shown inside a Journal window in place of the writer, on the Profile
   * Journal tab in place of the calendar, and in Settings while locked. It
   * sits inside the window rather than over the app, so the window frame
   * stays usable (closing, docking, the tutorial's dots).
   */
  import { onMount } from 'svelte';
  import { LockSimple, Fingerprint } from 'phosphor-svelte';
  import { journalLock } from '../lib/journalLock/lockState';
  import { unlockWithFingerprint, unlockWithRecoveryCode } from '../lib/journalLock/actions';
  import { fingerprintSupport, PasskeyError, usablePasskeySlots } from '../lib/journalLock/passkey';
  import { refreshLockFromCloud } from '../lib/journalLock/sync';
  import { userProfileStore } from '../stores/userProfileStore';

  /** Smaller, for the Profile tab and Settings. */
  export let compact = false;

  let support: 'yes' | 'no' | 'maybe' = 'maybe';
  let usingCode = false;
  let code = '';
  let busy = false;
  let checking = false;
  let error = '';
  let codeInput: HTMLInputElement;

  onMount(() => {
    fingerprintSupport().then((s) => (support = s));
  });

  $: usable = usablePasskeySlots($journalLock.slots, $journalLock.keyId);
  $: hasPasskeys = $journalLock.slots.some((s) => s.kind === 'passkey');
  $: hasRecovery = $journalLock.slots.some((s) => s.kind === 'recovery');
  $: noSlots = $journalLock.slots.length === 0;
  $: showFingerprint = usable.length > 0 && support !== 'no';

  async function useFingerprint() {
    error = '';
    busy = true;
    try {
      await unlockWithFingerprint();
    } catch (err) {
      const problem = err instanceof PasskeyError ? err.problem : 'failed';
      error = {
        cancelled: 'Fingerprint cancelled. Tap the button to try again.',
        unsupported: 'This browser can’t use a fingerprint for the journal. Use your recovery code instead.',
        'already-added': 'Something went wrong. Try again, or use your recovery code.',
        'no-match': 'That passkey doesn’t open this journal. Try another, or use your recovery code.',
        failed: 'Something went wrong. Try again, or use your recovery code.',
      }[problem];
      console.warn('[JournalLock] Fingerprint unlock failed:', err);
    } finally {
      busy = false;
    }
  }

  async function openCodeEntry() {
    error = '';
    usingCode = true;
    await Promise.resolve();
    codeInput?.focus();
  }

  async function useCode() {
    if (!code.trim()) return;
    error = '';
    busy = true;
    try {
      const ok = await unlockWithRecoveryCode(code);
      if (ok) {
        code = '';
        usingCode = false;
      } else {
        error = 'That code doesn’t match. Check it and try again.';
      }
    } catch (err) {
      console.warn('[JournalLock] Recovery code unlock failed:', err);
      error = 'Something went wrong. Try again.';
    } finally {
      busy = false;
    }
  }

  async function checkAgain() {
    error = '';
    checking = true;
    try {
      await refreshLockFromCloud();
    } catch {
      error = 'Couldn’t reach the cloud. Check your connection and try again.';
    } finally {
      checking = false;
    }
  }
</script>

<div class="jl-wrap" class:compact>
  <div class="jl-card" role="region" aria-label="Journal locked">
    <div class="jl-header">
      <span class="jl-icon"><LockSimple size={18} weight="bold" /><span class="icon-overlay"><LockSimple size={18} weight="thin" /></span></span>
      <div class="jl-header-text">
        <span class="jl-title">Journal locked</span>
        <span class="jl-sub">Scrambled on this device and in the cloud</span>
      </div>
    </div>

    <div class="jl-body">
      {#if noSlots}
        {#if $userProfileStore.isSignedIn}
          <p class="jl-note">Getting your journal lock from your account…</p>
          <button class="jl-btn-secondary" on:click={checkAgain} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        {:else}
          <p class="jl-note">Sign in to get your journal lock from your account.</p>
        {/if}
      {:else if usingCode}
        <label class="jl-label" for="jl-code">Recovery code</label>
        <input
          id="jl-code"
          class="jl-code"
          bind:this={codeInput}
          bind:value={code}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          on:keydown={(e) => e.key === 'Enter' && useCode()}
        />
        <div class="jl-actions">
          <button class="jl-btn-secondary" on:click={() => { usingCode = false; error = ''; }} disabled={busy}>Back</button>
          <button class="jl-btn-primary" on:click={useCode} disabled={busy || !code.trim()}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      {:else}
        {#if showFingerprint}
          <button class="jl-btn-primary jl-finger" on:click={useFingerprint} disabled={busy}>
            <Fingerprint size={20} weight="bold" />
            {busy ? 'Waiting for your fingerprint…' : 'Unlock with fingerprint'}
          </button>
        {:else if hasPasskeys && usable.length === 0}
          <p class="jl-note">Fingerprint unlock works at hexapla.app. Here, use your recovery code.</p>
        {:else if hasPasskeys && support === 'no'}
          <p class="jl-note">This browser can’t use a fingerprint for the journal. Use your recovery code.</p>
        {/if}
        {#if hasRecovery}
          <button class="jl-link" on:click={openCodeEntry} disabled={busy}>Use recovery code</button>
        {/if}
      {/if}

      {#if error}
        <p class="jl-error" role="alert">{error}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .jl-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 20px;
    box-sizing: border-box;
    overflow: auto;
    background: #141414;
  }
  .jl-wrap.compact {
    height: auto;
    padding: 4px 0;
    background: transparent;
  }

  .jl-card {
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .compact .jl-card {
    box-shadow: none;
    border-radius: 12px;
  }

  .jl-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .jl-icon {
    color: #1e1b4b;
    background: radial-gradient(circle, #a5b4fc 0%, #a5b4fc 20%, #1e1b4b 100%);
    border-radius: 6px;
    padding: 4px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    position: relative;
  }
  .icon-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }
  :global(.jl-icon > svg) {
    filter: drop-shadow(0 0 2px #1e1b4b) drop-shadow(0 0 2px #1e1b4b);
  }

  .jl-header-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .jl-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
  }
  .jl-sub {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }

  .jl-body {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 18px 20px 20px;
  }

  .jl-note {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.6);
  }

  .jl-label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #a5b4fc;
  }

  .jl-code {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: #111;
    color: #f0f0f0;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
  }
  .jl-code:focus {
    outline: none;
    border-color: #a5b4fc;
  }

  .jl-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .jl-btn-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #a5b4fc;
    color: #111;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .jl-btn-primary:hover:not(:disabled) {
    background: #c7d2fe;
  }
  .jl-finger {
    padding: 12px 16px;
  }

  .jl-btn-secondary {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }
  .jl-btn-secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .jl-link {
    align-self: center;
    background: none;
    border: none;
    color: #a5b4fc;
    font-size: 0.85rem;
    text-decoration: underline;
    cursor: pointer;
    padding: 4px;
  }

  .jl-error {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: #fca5a5;
  }
</style>
