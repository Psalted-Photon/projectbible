<script lang="ts">
  /**
   * Welcome to Hexapla: the first screen of the tour.
   *
   * A chalkboard: pure black, so the logo's own black tile vanishes and only
   * the gem floats, with the name written under it in chalk.
   */
  import { createEventDispatcher, onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { APP_NAME, TAGLINE, START_LABEL, SKIP_LABEL, TURN_OFF_HINT } from "../content/splash";

  const dispatch = createEventDispatcher<{ start: void; skip: void }>();

  let startButton: HTMLButtonElement;

  onMount(() => {
    startButton?.focus({ preventScroll: true });
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      dispatch("skip");
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  class="splash"
  role="dialog"
  aria-modal="true"
  aria-label="Welcome to {APP_NAME}"
  transition:fade={{ duration: 260 }}
>
  <div class="board">
    <img class="gem" src="/Logo.png" alt="" draggable="false" />
    <h1 class="name">{APP_NAME}</h1>
    {#if TAGLINE}
      <p class="tagline">{TAGLINE}</p>
    {/if}

    <div class="actions">
      <button class="tut-btn" bind:this={startButton} on:click={() => dispatch("start")}>
        {START_LABEL}
      </button>
      <button class="tut-btn-ghost" on:click={() => dispatch("skip")}>{SKIP_LABEL}</button>
    </div>

    <p class="hint">{TURN_OFF_HINT}</p>
  </div>
</div>

<style>
  .splash {
    position: fixed;
    inset: 0;
    z-index: var(--tut-z);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
    background: var(--tut-board);
    overflow-y: auto;
  }

  .board {
    /* Logo.png is 1024 square with the gem in its middle half, so the image is
       drawn large and its empty black margins are pulled in with negative
       space. Every size below hangs off this one number. */
    --gem: min(78vw, 44vh, 420px);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 100%;
  }

  .gem {
    width: var(--gem);
    height: var(--gem);
    margin: calc(var(--gem) * -0.16) 0 calc(var(--gem) * -0.2);
    user-select: none;
    animation: rise 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .name {
    margin: 0;
    font-family: var(--tut-display);
    font-weight: 400;
    font-size: clamp(3rem, 15vw, 5.75rem);
    line-height: 1.05;
    letter-spacing: 0.02em;
    color: var(--tut-chalk);
    /* Chalk dust: a soft bloom around each stroke, never a hard shadow. */
    text-shadow:
      0 0 1px rgba(241, 238, 228, 0.55),
      0 0 14px rgba(241, 238, 228, 0.1);
    animation: rise 0.9s 0.15s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .tagline {
    margin: 0.6rem 0 0;
    max-width: 30ch;
    color: var(--tut-muted);
    font-size: 1.05rem;
    line-height: 1.4;
    animation: rise 0.9s 0.25s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    margin-top: 2.4rem;
    animation: rise 0.9s 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .hint {
    margin: 1.6rem 0 0;
    color: var(--tut-muted);
    font-size: 0.8rem;
    letter-spacing: 0.02em;
    animation: rise 0.9s 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .gem,
    .name,
    .tagline,
    .actions,
    .hint {
      animation: none;
    }
  }
</style>
