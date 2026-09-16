<script lang="ts">
  /**
   * A public notebook, read with no account at all.
   *
   * This is the whole of what a signed-out reader ever gets, and it is
   * deliberately a dead end. There is no editor on this screen, no button that
   * writes, and no way to reach another notebook from it — the one function
   * behind it answers only for a notebook whose owner marked it public, only
   * for a code the reader already holds, and accepts nothing back.
   *
   * It is also not a member. Nothing is written to IndexedDB, nothing syncs,
   * and no realtime connection is held: the pages are read once and kept in
   * memory, and a single revision number is what says whether to read them
   * again. That is what lets a great many people read one notebook at once
   * without a socket each.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { ArrowLeft } from 'phosphor-svelte';
  import SharedPageView from './SharedPageView.svelte';
  import AuthorPill from './AuthorPill.svelte';
  import { sharedNotebookStore } from '../adapters/SharedNotebookStore';
  import type { PublicSharedNotebook, SharedNotebookPage } from '../adapters/SharedNotebookStore';
  import { profileModalStore } from '../stores/profileModalStore';
  import { errorText } from '../stores/noticeStore';

  /** The code this was opened with — the only way back to the server. */
  export let code: string;
  /** Read before this opened, so there is never an empty frame. */
  export let data: PublicSharedNotebook;

  const dispatch = createEventDispatcher<{ close: void }>();

  let open: SharedNotebookPage | null = null;
  let refreshing = false;
  let problem = '';

  $: notebook = data.notebook;
  $: pages = data.pages;

  function memberFor(userId: string) {
    return data.members.find((m) => m.userId === userId) ?? null;
  }

  function nameFor(userId: string): string {
    const name = (memberFor(userId)?.displayName ?? '').trim();
    return name || 'Someone';
  }

  function pageLabel(page: SharedNotebookPage): string {
    const title = (page.title ?? '').trim();
    if (title) return title;
    const body = page.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return body ? body.slice(0, 40) : 'Untitled';
  }

  function formatDate(date: Date): string {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Read it again, but only if it has moved.
   *
   * The revision number is a few hundred bytes; the pages are not. Checking the
   * cheap thing first is the whole reason a public notebook can be read by a
   * room full of people at once.
   */
  async function refresh(opts: { silent?: boolean } = {}) {
    if (refreshing) return;
    refreshing = true;
    problem = '';
    try {
      const rev = await sharedNotebookStore.publicRev(code);
      if (rev !== null && rev === notebook.rev) return;
      const fresh = await sharedNotebookStore.readPublic(code);
      data = fresh;
      // The page being read may have been rewritten, or taken out of the
      // notebook, while it was open.
      if (open) open = fresh.pages.find((p) => p.id === open!.id) ?? null;
    } catch (err) {
      if (!opts.silent) problem = errorText(err);
    } finally {
      refreshing = false;
    }
  }

  /** Coming back to the tab is the closest thing to a refresh gesture there is. */
  function handleVisibility() {
    if (!document.hidden) void refresh({ silent: true });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (open) open = null;
    else dispatch('close');
  }

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('keydown', handleKeydown);
  });
  onDestroy(() => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="pn-root">
  <div class="pn-head">
    {#if open}
      <button class="pn-back" on:click={() => (open = null)}>
        <ArrowLeft size={14} weight="duotone" />
        <span>Back</span>
      </button>
      <span class="pn-title">{pageLabel(open)}</span>
    {:else}
      <span class="pn-title">{notebook.name || 'Shared notebook'}</span>
      <button class="pn-close" on:click={() => dispatch('close')}>Close</button>
    {/if}
  </div>

  {#if open}
    <div class="pn-byline">
      {#if memberFor(open.authorId)}
        {@const who = memberFor(open.authorId)}
        <AuthorPill
          variant="round"
          size={18}
          color={who?.color ?? '#888888'}
          initials={who?.initials ?? '··'}
          title={nameFor(open.authorId)}
        />
      {/if}
      <span class="pn-who">{nameFor(open.authorId)}</span>
      <span class="pn-sep">·</span>
      <span>{formatDate(open.updatedAt)}</span>
    </div>
    <div class="pn-body">
      <!-- The roster goes in so the paragraph gutter can name people. A
           signed-out reader gets the pills like anybody else: they say who
           wrote which line, which is the point of reading it. -->
      <SharedPageView html={open.text} members={data.members} />
    </div>
  {:else}
    <div class="pn-body pn-list-body">
      <!-- Said plainly and once, at the top, so nobody hunts for a button that
           was never going to be there. -->
      <p class="pn-note">
        You are reading this without an account. To write in a notebook, or to keep one of your
        own, sign in.
        <button class="pn-signin" on:click={() => profileModalStore.open()}>Sign in</button>
      </p>

      {#if problem}
        <p class="pn-problem">{problem}</p>
      {/if}

      {#if pages.length === 0}
        <p class="pn-empty">Nothing has been written in this notebook yet.</p>
      {:else}
        <div class="pn-list">
          {#each pages as page (page.id)}
            <button class="pn-page" on:click={() => (open = page)}>
              <span class="pn-page-label">
                {#if page.pinned}<span class="pn-pin">📌</span>{/if}
                {pageLabel(page)}
              </span>
              <span class="pn-page-sub">
                {#if memberFor(page.authorId)}
                  {@const who = memberFor(page.authorId)}
                  <AuthorPill
                    color={who?.color ?? '#888888'}
                    initials={who?.initials ?? '··'}
                    title={nameFor(page.authorId)}
                  />
                {/if}
                {nameFor(page.authorId)} · {formatDate(page.updatedAt)}
              </span>
            </button>
          {/each}
        </div>
      {/if}

      <button class="pn-refresh" on:click={() => refresh()} disabled={refreshing}>
        {refreshing ? 'Checking…' : '↻ Check for changes'}
      </button>
    </div>
  {/if}
</div>

<style>
  .pn-root {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
    color: #e0e0e0;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .pn-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid #2a2a2a;
    flex-shrink: 0;
  }

  .pn-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: #f0f0f0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pn-back,
  .pn-close {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 14px;
    color: #bbb;
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    padding: 5px 12px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .pn-back:hover,
  .pn-close:hover {
    background: #333;
    color: #eee;
  }

  .pn-byline {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 16px;
    font-size: 0.75rem;
    color: #888;
    border-bottom: 1px solid #242424;
    flex-shrink: 0;
  }

  .pn-who {
    color: #5eead4;
    font-weight: 600;
  }

  .pn-sep {
    color: #555;
  }

  .pn-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .pn-list-body {
    padding: 14px 16px calc(28px + env(safe-area-inset-bottom, 0px));
  }

  .pn-note {
    margin: 0 0 16px;
    font-size: 0.8125rem;
    line-height: 1.55;
    color: #999;
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    padding: 11px 13px;
  }

  .pn-signin {
    display: inline-block;
    margin-left: 4px;
    background: none;
    border: none;
    padding: 0;
    color: #5eead4;
    font-size: inherit;
    font-family: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }

  .pn-problem {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    color: #fca5a5;
    line-height: 1.45;
  }

  .pn-empty {
    margin: 0 0 16px;
    font-size: 0.8125rem;
    color: #777;
    font-style: italic;
  }

  .pn-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 16px;
  }

  .pn-page {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid #2dd4bf;
    border-radius: 0 6px 6px 0;
    padding: 9px 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .pn-page:hover {
    background: #222;
  }

  .pn-page-label {
    font-size: 0.875rem;
    color: #5eead4;
    font-weight: 500;
  }

  .pn-pin {
    font-size: 0.6875rem;
  }

  .pn-page-sub {
    font-size: 0.6875rem;
    color: #777;
    /* The author's badge rides on this line, so it has to be a flex row for
       the disc to sit on the text's baseline rather than above it. */
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .pn-refresh {
    background: none;
    border: 1px dashed #3a3a3a;
    border-radius: 8px;
    color: #2dd4bf;
    font-size: 0.75rem;
    font-family: inherit;
    padding: 8px 12px;
    width: 100%;
    cursor: pointer;
  }
  .pn-refresh:hover:not(:disabled) {
    background: #1e2e2c;
  }
  .pn-refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
