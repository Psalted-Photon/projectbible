<script lang="ts">
  /**
   * The lab's main test: reading verses out loud while the words uncover. A
   * list of set runs answers how fast it can reveal, how many upcoming words to
   * favor, how often small words drop and what repeated words do. Word timings
   * show up in every run's lag. A word it won't take can be tapped to move on.
   */
  import { onDestroy, onMount } from 'svelte';
  import { Check, Microphone, Stop } from 'phosphor-svelte';
  import BrandSpinner from '../../BrandSpinner.svelte';
  import LabCard from './LabCard.svelte';
  import { restoreLastStyle, type CardStyle } from '../../../lib/shareCard';
  import { LiveHearing, closeHearing, loadHearing, type HearingMethod } from '../../../lib/byHeart/hearing';
  import { upcomingWords, splitWords } from '../../../lib/byHeart/wordMatch';
  import { LiveRun, type RunStats } from '../../../lib/byHeart/lab/liveRun';
  import { readPassage, type LabPassage } from '../../../lib/byHeart/lab/labPassages';
  import { labResults, patchResults, type RunResult } from '../../../lib/byHeart/lab/labResults';
  import { micReadyToListen, recordMicFailed } from '../../../lib/voice/holdToTalk';
  import { micTrouble } from '../../../lib/voice/mic';
  import { stayAwake, allowSleep } from '../../../lib/installAwake';

  /** Your own verse, from the simple reader test. */
  export let picked: LabPassage | null = null;

  interface RunSpec {
    id: string;
    title: string;
    method: HearingMethod;
    hopMs: number;
    favor: number;
    /** book, chapter, from, to. 0 is the whole chapter. */
    at: [string, number, number, number];
    say?: string;
    /** The word to say wrong, by how it is written. */
    wrongWord?: string;
  }

  const JOHN: RunSpec['at'] = ['John', 3, 16, 16];
  const PSALM: RunSpec['at'] = ['Psalm', 23, 1, 1];
  const WRONG = 'Read the verse, but say “leopard” instead of “shepherd”. Then tap Stop.';

  const RUNS: RunSpec[] = [
    { id: 'hop1000', title: 'Live, 1 second', method: 'stream', hopMs: 1000, favor: 3, at: JOHN },
    { id: 'hop500', title: 'Live, ½ second', method: 'stream', hopMs: 500, favor: 3, at: JOHN },
    { id: 'hop250', title: 'Live, ¼ second', method: 'stream', hopMs: 250, favor: 3, at: JOHN },
    { id: 'pauses', title: 'Bursts at pauses', method: 'pauses', hopMs: 0, favor: 3, at: JOHN },
    { id: 'favor0', title: 'Favor none', method: 'stream', hopMs: 500, favor: 0, at: JOHN },
    { id: 'favor1', title: 'Favor 1', method: 'stream', hopMs: 500, favor: 1, at: JOHN },
    { id: 'favor5', title: 'Favor 5', method: 'stream', hopMs: 500, favor: 5, at: JOHN },
    { id: 'wrong1', title: 'Wrong word, favor 1', method: 'stream', hopMs: 500, favor: 1, at: PSALM, say: WRONG, wrongWord: 'shepherd' },
    { id: 'wrong3', title: 'Wrong word, favor 3', method: 'stream', hopMs: 500, favor: 3, at: PSALM, say: WRONG, wrongWord: 'shepherd' },
    { id: 'wrong5', title: 'Wrong word, favor 5', method: 'stream', hopMs: 500, favor: 5, at: PSALM, say: WRONG, wrongWord: 'shepherd' },
    {
      id: 'holy',
      title: 'Holy, holy, holy',
      method: 'stream',
      hopMs: 500,
      favor: 3,
      at: ['Isaiah', 6, 3, 3],
      say: 'Pause for two seconds after each “holy”. Each one should uncover only once you have said it.',
    },
    { id: 'long', title: 'Psalm 23, all of it', method: 'stream', hopMs: 500, favor: 3, at: ['Psalm', 23, 0, 0] },
  ];

  const style: CardStyle = restoreLastStyle();

  let spec: RunSpec = RUNS[0];
  let passage: LabPassage | null = null;
  let run: LiveRun | null = null;
  let hearing: LiveHearing | null = null;
  let phase: 'idle' | 'loading' | 'listening' | 'finishing' = 'idle';
  let level = 0;
  let trouble = '';
  let last: RunStats | null = null;
  let useMine = false;
  let cover: 'pill' | 'wordblur' = 'pill';
  /** Light enough to read the verse through. */
  let blur = 0.12;

  // The free run's own choices.
  let freeHop = 500;
  let freeFavor = 3;
  let freeMethod: HearingMethod = 'stream';

  $: doneIds = new Set($labResults.runs.map((r) => r.id));
  $: heardLine = run ? run.settled.map((w) => w.word.trim()).join(' ') : '';
  $: revealed = run?.cursor ?? 0;
  $: busy = phase !== 'idle';

  async function loadSpec(s: RunSpec) {
    spec = s;
    useMine = false;
    run = null;
    last = null;
    trouble = '';
    passage = await readPassage(...s.at);
    if (!passage) trouble = `${s.at[0]} ${s.at[1]} isn't in this translation.`;
  }

  function loadMine() {
    useMine = true;
    run = null;
    last = null;
    trouble = '';
    passage = picked;
  }

  onMount(() => void loadSpec(RUNS.find((r) => !doneIds.has(r.id)) ?? RUNS[0]));

  $: config = useMine
    ? { method: freeMethod, hopMs: freeHop, favor: freeFavor, title: 'Your verse' }
    : { method: spec.method, hopMs: spec.hopMs, favor: spec.favor, title: spec.title };

  function begin() {
    if (!passage || busy) return;
    if (!micReadyToListen(begin)) return;
    void open(passage);
  }

  async function open(p: LabPassage) {
    trouble = '';
    last = null;
    phase = 'loading';
    const thisRun = new LiveRun(p.words);
    run = thisRun;
    const { method, hopMs, favor } = config;
    const h = new LiveHearing({
      method,
      hopMs,
      keywords: () => upcomingWords(p.words, thisRun.cursor, favor),
      onLevel: (l) => (level = l),
      onUpdate: (u) => {
        thisRun.update(u);
        run = thisRun;
        if (phase === 'listening' && thisRun.done) void finish();
      },
    });
    hearing = h;
    stayAwake('by-heart-lab');
    try {
      const loadMs = await loadHearing();
      if ($labResults.loadMs == null) patchResults({ loadMs });
    } catch (err) {
      giveUp(h);
      trouble = `Whistle could not load: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    try {
      await h.start();
      phase = 'listening';
    } catch (err) {
      giveUp(h);
      if (!recordMicFailed(err)) trouble = micTrouble(err);
    }
  }

  function giveUp(h: LiveHearing) {
    h.cancel();
    hearing = null;
    phase = 'idle';
    allowSleep('by-heart-lab');
  }

  async function finish() {
    const h = hearing;
    const r = run;
    if (!h || !r || phase !== 'listening') return;
    phase = 'finishing';
    level = 0;
    await h.stop();
    hearing = null;
    allowSleep('by-heart-lab');
    run = r;
    last = r.stats(h.startedAt);
    save(r, last);
    phase = 'idle';
  }

  function save(r: LiveRun, stats: RunStats) {
    const { method, hopMs, favor, title } = config;
    const id = useMine ? `mine-${Date.now()}` : spec.id;
    const wrongAt = !useMine && spec.wrongWord ? r.words.findIndex((w) => w.toLowerCase().includes(spec.wrongWord!)) : -1;
    const result: RunResult = {
      id,
      title,
      method: method === 'pauses' ? 'bursts' : `live every ${hopMs} ms`,
      favor,
      passage: `${passage?.reference} (${passage?.label})`,
      stats,
      falsePass: wrongAt >= 0 ? stats.shown > wrongAt && stats.tapped === 0 : null,
      at: new Date().toISOString(),
    };
    // A run done over replaces the old one, except your own verse, which adds up.
    patchResults({ runs: [...$labResults.runs.filter((x) => x.id !== id), result] });
    if (!useMine) {
      const next = RUNS.slice(RUNS.indexOf(spec) + 1).find((x) => !$labResults.runs.some((d) => d.id === x.id));
      if (next) void moveTo(next, stats);
    }
  }

  /** On to the next run, keeping what the last one said on screen. */
  async function moveTo(next: RunSpec, stats: RunStats) {
    await loadSpec(next);
    last = stats;
  }

  /** A tap on the word it's stuck on moves on. */
  function tapWord(i: number) {
    if (!run || phase !== 'listening' || i !== run.cursor) return;
    run.tap();
    run = run;
    if (run.done) void finish();
  }

  onDestroy(() => {
    hearing?.cancel();
    closeHearing();
    allowSleep('by-heart-lab');
  });

  const n = (v: number | null) => (v == null ? '–' : Math.round(v));
</script>

<p class="lab-hint">
  Tap the mic and read the verse out loud at your normal pace. The words stay just blurred enough to read through, and clear as you say them. It stops on its own at the last word. If a word won't clear, tap it to move on. The next run comes up by itself.
</p>

<div class="lab-chips">
  {#each RUNS as r (r.id)}
    <button class="lab-chip" class:on={!useMine && spec.id === r.id} disabled={busy} on:click={() => loadSpec(r)}>
      {#if doneIds.has(r.id)}<Check size={12} weight="bold" />{/if}{r.title}
    </button>
  {/each}
  {#if picked}
    <button class="lab-chip" class:on={useMine} disabled={busy} on:click={loadMine}>Your verse</button>
  {/if}
</div>

{#if useMine}
  <div class="lab-row">
    <label>How
      <select bind:value={freeMethod} disabled={busy}>
        <option value="stream">Live</option>
        <option value="pauses">Bursts at pauses</option>
      </select>
    </label>
    {#if freeMethod === 'stream'}
      <label>Every
        <select bind:value={freeHop} disabled={busy}>
          <option value={1000}>1 second</option>
          <option value={500}>½ second</option>
          <option value={250}>¼ second</option>
        </select>
      </label>
    {/if}
    <label>Favor
      <select bind:value={freeFavor} disabled={busy}>
        <option value={0}>None</option>
        <option value={1}>1 word</option>
        <option value={3}>3 words</option>
        <option value={5}>5 words</option>
      </select>
    </label>
  </div>
{/if}

{#if !useMine && spec.say}
  <p class="lab-say">{spec.say}</p>
{/if}

{#if passage}
  <LabCard
    passage={passage.passage}
    reference={passage.reference}
    translationLabel={passage.label}
    {style}
    {cover}
    {blur}
    {revealed}
    onTapWord={tapWord}
  />
{/if}

<div class="lab-row lab-mic-row">
  <button
    class="lab-mic"
    class:live={phase === 'listening'}
    style="--level: {phase === 'listening' ? level : 0}"
    disabled={!passage || phase === 'loading' || phase === 'finishing'}
    aria-label={phase === 'listening' ? 'Stop' : 'Start'}
    on:click={() => (phase === 'listening' ? finish() : begin())}
  >
    {#if phase === 'loading' || phase === 'finishing'}
      <BrandSpinner size={24} />
    {:else if phase === 'listening'}
      <Stop size={26} weight="fill" />
    {:else}
      <Microphone size={26} weight="bold" />
    {/if}
  </button>
  <div class="lab-status">
    {#if phase === 'loading'}
      Loading Whistle and the mic…
    {:else if phase === 'finishing'}
      Hearing the last of it…
    {:else if phase === 'listening'}
      Listening. Word {revealed + 1} of {run?.words.length}.
    {:else}
      {config.title}: {config.method === 'pauses' ? 'bursts' : `live, every ${config.hopMs} ms`}, favoring {config.favor}.
    {/if}
    {#if run?.wrongNow && phase === 'listening'}
      <div class="lab-wrong">Heard “{run.wrongNow}”</div>
    {/if}
  </div>
</div>

{#if run && (heardLine || run.pending)}
  <p class="lab-heard">{heardLine} <span class="pending">{splitWords(run.pending).join(' ')}</span></p>
{/if}

<div class="lab-row">
  <label>Cover
    <select bind:value={cover}>
      <option value="pill">Blur pills</option>
      <option value="wordblur">Word blur</option>
    </select>
  </label>
  <label class="grow">Blur
    <input type="range" min="0.05" max="1" step="0.01" bind:value={blur} />
  </label>
</div>

{#if trouble}<p class="lab-trouble">{trouble}</p>{/if}

{#if last}
  <div class="lab-stats">
    <div><b>Last run:</b> {last.shown}/{last.total} shown, {last.tapped} tapped</div>
    <div>Lag: {n(last.lagMedian)} ms typical, {n(last.lagMax)} ms at worst ({last.timed} words timed)</div>
    <div>Each pass: {n(last.passMedian)} ms, from {n(last.passFirst)} to {n(last.passLast)}</div>
    <div>Small words dropped: {last.dropped.length} of {last.smallWords}{last.dropped.length ? ` (${last.dropped.join(', ')})` : ''}</div>
    {#if last.alike.length}<div>Passed as sound-alikes: {last.alike.join(', ')}</div>{/if}
    {#if last.early}<div>{last.early} shown before they were said</div>{/if}
  </div>
{/if}
