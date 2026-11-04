<script lang="ts">
  /**
   * The By Heart window. Home is a Today button over the saved verses, each with
   * its small card, score and next date. New verse goes on to the simple reader
   * and the Verse of the Day list, and from either to the card step, all in this
   * one window. A row's Edit card comes back to the card step for that verse.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ArrowLeft, Plus } from 'phosphor-svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { subscribeToByHeartChanges, syncedByHeartStore, type NewByHeartVerse } from '../../adapters/SyncedByHeartStore';
  import { translationLabel } from '../../lib/bibleData';
  import { cardImageOf, keepThumbs } from '../../lib/byHeart/cardThumb';
  import { byHeartGame, openDrill, openGame, type GameMode } from '../../lib/byHeart/game';
  import { MAX_WORDS, splitParts } from '../../lib/byHeart/passage';
  import { weakSteps } from '../../lib/byHeart/schedule';
  import { startToday } from '../../lib/byHeart/today';
  import { drawableStyle, isDue, referenceOf, savedCardOf, shareRefOf, type SavedCard } from '../../lib/byHeart/verse';
  import { formatShareRef, buildShareUrl, type PickedPassage } from '../../lib/shareText';
  import { windowStore } from '../../lib/stores/windowStore';
  import { isOriginalLanguage } from '../../lib/translationKind';
  import { watchVoiceReady } from '../../lib/voice/holdToTalk';
  import { askConfirm } from '../../stores/confirmStore';
  import { navigationStore } from '../../stores/navigationStore';
  import { showNotice } from '../../stores/noticeStore';
  import ShareCardPanel, { type CardDesign, type InitialCard } from '../ShareCardPanel.svelte';
  import ByHeartPicker from './ByHeartPicker.svelte';
  import ByHeartRow from './ByHeartRow.svelte';

  export let windowId: string;
  /** A passage sent from elsewhere (the Verse of the Day card), taken once. */
  export let picked: PickedPassage | null = null;

  let verses: DBByHeartVerse[] = [];
  let loaded = false;
  let expanded: string | null = null;

  $: dueCount = verses.filter((v) => isDue(v)).length;

  const OTHER_WAYS: { mode: GameMode; label: string }[] = [
    { mode: 'build', label: 'Build' },
    { mode: 'recital', label: 'Recital' },
    { mode: 'flashcards', label: 'Flashcards' },
    { mode: 'call', label: 'Call and Response' },
    { mode: 'silent', label: 'Silent study' },
  ];

  function play(verse: DBByHeartVerse, mode: GameMode) {
    expanded = null;
    openGame(verse.id, mode);
  }

  function openWeakSpots() {
    const steps = weakSteps(verses);
    if (!steps.length) {
      showNotice('Nothing to drill yet. Words you ask to see or miss in a recital collect here.');
      return;
    }
    byHeartGame.set({ id: Date.now(), steps, at: 0 });
  }

  async function load() {
    verses = await syncedByHeartStore.list();
    keepThumbs(new Set(verses.map((v) => v.id)));
    loaded = true;
  }

  async function remove(verse: DBByHeartVerse) {
    const ok = await askConfirm(`Remove ${referenceOf(verse)} from By Heart? Its score and schedule go with it.`, {
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    expanded = null;
    await syncedByHeartStore.remove(verse.id);
  }

  let unsubscribe = () => {};
  onMount(() => {
    unsubscribe = subscribeToByHeartChanges(() => void load());
    watchVoiceReady();
    void load();
  });

  // ── Where the window is ────────────────────────────────────────────────────

  let view: 'home' | 'pick' | 'card' = 'home';
  /** The simple reader's window. Kept from New verse until home again. */
  let readerId: string | null = null;
  let pickerTab: 'read' | 'votd' = 'read';

  interface Draft {
    passage: string;
    ref: PickedPassage['ref'];
    translation: string;
    /** Set when this is a saved verse's card being changed. */
    verseId?: string;
    /** The first part of a long passage, or all of it. */
    parts: string[];
    initial?: InitialCard;
  }
  let draft: Draft | null = null;

  function closeReader() {
    if (readerId) windowStore.closeWindow(readerId);
    readerId = null;
  }

  function goHome() {
    closeReader();
    draft = null;
    view = 'home';
  }

  function newVerse() {
    const nav = get(navigationStore);
    closeReader();
    [readerId] = windowStore.createHarmonyPanes([{ book: nav.book, chapter: nav.chapter, translation: nav.translation }]);
    pickerTab = 'read';
    view = 'pick';
  }

  function backFromCard() {
    draft = null;
    view = readerId ? 'pick' : 'home';
  }

  function toCard(p: PickedPassage) {
    draft = { passage: p.passage, ref: p.ref, translation: p.translation, parts: splitParts(p.passage) };
    view = 'card';
  }

  async function editCard(verse: DBByHeartVerse) {
    const card = savedCardOf(verse);
    const image = await cardImageOf(verse);
    const style = drawableStyle(card, !!image);
    expanded = null;
    closeReader();
    draft = {
      passage: verse.passage,
      ref: shareRefOf(verse),
      translation: verse.translation,
      verseId: verse.id,
      parts: [verse.passage],
      initial: {
        style,
        emphasis: card.emphasis,
        photo: style.background === 'photo' ? image : null,
        painting: style.background === 'painting' ? image : null,
        paintingId: card.painting?.imageId ?? null,
      },
    };
    view = 'card';
  }

  // Sent from elsewhere: straight to its card, and cleared so a reload doesn't do it again.
  $: if (picked) {
    const p = picked;
    windowStore.updateContentState(windowId, { picked: null });
    closeReader();
    toCard(p);
  }

  onDestroy(() => {
    unsubscribe();
    closeReader();
  });

  // ── Saving the card ────────────────────────────────────────────────────────

  async function keepPhoto(id: string, design: CardDesign) {
    if (design.photo) await syncedByHeartStore.setPhoto({ id, ...design.photo });
    else await syncedByHeartStore.clearPhoto(id);
  }

  async function save(design: CardDesign) {
    if (!draft) return;
    const d = draft;
    const card = (emphasis: SavedCard['emphasis']): SavedCard => ({
      style: design.style,
      emphasis,
      ...(design.painting ? { painting: design.painting } : {}),
    });

    if (d.verseId) {
      await keepPhoto(d.verseId, design);
      await syncedByHeartStore.update(d.verseId, { card: card(design.emphasis) as unknown as Record<string, unknown> });
      showNotice('Card saved.');
      goHome();
      return;
    }

    let updated = 0;
    const saved = await syncedByHeartStore.list();
    for (const [i, passage] of d.parts.entries()) {
      // The words tapped on the card are the first part's.
      const thisCard = card(i === 0 ? design.emphasis : {}) as unknown as Record<string, unknown>;
      const same = saved.find((v) => v.translation === d.translation && v.part === i + 1 && v.passage === passage);
      if (same) {
        // The same words again keep their score and schedule, under the new card.
        await keepPhoto(same.id, design);
        await syncedByHeartStore.update(same.id, { card: thisCard });
        updated++;
        continue;
      }
      const row: NewByHeartVerse = {
        book: d.ref.book,
        chapter: d.ref.chapter,
        startVerse: d.ref.startVerse,
        endVerse: d.ref.endVerse,
        verses: d.ref.verses,
        translation: d.translation,
        passage,
        part: i + 1,
        parts: d.parts.length,
        card: thisCard,
        score: null,
        nextDate: null,
        progress: {},
      };
      const added = await syncedByHeartStore.add(row);
      await keepPhoto(added.id, design);
    }
    showNotice(updated === d.parts.length ? 'Already in By Heart, so its card was updated.' : 'Saved to By Heart.');
    goHome();
  }
</script>

<div class="bh-pane">
  {#if view === 'home'}
    <div class="bar">
      <button class="today" disabled={dueCount === 0} on:click={() => void startToday()}>
        <span>Today</span>
        <span class="today-count">{dueCount === 1 ? '1 verse due' : `${dueCount} verses due`}</span>
      </button>
      <button class="new" on:click={newVerse}><Plus size="1em" weight="bold" /> New verse</button>
    </div>
    {#if verses.length}
      <div class="bar drills">
        <button class="drill" on:click={openWeakSpots}>Weak Spots</button>
        <button class="drill" on:click={openDrill}>Sword Drill</button>
      </div>
    {/if}

    <div class="list">
      {#each verses as verse (verse.id)}
        <ByHeartRow
          {verse}
          expanded={expanded === verse.id}
          onMore={() => (expanded = expanded === verse.id ? null : verse.id)}
        />
        {#if expanded === verse.id}
          <div class="actions">
            {#each OTHER_WAYS.filter((w) => w.mode === 'silent' || !isOriginalLanguage(verse.translation)) as way (way.mode)}
              <button class="action" on:click={() => play(verse, way.mode)}>{way.label}</button>
            {/each}
            <button class="action" on:click={() => editCard(verse)}>Edit or share card</button>
            <button class="action danger" on:click={() => remove(verse)}>Remove</button>
          </div>
        {/if}
      {:else}
        {#if loaded}
          <p class="empty">The verses you are memorizing live here. Tap New verse to add your first.</p>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="bar step-bar">
      <button class="back" on:click={view === 'card' ? backFromCard : goHome}>
        <ArrowLeft size="1em" weight="bold" /> Back
      </button>
      <span class="step-title">
        {#if view === 'pick'}New verse{:else if draft}{formatShareRef(draft.ref)}{/if}
      </span>
    </div>

    {#if view === 'pick' && readerId}
      <ByHeartPicker windowId={readerId} bind:tab={pickerTab} onPick={toCard} />
    {:else if view === 'card' && draft}
      <div class="card-step">
        {#if draft.parts.length > 1}
          <p class="note">
            This passage is too long for one card, which holds about {MAX_WORDS} words, so it is saved as
            {draft.parts.length} parts. The card shows part 1, and the others take the same look.
          </p>
        {/if}
        {#if isOriginalLanguage(draft.translation)}
          <p class="note">The app only hears English, so this one can't be recited out loud.</p>
        {/if}
        <ShareCardPanel
          passage={draft.parts[0] ?? ''}
          reference={formatShareRef(draft.ref)}
          translationLabel={translationLabel(draft.translation)}
          shareRef={draft.ref}
          qrUrl={buildShareUrl(draft.ref, draft.translation)}
          initial={draft.initial}
          saveLabel={draft.verseId ? 'Save card' : 'Save to By Heart'}
          onSave={save}
        />
      </div>
    {/if}
  {/if}
</div>

<style>
  .bh-pane {
    --bh-accent: #f472b6;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-size: 15px;
  }

  .bar {
    display: flex;
    gap: calc(8px * var(--bar-scale, 1));
    flex-shrink: 0;
    padding: calc(8px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1));
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
  }

  .today,
  .new,
  .back,
  .drill {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: calc(6px * var(--bar-scale, 1));
    min-width: 0;
    padding: calc(9px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1));
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: calc(14px * var(--bar-scale, 1));
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .today {
    flex: 1;
    align-items: baseline;
    border-color: var(--bh-accent);
    background: rgba(244, 114, 182, 0.14);
  }

  .today:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .today-count {
    overflow: hidden;
    font-size: 0.8em;
    font-weight: 400;
    opacity: 0.8;
    text-overflow: ellipsis;
  }

  .drills {
    padding-block: calc(6px * var(--bar-scale, 1));
  }

  .drill {
    flex: 1;
    padding-block: calc(6px * var(--bar-scale, 1));
    font-weight: 500;
  }

  .step-bar {
    align-items: center;
    padding-block: calc(4px * var(--bar-scale, 1));
  }

  .back {
    flex-shrink: 0;
    padding-block: calc(5px * var(--bar-scale, 1));
    border-color: transparent;
    padding-inline: calc(4px * var(--bar-scale, 1));
  }

  .step-title {
    overflow: hidden;
    font-size: calc(14px * var(--bar-scale, 1));
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .empty {
    margin: 0;
    padding: 28px 20px;
    text-align: center;
    line-height: 1.5;
    opacity: 0.75;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 12px 10px 78px;
  }

  .action {
    padding: 6px 12px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;
  }

  .action.danger {
    border-color: #ef4444;
    color: #ef4444;
  }

  .card-step {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  }

  .note {
    flex-shrink: 0;
    margin: 0 0 8px;
    font-size: 0.8em;
    line-height: 1.4;
    opacity: 0.8;
  }
</style>
