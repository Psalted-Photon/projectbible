<script lang="ts">
  import { fly } from 'svelte/transition';
  import { CheckCircle, WarningCircle } from 'phosphor-svelte';
  import { notices, dismissNotice } from '../stores/noticeStore';
</script>

<!-- Same card as UpdateNotice, so every message the app shows looks alike.
     Tap one to dismiss it early. -->
<div class="an-wrap" role="status" aria-live="polite">
  {#each $notices as notice (notice.id)}
    <button
      type="button"
      class="an-card"
      class:error={notice.kind === 'error'}
      transition:fly={{ y: -16, duration: 250 }}
      on:click={() => dismissNotice(notice.id)}
    >
      <span class="an-icon">
        {#if notice.kind === 'error'}
          <WarningCircle size={20} weight="bold" />
        {:else}
          <CheckCircle size={20} weight="bold" />
        {/if}
      </span>
      <span class="an-text">{notice.text}</span>
    </button>
  {/each}
</div>

<style>
  .an-wrap {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 14px);
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    z-index: 10060;
    pointer-events: none;
  }

  .an-card {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(100%, 460px);
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 10px 18px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    cursor: pointer;
    text-align: left;
  }

  .an-icon {
    color: #e6b84a;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .an-card.error .an-icon {
    color: #e57373;
  }

  .an-text {
    font-family: 'Milonga', cursive;
    font-size: 1rem;
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.92);
    /* Some messages carry a line break, like a list of what failed. */
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
</style>
