<script lang="ts">
  /**
   * One By Heart verse's own page, inside the window: how well it is known, then
   * Study and Practice, which open right here, one at a time. Study is never
   * scored and Practice always is, so where a thing sits says what it does.
   */
  import { Barbell, BookOpen, CaretDown, CaretRight, MicrophoneSlash } from 'phosphor-svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { getSettings } from '../../adapters/settings';
  import type { GameMode } from '../../lib/byHeart/game';
  import { formatFor, overallOf, progressOf, stageOf, standingLine, type Stage } from '../../lib/byHeart/schedule';
  import { scoreColor } from '../../lib/byHeart/scoring';
  import { referenceOf } from '../../lib/byHeart/verse';
  import { PRACTICE, PRACTICE_ORDER, SILENT_MARK, STAGE_NAMES, STUDY, WAYS } from '../../lib/byHeart/ways';
  import { isOriginalLanguage } from '../../lib/translationKind';
  import { voiceReady } from '../../lib/voice/holdToTalk';
  import ReadAloudTextButton from '../ReadAloudTextButton.svelte';
  import TranslationTag from './TranslationTag.svelte';

  export let verse: DBByHeartVerse;
  /** The score of this verse's saved recital, if it has one. */
  export let recitalScore: number | null = null;
  export let hearingRecital = false;
  export let onPlay: (mode: GameMode) => void;
  export let onEditCard: () => void;
  export let onRemove: () => void;
  export let onHearRecital: () => void;
  export let onDeleteRecital: () => void;

  const STAGES: Stage[] = ['new', 'learning', 'known'];

  let open: 'study' | 'practice' | null = null;

  $: stage = stageOf(verse);
  $: overall = overallOf(verse);

  function toggle(section: 'study' | 'practice') {
    open = open === section ? null : section;
  }

  $: original = isOriginalLanguage(verse.translation);
  $: noMic = $voiceReady.mic === false || $voiceReady.permission === 'denied';
  $: ways = PRACTICE_ORDER.filter((mode) => mode === 'silent' || !original);
  // The same pick Today's Practice would make for this verse.
  $: suggested = original || noMic || getSettings().byHeartSilent === true ? 'silent' : formatFor(verse);
  $: practiceNote = original
    ? `The app only hears English, so this one is practiced ${WAYS.silent.name.toLowerCase()}.`
    : noMic
      ? `No mic here, so ${WAYS.silent.name} is the one that will work.`
      : '';
  $: listenTitle = `By Heart · ${referenceOf(verse)} ${verse.translation.toUpperCase()}`;
</script>

