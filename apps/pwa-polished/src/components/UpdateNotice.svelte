<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { CheckCircle } from 'phosphor-svelte';

  let show = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    // Set by the auto-update routine in App.svelte just before it reloads the
    // page into a freshly activated service worker.
    if (sessionStorage.getItem('pb-updated')) {
      sessionStorage.removeItem('pb-updated');
      show = true;
      hideTimer = setTimeout(() => (show = false), 5000);
    }
    return () => clearTimeout(hideTimer);
  });

  function dismiss() {
    clearTimeout(hideTimer);
    show = false;
  }
</script>

{#if show}
  <div class="un-wrap">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="un-card"
      role="status"
      transition:fly={{ y: -16, duration: 250 }}
      on:click={dismiss}
    >
      <span class="un-icon"><CheckCircle size={20} weight="bold" /></span>
      <span class="un-text">Running Latest Version</span>
    </div>
  </div>
{/if}

<style>
  .un-wrap {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 14px);
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    z-index: 10001;
    pointer-events: none;
  }

  .un-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 10px 18px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    cursor: pointer;
  }

  .un-icon {
    color: #e6b84a;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .un-text {
    font-family: 'Milonga', cursive;
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.92);
    white-space: nowrap;
  }
</style>
