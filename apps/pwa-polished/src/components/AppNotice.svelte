<script lang="ts">
  import { fly } from '../lib/motion';
  import { CheckCircle, Info, WarningCircle, ArrowClockwise, Fingerprint } from 'phosphor-svelte';
  import { notices, dismissNotice } from '../stores/noticeStore';
</script>

<!-- Same card as UpdateNotice, so every message the app shows looks alike.
     Tap one to dismiss it early. One with an action (the Restart after an
     install) carries its own button beside the text; one with a second
     button too (a question, like the journal's fingerprint offer) puts both
     under the text, where there's room for them on a phone. -->
<div class="an-wrap" role="status" aria-live="polite">
  {#each $notices as notice (notice.id)}
    {@const action = notice.action}
    {@const secondary = notice.secondary}
    <div class="an-card" class:error={notice.kind === 'error'} class:two={!!secondary} transition:fly={{ y: -16, duration: 250 }}>
      <button type="button" class="an-body" on:click={() => dismissNotice(notice.id)}>
        <span class="an-icon">
          {#if notice.icon === 'fingerprint'}
            <Fingerprint size={20} weight="bold" />
          {:else if notice.kind === 'error'}
            <WarningCircle size={20} weight="bold" />
          {:else if notice.kind === 'info'}
            <Info size={20} weight="bold" />
          {:else}
            <CheckCircle size={20} weight="bold" />
          {/if}
        </span>
        <span class="an-text">{notice.text}</span>
      </button>
      {#if action && secondary}
        <div class="an-buttons">
          <button
            type="button"
            class="an-secondary"
            on:click={() => {
              dismissNotice(notice.id);
              secondary.run();
            }}
          >
            {secondary.label}
          </button>
          <button
            type="button"
            class="an-action"
            on:click={() => {
              dismissNotice(notice.id);
              action.run();
            }}
          >
            {#if action.icon === 'fingerprint'}<Fingerprint size={16} weight="bold" />{:else}<ArrowClockwise size={16} weight="bold" />{/if}
            {action.label}
          </button>
        </div>
      {:else if action}
        <button
          type="button"
          class="an-action"
          on:click={() => {
            dismissNotice(notice.id);
            action.run();
          }}
        >
          {#if action.icon === 'fingerprint'}<Fingerprint size={16} weight="bold" />{:else}<ArrowClockwise size={16} weight="bold" />{/if}
          {action.label}
        </button>
      {/if}
    </div>
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
    gap: 6px;
    max-width: min(100%, 460px);
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 0 8px 0 0;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
  }

  .an-body {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 10px 10px 10px 18px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  /* The Get packs card's Restart button. */
  .an-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid #e6b84a;
    border-radius: 8px;
    background: transparent;
    color: #e6b84a;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .an-action:hover {
    background: rgba(230, 184, 74, 0.12);
  }

  /* Two buttons: the text on top, the buttons in a row beneath it. */
  .an-card.two {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 0;
  }

  .an-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 0 10px 10px;
  }

  .an-secondary {
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .an-secondary:hover {
    background: rgba(255, 255, 255, 0.08);
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