<div class="bh-verse">
  <div class="standing">
    <ol class="ladder" aria-label="Stage: {STAGE_NAMES[stage]}">
      {#each STAGES as step, i (step)}
        {#if i}<li class="sep" aria-hidden="true"><CaretRight size="0.9em" weight="bold" /></li>{/if}
        <li class:on={step === stage}>{STAGE_NAMES[step]}</li>
      {/each}
    </ol>
    {#if verse.score !== null}
      <div class="numbers">
        <div class="number">
          {#if overall !== null}
            <span class="value" style="color: {scoreColor(overall)}">{overall}%</span>
          {:else}
            <span class="value none">Not yet</span>
          {/if}
          <span class="number-label">Overall</span>
        </div>
        <div class="number">
          <span class="value" style="color: {scoreColor(verse.score)}">
            {verse.score}%
            {#if progressOf(verse).silent}
              <span class="silent" title={SILENT_MARK} aria-label={SILENT_MARK}><MicrophoneSlash size="0.6em" weight="bold" /></span>
            {/if}
          </span>
          <span class="number-label">Last try</span>
        </div>
      </div>
    {/if}
    <p class="sentence">{standingLine(verse)}</p>
  </div>

  <section class="section" class:open={open === 'study'}>
    <button class="section-head section-study" aria-expanded={open === 'study'} on:click={() => toggle('study')}>
      <span class="section-icon"><BookOpen size="1.4em" weight="bold" /></span>
      <span class="section-text">
        <span class="section-name">{STUDY.name}</span>
        <span class="section-line">{STUDY.line}</span>
      </span>
      <span class="caret"><CaretDown size="1em" weight="bold" /></span>
    </button>
    {#if open === 'study'}
      <div class="section-body">
        <p class="words">{verse.passage} <TranslationTag translation={verse.translation} /></p>
        <div class="study-actions">
          {#if !original}
            <span class="listen">
              <ReadAloudTextButton title={listenTitle} paragraphs={() => [verse.passage]} text="Listen" label="Listen to this verse" />
            </span>
          {/if}
          {#if recitalScore !== null}
            <button class="action" on:click={onHearRecital}>
              {hearingRecital ? 'Stop your recital' : `Hear your recital (${recitalScore}%)`}
            </button>
            <button class="action" on:click={onDeleteRecital}>Delete recital</button>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <section class="section" class:open={open === 'practice'}>
    <button class="section-head section-practice" aria-expanded={open === 'practice'} on:click={() => toggle('practice')}>
      <span class="section-icon"><Barbell size="1.4em" weight="bold" /></span>
      <span class="section-text">
        <span class="section-name">{PRACTICE.name}</span>
        <span class="section-line">{PRACTICE.line}</span>
      </span>
      <span class="caret"><CaretDown size="1em" weight="bold" /></span>
    </button>
    {#if open === 'practice'}
      <div class="ways">
        {#if practiceNote}<p class="note">{practiceNote}</p>{/if}
        {#each ways as mode (mode)}
          <button class="way" on:click={() => onPlay(mode)}>
            <span class="way-top">
              <span class="way-name">{WAYS[mode].name}</span>
              {#if mode === suggested}<span class="tag">Suggested</span>{/if}
            </span>
            <span class="way-line">{WAYS[mode].line}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <div class="foot">
    <button class="action" on:click={onEditCard}>Edit or share card</button>
    <button class="action danger" on:click={onRemove}>Remove</button>
  </div>
</div>

<style>
  .bh-verse {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    overflow-y: auto;
  }

  .standing {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px 2px 4px;
  }

  .ladder {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 0;
    font-size: 0.85em;
    list-style: none;
  }

  .ladder li {
    opacity: 0.5;
  }

  .ladder li.on {
    color: var(--bh-accent);
    font-weight: 700;
    opacity: 1;
  }

  .ladder .sep {
    display: inline-flex;
    opacity: 0.35;
  }

  .numbers {
    display: flex;
    gap: 24px;
  }

  .number {
    display: flex;
    flex-direction: column;
  }

  .value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 1.5em;
    font-weight: 700;
    line-height: 1.2;
  }

  .value.none {
    font-size: 1em;
    line-height: 1.8;
    opacity: 0.7;
  }

  .silent {
    display: inline-flex;
    opacity: 0.8;
  }

  .number-label {
    font-size: 0.75em;
    opacity: 0.75;
  }

  .sentence {
    margin: 0;
    font-size: 0.9em;
    line-height: 1.4;
  }

  .section {
    flex-shrink: 0;
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 10px;
    overflow: hidden;
  }

  .section.open {
    border-color: var(--bh-accent);
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: calc(10px * var(--bar-scale, 1));
    width: 100%;
    padding: calc(12px * var(--bar-scale, 1));
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .section-icon {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--bh-accent);
  }

  .section-text {
    flex: 1;
    min-width: 0;
  }

  .section-name {
    display: block;
    font-size: calc(15px * var(--bar-scale, 1));
    font-weight: 600;
  }

  .section-line {
    display: block;
    margin-top: 1px;
    font-size: calc(12.5px * var(--bar-scale, 1));
    line-height: 1.35;
    opacity: 0.75;
  }

  .caret {
    flex-shrink: 0;
    display: inline-flex;
    opacity: 0.6;
  }

  .section.open .caret {
    transform: rotate(180deg);
  }

  .section-body {
    padding: 2px 14px 14px;
  }

  .words {
    margin: 0;
    font-size: 1.15em;
    line-height: 1.6;
  }

  .study-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }

  .listen :global(.rat-btn) {
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    font: inherit;
    font-size: 0.85em;
  }

  .note {
    margin: 0;
    padding: 2px 14px 10px;
    font-size: 0.8em;
    line-height: 1.4;
    opacity: 0.8;
  }

  .way {
    display: block;
    width: 100%;
    padding: calc(10px * var(--bar-scale, 1)) 14px;
    border: none;
    border-top: 1px solid rgba(127, 127, 127, 0.2);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .way-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .way-name {
    font-size: 0.95em;
    font-weight: 600;
  }

  .tag {
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(244, 114, 182, 0.18);
    color: var(--bh-accent);
    font-size: 0.7em;
    font-weight: 600;
  }

  .way-line {
    display: block;
    margin-top: 2px;
    font-size: 0.8em;
    line-height: 1.35;
    opacity: 0.75;
  }

  .foot {
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: auto;
    padding-top: 6px;
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
</style>
