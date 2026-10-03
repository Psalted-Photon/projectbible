<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { Question, WarningCircle } from 'phosphor-svelte';
  import { confirms, answerConfirm } from '../stores/confirmStore';

  $: current = $confirms[0] ?? null;

  function answer(ok: boolean) {
    if (current) answerConfirm(current.id, ok);
  }

  // Escape means no. Caught before anything else hears it, so the same press
  // doesn't also close the modal or pane the question was asked from.
  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (!current || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      answer(false);
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  });
</script>

<!-- Same card as AppNotice, so a question looks like the rest of the app's
     messages. A tap outside the card counts as Cancel. -->
{#if current}
  {#key current.id}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="ac-backdrop" transition:fade={{ duration: 150 }} on:click={() => answer(false)}>
      <div
        class="ac-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ac-text"
        tabindex="-1"
        in:fly={{ y: -16, duration: 250 }}
        on:click|stopPropagation
      >
        <div class="ac-body">
          <span class="ac-icon" class:danger={current.danger}>
            {#if current.danger}
              <WarningCircle size={22} weight="bold" />
            {:else}
              <Question size={22} weight="bold" />
            {/if}
          </span>
          <p class="ac-text" id="ac-text">{current.message}</p>
        </div>
        <div class="ac-actions">
          <button type="button" class="ac-btn" on:click={() => answer(false)}>{current.cancelLabel}</button>
          <button
            type="button"
            class="ac-btn ac-yes"
            class:danger={current.danger}
            on:click={() => answer(true)}
          >{current.confirmLabel}</button>
        </div>
      </div>
    </div>
  {/key}
{/if}

<style>
  .ac-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.45);
    /* Over everything, the tutorial included (--tut-z is 100000): the tour's
       Install everything can raise the space warning, and a question hidden
       behind the tour card could never be answered. */
    z-index: 100050;
  }

  .ac-card {
    width: min(100%, 420px);
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 16px 18px 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }

  .ac-body {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .ac-icon {
    color: #e6b84a;
    display: flex;
    flex-shrink: 0;
    padding-top: 1px;
  }

  .ac-icon.danger {
    color: #e57373;
  }

  .ac-text {
    margin: 0;
    font-family: 'Milonga', cursive;
    font-size: 1rem;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.92);
    /* Some questions carry a paragraph break. */
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .ac-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  .ac-btn {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.95rem;
    cursor: pointer;
  }

  .ac-btn:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .ac-yes {
    border-color: transparent;
    background: #e6b84a;
    color: #1c1c1e;
    font-weight: 600;
  }

  .ac-yes:hover {
    background: #f0c75e;
  }

  .ac-yes.danger {
    background: #c94f4f;
    color: #fff;
  }

  .ac-yes.danger:hover {
    background: #d95f5f;
  }
</style>
