<script lang="ts">
  // A password box with an eye button: tap it to see what you typed, tap
  // again to go back to dots. Every password field in the app uses this.
  import { Eye, EyeSlash } from 'phosphor-svelte';

  export let value = '';
  export let label: string;
  export let placeholder = '';
  export let autocomplete: 'current-password' | 'new-password' | 'off' = 'off';
  /** Border color: '' plain, 'ok' gold, 'error' red. */
  export let state: '' | 'ok' | 'error' = '';
  export let onEnter: (() => void) | undefined = undefined;

  let shown = false;
</script>

<div class="pw-wrap">
  <input
    aria-label={label}
    class="pw-input"
    class:match-ok={state === 'ok'}
    class:match-error={state === 'error'}
    type={shown ? 'text' : 'password'}
    {placeholder}
    {autocomplete}
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    bind:value
    on:keydown={(e) => e.key === 'Enter' && onEnter?.()}
  />
  <!-- mousedown is cancelled so tapping the eye leaves the cursor (and the
       phone keyboard) in the box. -->
  <button
    type="button"
    class="pw-eye"
    aria-label={shown ? 'Hide password' : 'Show password'}
    aria-pressed={shown}
    on:mousedown|preventDefault
    on:click={() => (shown = !shown)}
  >
    {#if shown}
      <EyeSlash size={20} />
    {:else}
      <Eye size={20} />
    {/if}
  </button>
</div>

<style>
  .pw-wrap {
    position: relative;
    display: flex;
  }

  /* Matches .auth-input in ProfileModal, with room on the right for the eye. */
  .pw-input {
    flex: 1;
    min-width: 0;
    padding: 11px 46px 11px 13px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: #121212;
    color: inherit;
    transition: border-color 0.15s;
  }

  .pw-input:focus {
    outline: none;
    border-color: rgba(230, 184, 74, 0.6);
  }

  .pw-input.match-ok {
    border-color: rgba(230, 184, 74, 0.55);
  }

  .pw-input.match-error {
    border-color: #e57373;
  }

  /* Edge's own reveal button would sit beside ours. */
  .pw-input::-ms-reveal {
    display: none;
  }

  .pw-eye {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
    border-radius: 0 8px 8px 0;
  }

  .pw-eye:hover,
  .pw-eye[aria-pressed='true'] {
    color: rgba(230, 184, 74, 0.9);
  }

  .pw-eye:focus-visible {
    outline: 2px solid rgba(230, 184, 74, 0.6);
    outline-offset: -2px;
  }
</style>
