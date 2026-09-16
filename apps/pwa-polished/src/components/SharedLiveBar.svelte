<script lang="ts">
  /**
   * Who else is in this notebook, and who is writing the page you have open.
   *
   * A thin strip under the page's header, in both the reader and the editor,
   * because the answer matters in both: reading, it tells you the page may
   * move under you; writing, it tells you somebody else is in the same page
   * and that one of you is going to be asked to keep theirs separately.
   *
   * Everybody is drawn as the badge they already wear on their pages, so the
   * strip needs no legend — a name in the notebook and a name in the strip are
   * the same two letters and the same colour. Somebody on this very page gets
   * a ring around theirs; somebody elsewhere in the notebook does not.
   *
   * It draws nothing at all when there is nobody else about, rather than an
   * empty bar saying so.
   */
  import { createEventDispatcher } from 'svelte';
  import AuthorPill from './AuthorPill.svelte';
  import type { LivePerson } from '../lib/shared/sharedRealtime';
  import type { SharedNotebookMember } from '../adapters/SharedNotebookStore';

  /** Everybody here but this device. */
  export let people: LivePerson[] = [];
  /** The notebook's roster — where the badges and the names come from. */
  export let members: SharedNotebookMember[] = [];
  /** The page on screen, so the people in it can be told from the rest. */
  export let pageId: string | null = null;
  /** Somebody else's claim on this page, if there is one. */
  export let writer: LivePerson | null = null;
  /** Their claim has gone quiet — a minute with nothing typed under it. */
  export let writerIdle = false;
  /** Whether to offer Take over. Only where this account could edit anyway. */
  export let canTakeOver = false;

  const dispatch = createEventDispatcher<{ takeover: void }>();

  function memberFor(userId: string): SharedNotebookMember | null {
    return members.find((m) => m.userId === userId) ?? null;
  }

  function nameFor(userId: string): string {
    const name = (memberFor(userId)?.displayName ?? '').trim();
    return name || 'Someone';
  }

  function whereFor(person: LivePerson): string {
    if (person.pageId && person.pageId === pageId) {
      return person.writing ? 'writing this page' : 'reading this page';
    }
    return 'in this notebook';
  }

  $: writerName = writer ? nameFor(writer.userId) : '';
</script>

{#if people.length > 0 || writer}
  <div class="live-bar">
    <span class="live-dot" class:quiet={writerIdle} aria-hidden="true"></span>

    <span class="live-pills">
      {#each people as person (person.userId)}
        {@const member = memberFor(person.userId)}
        <span class="live-pill" class:on-page={person.pageId === pageId && !!pageId}>
          <AuthorPill
            color={member?.color ?? '#6b7280'}
            initials={member?.initials || '··'}
            title="{nameFor(person.userId)} — {whereFor(person)}"
          />
        </span>
      {/each}
    </span>

    <span class="live-text">
      {#if writer && !writerIdle}
        {writerName} is writing…
      {:else if writer && writerIdle}
        {writerName} has stopped writing.
      {:else if people.length === 1}
        {nameFor(people[0].userId)} is here.
      {:else}
        {people.length} others are here.
      {/if}
    </span>

    {#if writer && writerIdle && canTakeOver}
      <button class="take-over" on:click={() => dispatch('takeover')}>Take over</button>
    {/if}
  </div>
{/if}

<style>
  .live-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 5px 12px;
    border-bottom: 1px solid #2a2a2a;
    background: rgba(45, 212, 191, 0.06);
    color: #8fa9a5;
    font-size: 0.72rem;
  }

  /* The one thing on the strip that says this is happening now rather than
     when the page was last opened. It stops pulsing when the writer does. */
  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #2dd4bf;
    flex-shrink: 0;
    animation: live-pulse 2.4s ease-in-out infinite;
  }

  .live-dot.quiet {
    background: #6b7280;
    animation: none;
  }

  @keyframes live-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-dot {
      animation: none;
    }
  }

  .live-pills {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  /* A ring for somebody in this very page, so "here somewhere" and "reading
     over your shoulder" are not the same badge. */
  .live-pill.on-page {
    border-radius: 9px;
    box-shadow: 0 0 0 1.5px rgba(45, 212, 191, 0.75);
  }

  .live-text {
    flex: 1;
    min-width: 90px;
  }

  .take-over {
    background: #2dd4bf;
    color: #0b3b36;
    border: none;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 4px 9px;
    cursor: pointer;
    flex-shrink: 0;
  }
</style>
