<script lang="ts">
  /**
   * Welcome to irisBible: the first screen of the tour.
   *
   * The iris floats over the wordmark, on the ground the wordmark's current
   * look was drawn on: cream or night, by the time of day and the day's
   * parity (lib/wordmark.ts).
   */
  import { createEventDispatcher, onMount } from "svelte";
  import { fade } from "../../lib/motion";
  import Wordmark from "../../components/Wordmark.svelte";
  import { WORDMARKS, wordmarkAt } from "../../lib/wordmark";
  import { APP_NAME, TAGLINE, START_LABEL, SKIP_LABEL, TURN_OFF_HINT } from "../content/splash";

  const dispatch = createEventDispatcher<{ start: void; skip: void }>();

  let startButton: HTMLButtonElement;

  const code = wordmarkAt();
  const look = WORDMARKS[code];
  const onCream = look.ground.toLowerCase() === "#fffaed";

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
  class="splash no-edge-gesture"
  class:on-cream={onCream}
  style="background: {look.ground};"
  role="dialog"
  aria-modal="true"
  aria-label="Welcome to {APP_NAME}"
  transition:fade={{ duration: 260 }}
>
  <div class="board">
    <img class="gem" src="/Logo.png" alt="" draggable="false" />
    <h1 class="name"><Wordmark {code} /></h1>
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
    overflow-y: auto;
  }

  .board {
    /* Logo.png is the iris, a full circle filling its 1024 square. Every size
       below hangs off this one number. */
    --gem: min(62vw, 34vh, 340px);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 100%;
  }

  .gem {
    width: var(--gem);
    height: var(--gem);
    margin: 0 0 1.4rem;
    user-select: none;
    animation: rise 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .name {
    margin: 0;
    /* The wordmark's shadows reach about a third of an em past the letters. */
    padding: 0.1em 0.2em 0.18em;
    font-size: clamp(3.2rem, 17vw, 6rem);
    line-height: 1;
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

  /* On the cream ground the tour's night-time colors turn dark. */
  .on-cream .tagline,
  .on-cream .hint {
    color: #5c5546;
  }
  .on-cream :global(.tut-btn-ghost) {
    color: #2a2618;
    border-color: rgba(42, 38, 24, 0.35);
  }
  .on-cream :global(.tut-btn-ghost:hover) {
    background: rgba(42, 38, 24, 0.08);
  }
  .on-cream :global(.tut-btn) {
    box-shadow: 0 0 0 1px rgba(11, 15, 0, 0.18);
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

  /* Reduced or Off in Settings → Appearance → Motion (which follows the
     device's own switch by default). */
  :global(:root:not([data-motion="full"])) .gem,
  :global(:root:not([data-motion="full"])) .name,
  :global(:root:not([data-motion="full"])) .tagline,
  :global(:root:not([data-motion="full"])) .actions,
  :global(:root:not([data-motion="full"])) .hint {
    animation: none;
  }
</style>
