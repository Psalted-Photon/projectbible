<script lang="ts" context="module">
  /** One place the copy could go. Worked out by the caller, who holds the lists. */
  export interface CopyDestination {
    id: string;
    name: string;
    /** A quiet second line — "Group · 4 people", a page count. */
    meta?: string;
  }
</script>

<script lang="ts">
  /**
   * Moving a page across the line between your own notebooks and a shared one.
   *
   * Both directions are a **copy**, never a link: a page you send to a study
   * group goes on being your page here, and a page you keep from one goes on
   * being theirs there. Whatever either side writes afterwards stays where it
   * was written. That is the whole of the promise, and it is said on the sheet
   * rather than left for somebody to discover by being surprised by it.
   *
   * One sheet for both, because the only thing that differs is which store the
   * copy lands in and what the destinations are called. The work is done here
   * rather than in the caller, the same way the create and join sheets do it,
   * so the busy state and the refusal have somewhere to be shown.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { sharedNotebookStore } from '../adapters/SharedNotebookStore';
  import { syncedNotebookStore } from '../adapters/SyncedNotebookStore';
  import { stripStamps } from '../lib/shared/paragraphStamp';
  import { errorText } from '../stores/noticeStore';

  export let mode: 'to-shared' | 'to-local';
  /** The page's stored title, which may be empty — copied across as it is. */
  export let title = '';
  /** What to call it on this sheet: its title, or its first line. */
  export let label = 'Untitled';
  /** The page's HTML. Sanitised again on the way into a shared notebook. */
  export let text = '';
  export let destinations: CopyDestination[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    copied: { id: string; name: string };
    createNew: void;
  }>();

  let busy = false;
  let problem = '';

  $: heading = mode === 'to-shared' ? 'Send a copy to' : 'Keep a copy in';
  // No longer a dead end in `to-shared` mode: the choice above the list is the
  // answer to not being in one yet, so this only says where things stand.
  $: emptyText =
    mode === 'to-shared'
      ? 'You are not in a shared notebook you can write in yet.'
      : 'You have no notebooks of your own yet.';

  async function copyTo(destination: CopyDestination) {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      if (mode === 'to-shared') {
        // The shared side sanitises and stamps it on the way in, so every
        // paragraph of the copy starts out credited to whoever sent it — which
        // is true: in that notebook, this page is theirs.
        await sharedNotebookStore.createPage({
          notebookId: destination.id,
          title,
          text,
        });
      } else {
        await syncedNotebookStore.createPage({
          notebookId: destination.id,
          title,
          text: stripStamps(text),
        });
      }
      dispatch('copied', { id: destination.id, name: destination.name });
    } catch (err) {
      problem = errorText(err);
      busy = false;
    }
  }

  function close() {
    if (busy) return;
    dispatch('close');
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('cp-backdrop')) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="cp-backdrop" on:click={handleBackdropClick}>
  <div class="cp-sheet" role="dialog" aria-modal="true" aria-label={heading}>
    <div class="cp-head">
      <span class="cp-title">{heading}</span>
      <button class="cp-close" on:click={close} aria-label="Close">✕</button>
    </div>

    <p class="cp-what">
      <span class="cp-page">“{label}”</span>
      <span class="cp-note">
        A copy. The page you are looking at stays exactly as it is, and later changes on either
        side stay where they are made.
      </span>
    </p>

    {#if mode === 'to-shared'}
      <!-- The destination might not exist yet, which is the commonest case the
           first time anybody opens this. It dispatches rather than doing the
           work: the create sheet is the caller's to open, and stacking one
           sheet inside another is worse than swapping them. -->
      <div class="cp-list cp-list-new">
        <button class="cp-choice cp-choice-new" disabled={busy} on:click={() => dispatch('createNew')}>
          <span class="cp-choice-name">New shared notebook</span>
          <span class="cp-choice-note">Make one, and this page goes in it.</span>
        </button>
      </div>
    {/if}

    {#if destinations.length === 0}
      <p class="cp-empty">{emptyText}</p>
    {:else}
      <div class="cp-list">
        {#each destinations as destination (destination.id)}
          <button class="cp-choice" disabled={busy} on:click={() => copyTo(destination)}>
            <span class="cp-choice-name">{destination.name}</span>
            {#if destination.meta}
              <span class="cp-choice-note">{destination.meta}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if problem}
      <p class="cp-problem">{problem}</p>
    {/if}

    <div class="cp-actions">
      <button class="cp-btn" on:click={close} disabled={busy}>
        {busy ? 'Copying…' : 'Cancel'}
      </button>
    </div>
  </div>
</div>

<style>
  .cp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 10000;
  }

  .cp-sheet {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 16px 16px 0 0;
    width: 100%;
    max-width: 480px;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.6);
    max-height: 90vh;
    overflow-y: auto;
  }

  .cp-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 14px;
  }

  .cp-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
    flex: 1;
  }

  .cp-close {
    background: none;
    border: none;
    color: #666;
    font-size: 0.875rem;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 4px;
  }
  .cp-close:hover {
    color: #ccc;
  }

  .cp-what {
    margin: 0 0 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cp-page {
    font-size: 0.875rem;
    color: #ddd;
    font-weight: 600;
  }

  .cp-note {
    font-size: 0.75rem;
    line-height: 1.5;
    color: #888;
  }

  .cp-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .cp-choice {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 10px 12px;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 0.15s, background 0.15s;
  }
  .cp-choice:hover:not(:disabled) {
    background: #1c1c1c;
    border-color: #2dd4bf;
  }
  .cp-choice:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Sits above the destinations rather than among them: a dashed edge so it
     reads as "somewhere new" beside the solid rows of places that exist. */
  .cp-list-new {
    margin-bottom: 10px;
  }

  .cp-choice-new {
    border-style: dashed;
    border-color: #3a3a3a;
  }
  .cp-choice-new:hover:not(:disabled) {
    border-color: #2dd4bf;
  }
  .cp-choice-new .cp-choice-name {
    color: #5eead4;
  }

  .cp-choice-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: #ddd;
  }

  .cp-choice-note {
    font-size: 0.75rem;
    color: #888;
  }

  .cp-empty {
    margin: 0 0 16px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #888;
  }

  .cp-problem {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: #fca5a5;
  }

  .cp-actions {
    display: flex;
    justify-content: flex-end;
  }

  .cp-btn {
    padding: 9px 20px;
    border-radius: 20px;
    border: 1px solid #3a3a3a;
    background: #2a2a2a;
    color: #ddd;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .cp-btn:hover:not(:disabled) {
    background: #333;
  }
  .cp-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
