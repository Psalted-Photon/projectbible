<script lang="ts">
  /**
   * Your badge in one shared notebook: two letters and a colour.
   *
   * Joining gives you both without asking — the letters from your name, the
   * colour worked out from your account id so that a phone and a laptop agree
   * without either of them having to read a roster it is not yet in. That is
   * the right trade for a join that should be one tap, and it leaves exactly
   * one thing over: the colour it picked may already be somebody else's in
   * this notebook. This is where that gets settled, and where anybody who
   * simply wants different letters changes them.
   *
   * Per notebook, because the colour's whole job is telling people apart
   * inside one group. The same person can be teal in one and amber in another,
   * and has to be able to be.
   *
   * The palette is the commentary palette. A member gets the badge a
   * commentator gets, which is the point — the reader has already taught
   * everybody that two letters on a coloured disc means "this is who said
   * this".
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import AuthorPill from './AuthorPill.svelte';
  import { sharedNotebookStore } from '../adapters/SharedNotebookStore';
  import type { SharedNotebook, SharedNotebookMember } from '../adapters/SharedNotebookStore';
  import { MEMBER_COLORS, defaultInitials } from '../lib/shared/memberIdentity';
  import { errorText } from '../stores/noticeStore';

  export let notebook: SharedNotebook;
  /** Your own member row in it. */
  export let member: SharedNotebookMember;
  /** Everybody else in the notebook, so their colours can be marked as taken. */
  export let others: SharedNotebookMember[] = [];

  const dispatch = createEventDispatcher<{ close: void; saved: SharedNotebookMember }>();

  let initials = member.initials || defaultInitials(member.displayName);
  let color = member.color;
  let busy = false;
  let problem = '';

  /**
   * Whose colour is whose, so a colour already in use can say so.
   *
   * Nothing stops you taking one anyway. Two people may well want the same
   * colour in a notebook of three, and refusing them would be this screen
   * deciding something that is theirs to decide — it says who has it and
   * leaves the choice alone.
   */
  $: takenBy = new Map(
    others
      .filter((m) => m.userId !== member.userId)
      .map((m) => [m.color.toLowerCase(), (m.displayName || 'Someone').trim()]),
  );

  /** What the badge will look like. Blank letters fall back rather than vanish. */
  $: preview = initials.trim() ? initials.trim().slice(0, 2) : defaultInitials(member.displayName);
  $: changed = preview !== member.initials || color !== member.color;

  async function apply() {
    if (busy || !changed) return;
    busy = true;
    problem = '';
    try {
      const saved = await sharedNotebookStore.updateMyBadge(notebook.id, {
        initials: preview,
        color,
      });
      dispatch('saved', saved);
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
    if ((e.target as HTMLElement).classList.contains('mp-backdrop')) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  /**
   * EdgeGestureDetector watches mousedown and touchstart on the whole window
   * to spot edge swipes, and only excuses rich-text areas — a plain input
   * loses focus to it mid-tap. Every input in the app that works stops these.
   */
  function guardPointer(e: Event) {
    e.stopPropagation();
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="mp-backdrop" on:click={handleBackdropClick}>
  <div class="mp-sheet" role="dialog" aria-modal="true" aria-label="Your badge">
    <div class="mp-head">
      <span class="mp-title">Your badge</span>
      <button class="mp-close" on:click={close} aria-label="Close">✕</button>
    </div>

    <p class="mp-note">
      This is how you are marked on the pages you write in
      <strong>{notebook.name || 'this notebook'}</strong>. Everybody sees the same colour.
    </p>

    <div class="mp-preview">
      <AuthorPill variant="round" size={34} {color} initials={preview} title={member.displayName} />
      <span class="mp-preview-name">{member.displayName || 'You'}</span>
    </div>

    <label class="mp-field">
      <span class="mp-label">Two letters</span>
      <input
        class="mp-input"
        maxlength="2"
        autocapitalize="characters"
        spellcheck="false"
        bind:value={initials}
        on:mousedown={guardPointer}
        on:touchstart={guardPointer}
        on:click={guardPointer}
        on:keydown={(e) => {
          if (e.key === 'Enter') apply();
        }}
      />
    </label>

    <div class="mp-field">
      <span class="mp-label">Colour</span>
      <div class="mp-swatches">
        {#each MEMBER_COLORS as swatch}
          {@const owner = takenBy.get(swatch.toLowerCase())}
          <button
            class="mp-swatch"
            class:active={swatch.toLowerCase() === color.toLowerCase()}
            class:taken={!!owner}
            style="--swatch:{swatch}"
            title={owner ? `${owner} has this one` : 'Use this colour'}
            aria-label={owner ? `${swatch}, ${owner} has this one` : swatch}
            on:click={() => (color = swatch)}
          ></button>
        {/each}
      </div>
      <p class="mp-hint">
        A dot means somebody here already has that one. You can still take it — it only makes the
        two of you harder to tell apart.
      </p>
    </div>

    {#if problem}
      <p class="mp-problem">{problem}</p>
    {/if}

    <div class="mp-actions">
      <button class="mp-btn mp-btn-quiet" on:click={close} disabled={busy}>Cancel</button>
      <button class="mp-btn mp-btn-go" on:click={apply} disabled={busy || !changed}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .mp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 10000;
  }

  .mp-sheet {
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

  .mp-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 12px;
  }

  .mp-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
    flex: 1;
  }

  .mp-close {
    background: none;
    border: none;
    color: #666;
    font-size: 0.875rem;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 4px;
  }
  .mp-close:hover {
    color: #ccc;
  }

  .mp-note {
    margin: 0 0 16px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #999;
  }
  .mp-note strong {
    color: #ccc;
    font-weight: 600;
  }

  .mp-preview {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 16px;
  }

  .mp-preview-name {
    font-size: 0.875rem;
    color: #ddd;
  }

  .mp-field {
    display: block;
    margin-bottom: 16px;
  }

  .mp-label {
    display: block;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #777;
    margin-bottom: 7px;
  }

  .mp-input {
    width: 84px;
    box-sizing: border-box;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    padding: 10px 12px;
    color: #e8e8e8;
    font-size: 0.9375rem;
    font-family: inherit;
    text-align: center;
    letter-spacing: 0.08em;
  }
  .mp-input:focus {
    outline: none;
    border-color: #2dd4bf;
  }

  .mp-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .mp-swatch {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--swatch);
    cursor: pointer;
    padding: 0;
    /* The ring sits outside the disc, so picking one does not make it jump. */
    box-shadow: 0 0 0 1px #2e2e2e;
  }

  .mp-swatch.active {
    border-color: #f0f0f0;
    box-shadow: 0 0 0 1px #2dd4bf;
  }

  /* A quiet dot in the corner. Deliberately not a cross: the colour is still
     yours to take, and a cross would read as "you cannot". */
  .mp-swatch.taken::after {
    content: '';
    position: absolute;
    right: 1px;
    bottom: 1px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #1e1e1e;
    border: 1px solid #777;
  }

  .mp-hint {
    margin: 9px 0 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: #777;
  }

  .mp-problem {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: #fca5a5;
  }

  .mp-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .mp-btn {
    padding: 9px 20px;
    border-radius: 20px;
    border: none;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .mp-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .mp-btn-quiet {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #3a3a3a;
  }
  .mp-btn-quiet:hover:not(:disabled) {
    background: #333;
  }

  .mp-btn-go {
    background: #0d9488;
    color: #fff;
    min-width: 110px;
  }
  .mp-btn-go:hover:not(:disabled) {
    background: #0f766e;
  }
</style>
