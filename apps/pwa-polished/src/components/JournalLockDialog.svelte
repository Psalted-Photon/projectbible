<script lang="ts">
  /**
   * The step-by-step dialog for turning the journal lock on.
   *
   * Nothing is saved until the last step: cancelling before then forgets the
   * new key and the passkey it made. Setup says plainly that losing both the
   * passkey and the recovery code loses the journal, and asks twice — once
   * up front, and again on the button that turns it on.
   */
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { LockSimple, Fingerprint, Copy, Check, Warning } from 'phosphor-svelte';
  import { journalLock } from '../lib/journalLock/lockState';
  import {
    addFingerprintToDraft, discardDraft, finishTurnOn, JournalLockError, startTurnOn, type LockDraft,
  } from '../lib/journalLock/actions';
  import { fingerprintSupport, PasskeyError } from '../lib/journalLock/passkey';
  import { lastGroupOf } from '../lib/journalLock/recoveryCode';

  const dispatch = createEventDispatcher<{ close: void }>();

  type Step = 'intro' | 'preparing' | 'fingerprint' | 'code' | 'confirm' | 'working' | 'done';

  let step: Step = 'intro';
  let understood = false;
  let draft: LockDraft | null = null;
  let error = '';
  let busy = false;
  let fingerprintUnavailable = false;
  let copied = false;
  let typedGroup = '';
  let scrambledTotal = 0;

  onMount(() => {
    fingerprintSupport().then((s) => (fingerprintUnavailable = s === 'no'));
  });

  onDestroy(() => {
    // Closed partway: nothing was saved, so leave nothing behind.
    if (draft && step !== 'working' && step !== 'done') discardDraft(draft);
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $: code = draft?.recoveryCode ?? '';
  // Read the typed group the way a recovery code is read: any case, and the
  // look-alike letters as the digits they resemble.
  $: typedNormal = typedGroup.toUpperCase().replace(/\s/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  $: groupMatches = !!code && typedNormal === lastGroupOf(code);
  $: canClose = step !== 'working' && step !== 'preparing';

  function close() {
    if (!canClose) return;
    dispatch('close');
  }

  function problemText(err: unknown): string {
    if (err instanceof JournalLockError) return err.message;
    if (err instanceof PasskeyError) {
      if (err.problem === 'cancelled') return 'Cancelled. Tap the button to try again.';
      if (err.problem === 'unsupported') {
        fingerprintUnavailable = true;
        return 'This browser can’t use a fingerprint for the journal.';
      }
    }
    console.error('[JournalLock] Setup step failed:', err);
    return 'Something went wrong. Try again.';
  }

  async function prepare() {
    step = 'preparing';
    error = '';
    try {
      draft = await startTurnOn();
      step = 'fingerprint';
    } catch (err) {
      error = problemText(err);
      step = 'intro';
    }
  }

  async function addFingerprint() {
    if (!draft) return;
    error = '';
    busy = true;
    try {
      await addFingerprintToDraft(draft);
      step = 'code';
    } catch (err) {
      error = problemText(err);
    } finally {
      busy = false;
    }
  }

  function skipFingerprint() {
    error = '';
    step = 'code';
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // No clipboard permission: the code is on screen to copy by hand.
    }
  }

  async function turnOn() {
    if (!draft || !groupMatches) return;
    error = '';
    step = 'working';
    try {
      await finishTurnOn(draft);
      draft = null;
      step = 'done';
    } catch (err) {
      error = problemText(err);
      step = 'confirm';
    }
  }

  $: if ($journalLock.work) scrambledTotal = $journalLock.work.total;
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="ld-overlay" use:portal on:click={close}>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="ld-card" on:click|stopPropagation role="dialog" aria-modal="true" aria-label="Lock your journal" tabindex="-1">
    <div class="ld-header">
      <span class="ld-icon"><LockSimple size={18} weight="bold" /><span class="icon-overlay"><LockSimple size={18} weight="thin" /></span></span>
      <span class="ld-title">Lock your journal</span>
    </div>

    <div class="ld-body">
      {#if step === 'intro' || step === 'preparing'}
        <p>Your fingerprint or face will be needed before the Journal opens.</p>
        <p>Every title and entry gets scrambled, on this device and in the cloud. Only your own devices can unscramble them.</p>
        <p>You’ll also get a recovery code as a backup, for a new device or if the fingerprint ever stops working.</p>
        <div class="ld-warn">
          <Warning size={18} weight="bold" />
          <span>If you lose both your fingerprint passkey and your recovery code, your journal is gone for good. Nobody can get it back.</span>
        </div>
        <label class="ld-check">
          <input type="checkbox" bind:checked={understood} disabled={step === 'preparing'} />
          <span>I understand</span>
        </label>
      {:else if step === 'fingerprint'}
        {#if fingerprintUnavailable}
          <p>This browser can’t use a fingerprint for the journal.</p>
          <p>You can still lock it with just the recovery code, but you’ll need to type the code each time the Journal opens. Or cancel, and turn the lock on from Safari or Chrome on your phone.</p>
        {:else}
          <p>Your device will ask for your fingerprint or face. It may ask twice.</p>
          <p class="ld-quiet">A passkey called “Hexapla journal lock” gets saved in your password manager. Don’t delete it.</p>
        {/if}
      {:else if step === 'code'}
        <p>This is your recovery code. It’s shown only this once.</p>
        <div class="ld-code" aria-label="Recovery code">{code}</div>
        <button class="ld-btn-secondary ld-copy" on:click={copyCode}>
          {#if copied}<Check size={16} weight="bold" /> Copied{:else}<Copy size={16} weight="bold" /> Copy{/if}
        </button>
        <p class="ld-quiet">Write it down, or save it in your password manager. You’ll need it on a new device.</p>
      {:else if step === 'confirm'}
        <label class="ld-label" for="ld-group">Type the last group of your recovery code</label>
        <input
          id="ld-group"
          class="ld-group"
          bind:value={typedGroup}
          maxlength="4"
          placeholder="XXXX"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
        />
        <div class="ld-warn">
          <Warning size={18} weight="bold" />
          <span>Last check: without your fingerprint or this code, your journal can’t be opened.</span>
        </div>
      {:else if step === 'working'}
        {#if $journalLock.work}
          <p>Scrambling your journal… {$journalLock.work.done} of {$journalLock.work.total}</p>
          <div class="ld-bar"><div style="width: {Math.round(($journalLock.work.done / Math.max(1, $journalLock.work.total)) * 100)}%"></div></div>
        {:else}
          <p>Saving your lock…</p>
          <div class="ld-bar indeterminate"><div></div></div>
        {/if}
        <p class="ld-quiet">Keep the app open until this finishes. If it’s interrupted, it picks up where it stopped next time you unlock.</p>
      {:else if step === 'done'}
        <p>Your journal is locked.</p>
        {#if scrambledTotal > 0}
          <p class="ld-quiet">{scrambledTotal} {scrambledTotal === 1 ? 'entry was' : 'entries were'} scrambled.</p>
        {/if}
        <p class="ld-quiet">It locks again when you leave the app for longer than the time set in Settings → Privacy.</p>
      {/if}

      {#if error}
        <p class="ld-error" role="alert">{error}</p>
      {/if}
    </div>

    <div class="ld-actions">
      {#if step === 'intro' || step === 'preparing'}
        <button class="ld-btn-secondary" on:click={close} disabled={step === 'preparing'}>Cancel</button>
        <button class="ld-btn-primary" on:click={prepare} disabled={!understood || step === 'preparing'}>
          {step === 'preparing' ? 'Finishing your sync…' : 'Continue'}
        </button>
      {:else if step === 'fingerprint'}
        <button class="ld-btn-secondary" on:click={close} disabled={busy}>Cancel</button>
        {#if fingerprintUnavailable}
          <button class="ld-btn-primary" on:click={skipFingerprint}>Use the recovery code only</button>
        {:else}
          <button class="ld-btn-primary" on:click={addFingerprint} disabled={busy}>
            <Fingerprint size={18} weight="bold" /> {busy ? 'Waiting…' : 'Use fingerprint'}
          </button>
        {/if}
      {:else if step === 'code'}
        <button class="ld-btn-secondary" on:click={close}>Cancel</button>
        <button class="ld-btn-primary" on:click={() => { error = ''; step = 'confirm'; }}>I’ve saved it</button>
      {:else if step === 'confirm'}
        <button class="ld-btn-secondary" on:click={() => { error = ''; step = 'code'; }}>Show the code again</button>
        <button class="ld-btn-danger" on:click={turnOn} disabled={!groupMatches}>Turn on the lock</button>
      {:else if step === 'done'}
        <button class="ld-btn-primary" on:click={close}>Done</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .ld-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10050;
    padding: 20px;
    backdrop-filter: blur(4px);
  }

  .ld-card {
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    max-width: 460px;
    width: 100%;
    max-height: calc(100vh - 40px);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .ld-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .ld-icon {
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
  :global(.ld-icon > svg) {
    filter: drop-shadow(0 0 2px #1e1b4b) drop-shadow(0 0 2px #1e1b4b);
  }

  .ld-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
  }

  .ld-body {
    padding: 18px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: rgba(255, 255, 255, 0.82);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .ld-body p {
    margin: 0;
  }
  .ld-quiet {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.82rem;
  }

  .ld-warn {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.25);
    color: #fecaca;
    font-size: 0.85rem;
  }
  .ld-warn :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: #f87171;
  }

  .ld-check {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-weight: 600;
  }
  .ld-check input {
    width: 20px;
    height: 20px;
    accent-color: #a5b4fc;
  }

  .ld-code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-align: center;
    padding: 14px 10px;
    border-radius: 10px;
    background: #111;
    border: 1px dashed rgba(165, 180, 252, 0.45);
    color: #e0e7ff;
    user-select: all;
    word-break: break-all;
  }

  .ld-copy {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ld-label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #a5b4fc;
  }

  .ld-group {
    width: 8ch;
    box-sizing: content-box;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: #111;
    color: #f0f0f0;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 1.1rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .ld-group:focus {
    outline: none;
    border-color: #a5b4fc;
  }

  .ld-bar {
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .ld-bar > div {
    height: 100%;
    background: #a5b4fc;
    transition: width 0.2s ease;
  }
  .ld-bar.indeterminate > div {
    width: 35%;
    animation: ld-slide 1.1s ease-in-out infinite;
  }
  @keyframes ld-slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(300%); }
  }

  .ld-error {
    color: #fca5a5;
    font-size: 0.85rem;
  }

  .ld-actions {
    display: flex;
    gap: 10px;
    padding: 14px 20px 16px;
    justify-content: flex-end;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .ld-btn-primary,
  .ld-btn-danger {
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .ld-btn-primary {
    background: #a5b4fc;
    color: #111;
  }
  .ld-btn-primary:hover:not(:disabled) {
    background: #c7d2fe;
  }
  .ld-btn-danger {
    background: #f87171;
    color: #111;
  }
  .ld-btn-danger:hover:not(:disabled) {
    background: #fca5a5;
  }

  .ld-btn-secondary {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }
  .ld-btn-secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (max-width: 520px) {
    .ld-card {
      border-radius: 12px;
    }
    .ld-actions {
      flex-direction: column-reverse;
    }
    .ld-actions button {
      width: 100%;
      justify-content: center;
    }
  }
</style>
