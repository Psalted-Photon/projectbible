<script lang="ts">
  /**
   * What a mic press opens when something it needs is missing
   * (lib/voice/holdToTalk.ts): Voice Control's download, a word on what the
   * mic is for before the browser asks the first time, how to allow a blocked
   * mic again, or that no mic is plugged in.
   *
   * Looks like the app's questions (AppConfirm.svelte). A tap outside, × or
   * Escape closes it.
   */
  import { onMount } from 'svelte';
  import { fade, fly } from '../lib/motion';
  import { Microphone, MicrophoneSlash, DownloadSimple } from 'phosphor-svelte';
  import { portal } from '../lib/portal';
  import CloseX from './CloseX.svelte';
  import VoiceControlDownloads from './VoiceControlDownloads.svelte';
  import { voiceCard, voiceReady, allowMic } from '../lib/voice/holdToTalk';

  let asking = false;

  // Downloaded from the card: nothing left to say ("Voice Control is
  // downloaded" is already a notice).
  $: if ($voiceCard === 'download' && $voiceReady.installed) voiceCard.set(null);
  // Plugged in while the card was up.
  $: if ($voiceCard === 'nomic' && $voiceReady.mic) voiceCard.set(null);

  function close() {
    voiceCard.set(null);
  }

  async function continueToBrowser() {
    asking = true;
    try {
      await allowMic();
    } finally {
      asking = false;
    }
  }

  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (!$voiceCard || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  });
</script>

{#if $voiceCard}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="vcard-backdrop" use:portal transition:fade={{ duration: 150 }} on:click={close}>
    <div
      class="vcard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vcard-title"
      tabindex="-1"
      in:fly={{ y: -16, duration: 250 }}
      on:click|stopPropagation
    >
      <CloseX class="vcard-close" label="Close" on:click={close} />

      {#if $voiceCard === 'download'}
        <h3 id="vcard-title"><DownloadSimple size={20} weight="bold" /> Voice Control</h3>
        <p>
          Voice Control needs a one-time download. After that it works offline, and
          nothing you say leaves this device.
        </p>
        <VoiceControlDownloads ids={['voice-control']} />
      {:else if $voiceCard === 'ask'}
        <h3 id="vcard-title"><Microphone size={20} weight="bold" /> The microphone</h3>
        <p>
          Voice Control hears you through the microphone, only while you hold the
          button. What you say stays on this device.
        </p>
        <p class="quiet">Your browser asks next. Choose Allow.</p>
        <div class="actions">
          <button type="button" class="btn" on:click={close}>Not now</button>
          <button type="button" class="btn yes" disabled={asking} on:click={continueToBrowser}>Continue</button>
        </div>
      {:else if $voiceCard === 'blocked'}
        <h3 id="vcard-title"><MicrophoneSlash size={20} weight="bold" /> The microphone is blocked</h3>
        <p>The browser was told not to let irisBible use the microphone. To allow it again:</p>
        <ul>
          <li><strong>On a computer:</strong> click the icon to the left of the address, then turn Microphone on.</li>
          <li>
            <strong>On a phone:</strong> open Chrome, tap ⋮, then Settings, Site settings, Microphone, and
            allow irisbible.com.
          </li>
        </ul>
        <p class="quiet">Then come back and hold the mic again.</p>
        <div class="actions">
          <button type="button" class="btn yes" on:click={close}>OK</button>
        </div>
      {:else}
        <h3 id="vcard-title"><MicrophoneSlash size={20} weight="bold" /> No microphone found</h3>
        <p>Plug one in, or check that it's switched on. The mic button comes alive as soon as there is one.</p>
        <div class="actions">
          <button type="button" class="btn yes" on:click={close}>OK</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .vcard-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.45);
    /* Over the mic button and the players, under notices. */
    z-index: 10058;
  }

  .vcard {
    position: relative;
    width: min(100%, 420px);
    max-height: calc(100% - 32px);
    overflow-y: auto;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 16px 18px 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    color: rgba(255, 255, 255, 0.92);
  }

  .vcard :global(.vcard-close) {
    position: absolute;
    top: 4px;
    right: 4px;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 32px 10px 0;
    font-size: 1.05rem;
    color: #e6b84a;
  }

  p,
  li {
    margin: 0 0 8px;
    font-size: 0.92rem;
    line-height: 1.45;
  }

  ul {
    margin: 0 0 8px;
    padding-left: 18px;
  }

  .quiet {
    color: #999;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .btn {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.95rem;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
  }

  .btn.yes {
    border-color: transparent;
    background: #e6b84a;
    color: #1c1c1e;
    font-weight: 600;
  }

  .btn.yes:hover:not(:disabled) {
    background: #f0c75e;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
