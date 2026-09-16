<script lang="ts">
  /**
   * Making a shared notebook: its name, and the two choices that are awkward
   * to change later.
   *
   * Both choices are the owner's and nobody else's, and both are put in plain
   * words rather than named — "Everyone writes" and "Only you write" say what
   * happens; Group and Broadcast are what the plan and the database call them.
   * Private is the default, and the public option is the one that gets the
   * warning, because it is the one that cannot be taken back from anybody who
   * already holds the link.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { sharedNotebookStore } from '../adapters/SharedNotebookStore';
  import type { SharedNotebook } from '../adapters/SharedNotebookStore';
  import { errorText } from '../stores/noticeStore';

  const dispatch = createEventDispatcher<{ close: void; created: SharedNotebook }>();

  let name = '';
  let kind: 'group' | 'broadcast' = 'group';
  let visibility: 'private' | 'public' = 'private';
  let busy = false;
  let problem = '';

  $: canCreate = name.trim().length > 0 && !busy;

  async function create() {
    if (!canCreate) return;
    busy = true;
    problem = '';
    try {
      const notebook = await sharedNotebookStore.createNotebook({
        name: name.trim(),
        kind,
        visibility,
      });
      dispatch('created', notebook);
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
    if ((e.target as HTMLElement).classList.contains('sn-backdrop')) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  /** The name is the only thing that has to be filled in — start the caret there. */
  function focusOnMount(node: HTMLElement) {
    setTimeout(() => node.focus(), 50);
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="sn-backdrop" on:click={handleBackdropClick}>
  <div class="sn-sheet" role="dialog" aria-modal="true" aria-label="New shared notebook">
    <div class="sn-head">
      <span class="sn-title">New shared notebook</span>
      <button class="sn-close" on:click={close} aria-label="Close">✕</button>
    </div>

    <label class="sn-field">
      <span class="sn-label">Name</span>
      <input
        class="sn-input"
        placeholder="Thursday study"
        maxlength="80"
        bind:value={name}
        use:focusOnMount
        on:keydown={(e) => {
          if (e.key === 'Enter') create();
        }}
      />
    </label>

    <div class="sn-field">
      <span class="sn-label">Who writes in it</span>
      <div class="sn-choices">
        <button class="sn-choice" class:active={kind === 'group'} on:click={() => (kind = 'group')}>
          <span class="sn-choice-name">Everyone writes</span>
          <span class="sn-choice-note">A study group. Everyone who joins can add pages.</span>
        </button>
        <button
          class="sn-choice"
          class:active={kind === 'broadcast'}
          on:click={() => (kind = 'broadcast')}
        >
          <span class="sn-choice-name">Only you write</span>
          <span class="sn-choice-note">Everyone who joins reads. For a class or a congregation.</span>
        </button>
      </div>
    </div>

    <div class="sn-field">
      <span class="sn-label">Who can see it</span>
      <div class="sn-choices">
        <button
          class="sn-choice"
          class:active={visibility === 'private'}
          on:click={() => (visibility = 'private')}
        >
          <span class="sn-choice-name">Private</span>
          <span class="sn-choice-note">You have to be signed in and have joined to read it.</span>
        </button>
        <button
          class="sn-choice"
          class:active={visibility === 'public'}
          on:click={() => (visibility = 'public')}
        >
          <span class="sn-choice-name">Public</span>
          <span class="sn-choice-note">Anyone with the link can read it without an account.</span>
        </button>
      </div>
    </div>

    {#if visibility === 'public'}
      <!-- Said once, here, where the choice is made. Writing still needs an
           account either way — this only ever opens up reading. -->
      <p class="sn-warn">
        Anybody you send the link to can read every page, and can pass the link on. Nobody can
        write in it without signing in and joining.
      </p>
    {/if}

    {#if problem}
      <p class="sn-problem">{problem}</p>
    {/if}

    <div class="sn-actions">
      <button class="sn-btn sn-btn-quiet" on:click={close} disabled={busy}>Cancel</button>
      <button class="sn-btn sn-btn-go" on:click={create} disabled={!canCreate}>
        {busy ? 'Creating…' : 'Create'}
      </button>
    </div>
  </div>
</div>

<style>
  .sn-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 10000;
  }

  .sn-sheet {
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

  .sn-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 16px;
  }

  .sn-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
    flex: 1;
  }

  .sn-close {
    background: none;
    border: none;
    color: #666;
    font-size: 0.875rem;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 4px;
  }
  .sn-close:hover {
    color: #ccc;
  }

  .sn-field {
    display: block;
    margin-bottom: 16px;
  }

  .sn-label {
    display: block;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #777;
    margin-bottom: 7px;
  }

  .sn-input {
    width: 100%;
    box-sizing: border-box;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    padding: 10px 12px;
    color: #e8e8e8;
    font-size: 0.9375rem;
    font-family: inherit;
  }
  .sn-input:focus {
    outline: none;
    border-color: #2dd4bf;
  }

  .sn-choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sn-choice {
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
  .sn-choice:hover {
    background: #1c1c1c;
  }
  .sn-choice.active {
    border-color: #2dd4bf;
    background: #12302c;
  }

  .sn-choice-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: #ddd;
  }
  .sn-choice.active .sn-choice-name {
    color: #5eead4;
  }

  .sn-choice-note {
    font-size: 0.75rem;
    color: #888;
    line-height: 1.4;
  }

  .sn-warn {
    margin: -6px 0 16px;
    font-size: 0.75rem;
    line-height: 1.5;
    color: #fbbf24;
    background: #2a2010;
    border: 1px solid #4a3a14;
    border-radius: 8px;
    padding: 9px 11px;
  }

  .sn-problem {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: #fca5a5;
  }

  .sn-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .sn-btn {
    padding: 9px 20px;
    border-radius: 20px;
    border: none;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .sn-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sn-btn-quiet {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #3a3a3a;
  }
  .sn-btn-quiet:hover:not(:disabled) {
    background: #333;
  }

  .sn-btn-go {
    background: #0d9488;
    color: #fff;
    min-width: 110px;
  }
  .sn-btn-go:hover:not(:disabled) {
    background: #0f766e;
  }
</style>
