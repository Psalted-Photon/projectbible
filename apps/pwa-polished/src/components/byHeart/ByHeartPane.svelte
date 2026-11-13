<script lang="ts">
  /**
   * The By Heart window. Home has what covers every verse at the top (Today's
   * Practice, Weak Spots, Sword Drill) over the saved verses, due ones first. A row
   * opens that verse's page, for Study and Practice. Add verse goes on to the
   * simple reader and the Verse of the Day list, and from either to the card step,
   * all in this one window. A verse page's Edit card comes back to the card step
   * for that verse.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ArrowLeft, Plus } from 'phosphor-svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { subscribeToByHeartChanges, syncedByHeartStore, type NewByHeartVerse } from '../../adapters/SyncedByHeartStore';
  import { bookInk, translationLabel } from '../../lib/bibleData';
  import { cardImageOf, keepThumbs } from '../../lib/byHeart/cardThumb';
  import { byHeartGame, gamePrefs, openDrill, openGame, type GameMode } from '../../lib/byHeart/game';
  import { MAX_WORDS, splitParts } from '../../lib/byHeart/passage';
  import { stageOf, weakSteps, type Stage } from '../../lib/byHeart/schedule';
  import { startToday } from '../../lib/byHeart/today';
  import { drawableStyle, isDue, referenceOf, savedCardOf, shareRefOf, whenBack, type SavedCard } from '../../lib/byHeart/verse';
  import { ADD_VERSE, PRACTICE, STAGE_NAMES, STUDY, SWORD_DRILL, TODAYS_PRACTICE, WAYS } from '../../lib/byHeart/ways';
  import { formatShareRef, buildShareUrl, type PickedPassage } from '../../lib/shareText';
  import { windowStore } from '../../lib/stores/windowStore';
  import { isOriginalLanguage } from '../../lib/translationKind';
  import { pauseReading } from '../../lib/tts/readingEngine';
  import { watchVoiceReady } from '../../lib/voice/holdToTalk';
  import { askConfirm } from '../../stores/confirmStore';
  import { navigationStore } from '../../stores/navigationStore';
  import { showNotice } from '../../stores/noticeStore';
  import ShareCardPanel, { type CardDesign, type InitialCard } from '../ShareCardPanel.svelte';
  import ByHeartPicker from './ByHeartPicker.svelte';
  import ByHeartRow from './ByHeartRow.svelte';
  import ByHeartVerse from './ByHeartVerse.svelte';
  import TranslationTag from './TranslationTag.svelte';

  export let windowId: string;
  /** A passage sent from elsewhere (the Verse of the Day card), taken once. */
  export let picked: PickedPassage | null = null;

  let verses: DBByHeartVerse[] = [];
  let loaded = false;
  /** The verse whose page is open. */
  let pageId: string | null = null;

  /** Due first, then soonest back. */
  function comingUp(a: DBByHeartVerse, b: DBByHeartVerse): number {
    return Number(isDue(b)) - Number(isDue(a)) || (a.nextDate ?? '').localeCompare(b.nextDate ?? '');
  }

  /** "3 Known, 5 Learning, 4 New", leaving out any with none. */
  function stageCounts(list: DBByHeartVerse[]): string {
    const stages: Stage[] = ['known', 'learning', 'new'];
    return stages
      .map((stage) => ({ stage, count: list.filter((v) => stageOf(v) === stage).length }))
      .filter(({ count }) => count > 0)
      .map(({ stage, count }) => `${count} ${STAGE_NAMES[stage]}`)
      .join(', ');
  }

  $: ordered = [...verses].sort(comingUp);
  $: dueCount = verses.filter((v) => isDue(v)).length;
  $: soonest = ordered.find((v) => v.nextDate)?.nextDate ?? null;
  $: weakCount = weakSteps(verses).length;
  let drillBest: number | null = null;
  // Read again each time a game closes, which is when it can have changed.
  $: if (!$byHeartGame) drillBest = gamePrefs().drillTop[0]?.right ?? null;
  $: pageVerse = verses.find((v) => v.id === pageId) ?? null;
  // Removed here, or on another device, while its page was open.
  $: if (view === 'verse' && loaded && !pageVerse) goHome();

  function play(verse: DBByHeartVerse, mode: GameMode) {
    stopRecital();
    openGame(verse.id, mode);
  }

  function openWeakSpots() {
    byHeartGame.set({ id: Date.now(), steps: weakSteps(verses), at: 0 });
  }

  async function load() {
    verses = await syncedByHeartStore.list();
    recitals = new Map((await syncedByHeartStore.recitals()).map((r) => [r.id, r.score]));
    keepThumbs(new Set(verses.map((v) => v.id)));
    loaded = true;
  }

  async function remove(verse: DBByHeartVerse) {
    const ok = await askConfirm(`Remove ${referenceOf(verse)} from By Heart? Its score and schedule go with it.`, {
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await syncedByHeartStore.remove(verse.id);
  }

  // ── Your Own Voice ─────────────────────────────────────────────────────────

  /** The saved recitals' scores, by verse. */
  let recitals = new Map<string, number>();
  let hearing: { id: string; audio: HTMLAudioElement; url: string } | null = null;

  function stopRecital() {
    if (!hearing) return;
    hearing.audio.pause();
    URL.revokeObjectURL(hearing.url);
    hearing = null;
  }

  async function hearRecital(verse: DBByHeartVerse) {
    const same = hearing?.id === verse.id;
    stopRecital();
    if (same) return;
    const recital = await syncedByHeartStore.getRecital(verse.id);
    if (!recital) return;
    pauseReading();
    const url = URL.createObjectURL(recital.audio);
    const audio = new Audio(url);
    audio.onended = stopRecital;
    hearing = { id: verse.id, audio, url };
    audio.play().catch(() => {
      stopRecital();
      showNotice('That recital could not play.', 'error');
    });
  }

  async function deleteRecital(verse: DBByHeartVerse) {
    const ok = await askConfirm(`Delete your saved recital of ${referenceOf(verse)}?`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    if (hearing?.id === verse.id) stopRecital();
    await syncedByHeartStore.removeRecital(verse.id);
  }

  let unsubscribe = () => {};
  onMount(() => {
    unsubscribe = subscribeToByHeartChanges(() => void load());
    watchVoiceReady();
    void load();
  });

  // ── Where the window is ────────────────────────────────────────────────────

  let view: 'home' | 'verse' | 'pick' | 'card' = 'home';
  /** The simple reader's window. Kept from Add verse until home again. */
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
    stopRecital();
    draft = null;
    pageId = null;
    view = 'home';
  }

  function openPage(verse: DBByHeartVerse) {
    pageId = verse.id;
    view = 'verse';
  }

  function newVerse() {
    const nav = get(navigationStore);
    closeReader();
    [readerId] = windowStore.createHarmonyPanes([{ book: nav.book, chapter: nav.chapter, translation: nav.translation }]);
    pickerTab = 'read';
    view = 'pick';
  }

  function backFromCard() {
    const fromPage = !!draft?.verseId;
    draft = null;
    view = fromPage ? 'verse' : readerId ? 'pick' : 'home';
  }

  function toCard(p: PickedPassage) {
    draft = { passage: p.passage, ref: p.ref, translation: p.translation, parts: splitParts(p.passage) };
    view = 'card';
  }

  async function editCard(verse: DBByHeartVerse) {
    const card = savedCardOf(verse);
    const image = await cardImageOf(verse);
    const style = drawableStyle(card, !!image);
    stopRecital();
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
    stopRecital();
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
      backFromCard();
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
    <div class="home">
      {#if verses.length}
        <div class="home-top">
          {#if dueCount > 0}
            <button class="today" on:click={() => void startToday()}>
              <span class="tile-head">
                <span class="tile-name">{TODAYS_PRACTICE.name}</span>
                <span class="today-count">{dueCount === 1 ? '1 verse due' : `${dueCount} verses due`}</span>
              </span>
              <span class="tile-line">{TODAYS_PRACTICE.line}</span>
            </button>
          {:else}
            <div class="today done">
              <span class="tile-name">All caught up</span>
              {#if soonest}<span class="tile-line">Next verse back {whenBack(soonest)}.</span>{/if}
            </div>
          {/if}
          <div class="tiles">
            <button class="drill" disabled={weakCount === 0} on:click={openWeakSpots}>
              <span class="tile-name">{WAYS.weak.name}</span>
              <span class="tile-line">{weakCount ? WAYS.weak.line : 'Nothing yet. Words you miss will collect here.'}</span>
            </button>
            <button class="drill" on:click={openDrill}>
              <span class="tile-name">{SWORD_DRILL.name}</span>
              <span class="tile-line">{SWORD_DRILL.line}</span>
              {#if drillBest}<span class="tile-best">Best {drillBest} right</span>{/if}
            </button>
          </div>
        </div>

        <div class="list-head">
          <div class="list-title">
            <span class="list-name">Your verses</span>
            <span class="list-count">{stageCounts(verses)}</span>
          </div>
          <button class="new" on:click={newVerse}><Plus size="1em" weight="bold" /> {ADD_VERSE}</button>
        </div>

        {#each ordered as verse (verse.id)}
          <ByHeartRow {verse} onOpen={() => openPage(verse)} />
        {/each}
      {:else if loaded}
        <div class="welcome">
          <p class="welcome-title">Learn verses by heart</p>
          <ol>
            <li><strong>{ADD_VERSE}</strong> and design its card.</li>
            <li><strong>{STUDY.name}</strong> it. Read it and listen to it.</li>
            <li><strong>{PRACTICE.name}</strong> it and get a score. Verses come back when they're due, further apart as you learn them.</li>
          </ol>
          <button class="new" on:click={newVerse}><Plus size="1em" weight="bold" /> {ADD_VERSE}</button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="bar step-bar">
      <button class="back" on:click={view === 'card' ? backFromCard : goHome}>
        <ArrowLeft size="1em" weight="bold" /> Back
      </button>
      <span class="step-title">
        {#if view === 'verse' && pageVerse}
          <span style={bookInk(pageVerse.book)}>{referenceOf(pageVerse)}</span>
          <TranslationTag translation={pageVerse.translation} />
        {:else if view === 'pick'}{ADD_VERSE}{:else if draft}{formatShareRef(draft.ref)}{/if}
      </span>
    </div>

    {#if view === 'verse' && pageVerse}
      {@const v = pageVerse}
      <ByHeartVerse
        verse={v}
        recitalScore={recitals.get(v.id) ?? null}
        hearingRecital={hearing?.id === v.id}
        onPlay={(mode) => play(v, mode)}
        onEditCard={() => editCard(v)}
        onRemove={() => remove(v)}
        onHearRecital={() => hearRecital(v)}
        onDeleteRecital={() => deleteRecital(v)}
      />
    {:else if view === 'pick' && readerId}
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

  .new,
  .back {
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

  .new {
    flex-shrink: 0;
  }

  .home {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .home-top {
    display: flex;
    flex-direction: column;
    gap: calc(8px * var(--bar-scale, 1));
    padding: calc(10px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1)) calc(4px * var(--bar-scale, 1));
  }

  .today,
  .drill {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    box-sizing: border-box;
    padding: calc(10px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1));
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .today {
    width: 100%;
    border-color: var(--bh-accent);
    background: rgba(244, 114, 182, 0.14);
  }

  .today.done {
    border-color: rgba(127, 127, 127, 0.4);
    background: transparent;
    cursor: default;
  }

  .tiles {
    display: flex;
    gap: calc(8px * var(--bar-scale, 1));
  }

  .drill {
    flex: 1 1 0;
  }

  .drill:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .tile-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .tile-name {
    font-size: calc(14.5px * var(--bar-scale, 1));
    font-weight: 600;
  }

  .today-count {
    flex-shrink: 0;
    color: var(--bh-accent);
    font-size: calc(12.5px * var(--bar-scale, 1));
    font-weight: 600;
  }

  .tile-line {
    font-size: calc(12px * var(--bar-scale, 1));
    line-height: 1.35;
    opacity: 0.75;
  }

  .tile-best {
    margin-top: 2px;
    font-size: calc(12px * var(--bar-scale, 1));
    font-weight: 600;
  }

  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: calc(10px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1)) calc(4px * var(--bar-scale, 1));
  }

  .list-title {
    min-width: 0;
  }

  .list-name {
    display: block;
    font-size: calc(14px * var(--bar-scale, 1));
    font-weight: 600;
  }

  .list-count {
    display: block;
    font-size: calc(12px * var(--bar-scale, 1));
    opacity: 0.75;
  }

  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px 20px;
    line-height: 1.5;
  }

  .welcome-title {
    margin: 0;
    font-size: 1.1em;
    font-weight: 600;
  }

  .welcome ol {
    margin: 0;
    padding-left: 1.4em;
  }

  .welcome li + li {
    margin-top: 6px;
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
