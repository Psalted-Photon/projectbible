/**
 * Read Aloud engine.
 *
 * Owns the reading position, the text, the rendered speech, and the audio
 * element — and deliberately knows nothing about what is drawn on screen.
 *
 * That independence is the whole point. Read Aloud used to live inside each
 * rendered chapter's control bar, so a chapter could only be read if it happened
 * to be on screen, and continuing to the next chapter depended on a brand-new
 * control bar being created to notice an anonymous "play next" flag. With
 * continuous scrolling the next chapter is usually already drawn, no new bar
 * appears, and playback simply stopped. Nothing here depends on components.
 *
 * The queue is a flat list of utterances — verses and spoken chapter
 * announcements — that runs straight across chapter boundaries. A background
 * filler renders ahead of the play position up to a high-water mark, so playback
 * survives the phone throttling generation once the screen is off.
 */

import { get, writable, derived } from 'svelte/store';
import { IndexedDBTextStore } from '../adapters';
import { extractSpeechText } from '../verseRendering';
import { nextChapterOf, spokenBookName } from '../bibleData';
import { getTtsSettings } from '../../adapters/settings';
import {
  synthesizeSpeech,
  getSharedTtsAudio,
  unlockTtsAudio,
  isVoiceInstalled,
} from '../../adapters/tts';
import { continuousPlay, ttsCurrentVerse } from '../../stores/audioStore';
// One-way dependency on purpose: the timer knows nothing about the engine, so
// the engine listens to it. The reverse would be a circular import.
import { stopAtChapterEnd, sleepStopNonce, cancelSleepTimer } from './sleepTimer';

// ── tuning dials ────────────────────────────────────────────────────────────
// Rendered speech runs roughly a third of a megabyte per verse, so the buffer
// has to stop somewhere: unbounded, Psalm 119 alone would bank tens of
// megabytes and keep the CPU busy the whole time. Fill to HIGH, idle, then top
// up once it drops to LOW.

const BUFFER_HIGH = 20;              // utterances rendered ahead before idling
const BUFFER_LOW = 10;               // resume filling at or below this
const BUFFER_MAX_BYTES = 24 * 1024 * 1024;
const KEEP_BEHIND = 4;               // keep a few played verses so jumping back is instant

/** Silence around an automatic chapter announcement. */
const GAP_BEFORE_MS = 3000;
const GAP_MID_MS = 1000;   // between "The book of Mark" and "Chapter 1"
const GAP_AFTER_MS = 2000;

export type ReadingState =
  | 'idle'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'voice-needed'
  | 'downloading'
  | 'error';

/** One thing to speak: a verse of scripture, or a spoken chapter announcement. */
interface Utterance {
  kind: 'verse' | 'announce';
  text: string;
  book: string;
  chapter: number;
  /** Verse number, or null for an announcement. */
  verse: number | null;
  /** Silence to hold *before* speaking this, in ms. */
  gapBefore: number;
  blob?: Blob;
  bytes?: number;
}

export interface ReadingPosition {
  translation: string;
  book: string;
  chapter: number;
  verse: number | null;
}

// ── public state ────────────────────────────────────────────────────────────

export const readingState = writable<ReadingState>('idle');
export const readingError = writable<string>('');
export const readingPosition = writable<ReadingPosition | null>(null);

/** Verse numbers of the chapter being read, for the jump dropdown. */
export const readingVerseList = writable<number[]>([]);

/** True whenever reading is live — what the navbar controls key off. */
export const isReadingActive = derived(readingState, ($s) =>
  $s === 'playing' || $s === 'paused' || $s === 'starting'
);

// ── internals ───────────────────────────────────────────────────────────────

const textStore = new IndexedDBTextStore();

let queue: Utterance[] = [];
let cursor = 0;              // index in `queue` currently playing or about to
let generation = 0;          // bumped to invalidate all in-flight work
let filling = false;
let gapTimer: ReturnType<typeof setTimeout> | null = null;
let translation = '';
let voiceId = '';
let rate = 1;
/** Chapter most recently appended to the queue — where continuation resumes from. */
let tailBook = '';
let tailChapter = 0;

function clearGap(): void {
  if (gapTimer) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
}

function bufferedBytes(): number {
  let total = 0;
  for (let i = cursor; i < queue.length; i++) total += queue[i].bytes ?? 0;
  return total;
}

function renderedAhead(): number {
  let count = 0;
  for (let i = cursor; i < queue.length; i++) if (queue[i].blob) count++;
  return count;
}

/** Drop played utterances beyond the small look-back window. */
function trimBehind(): void {
  const drop = cursor - KEEP_BEHIND;
  if (drop <= 0) return;
  queue = queue.slice(drop);
  cursor -= drop;
}

// ── loading text ────────────────────────────────────────────────────────────

async function loadChapterUtterances(
  book: string,
  chapter: number,
  announce: 'none' | 'chapter' | 'book'
): Promise<Utterance[]> {
  const settings = getTtsSettings();
  const rows = await textStore.getChapter(translation, book, chapter);

  const out: Utterance[] = [];

  // Announcements only mark an automatic handoff — pressing play on a chapter
  // yourself does not announce it, since you already know where you are.
  if (announce === 'book') {
    out.push({
      kind: 'announce', text: `The book of ${spokenBookName(book)}`,
      book, chapter, verse: null, gapBefore: GAP_BEFORE_MS,
    });
    out.push({
      kind: 'announce', text: `Chapter ${chapter}`,
      book, chapter, verse: null, gapBefore: GAP_MID_MS,
    });
  } else if (announce === 'chapter') {
    out.push({
      kind: 'announce', text: `${spokenBookName(book)} Chapter ${chapter}`,
      book, chapter, verse: null, gapBefore: GAP_BEFORE_MS,
    });
  }

  let first = true;
  for (const row of rows) {
    let speech = extractSpeechText(row.text);
    if (!speech) continue;
    if (settings.readHeadings && row.heading) {
      speech = `${row.heading.trim().replace(/\.?$/, '.')} ${speech}`;
    }
    out.push({
      kind: 'verse', text: speech, book, chapter, verse: row.verse,
      // The first verse after an announcement waits out the closing silence.
      gapBefore: first && announce !== 'none' ? GAP_AFTER_MS : 0,
    });
    first = false;
  }

  return out;
}

/** Append the chapter that follows the queue's tail. Returns false at the end. */
async function extendQueue(): Promise<boolean> {
  const next = nextChapterOf(tailBook, tailChapter);
  if (!next) return false;

  const utterances = await loadChapterUtterances(
    next.book,
    next.chapter,
    next.newBook ? 'book' : 'chapter'
  );
  if (utterances.length === 0) return false;

  queue = [...queue, ...utterances];
  tailBook = next.book;
  tailChapter = next.chapter;
  console.log(`🔊 Read Aloud queued ${next.book} ${next.chapter}`);
  return true;
}

// ── the background filler ───────────────────────────────────────────────────

/**
 * Render ahead of the play position up to the high-water mark, then stop. Runs
 * while playing *and* while paused — a pause is free capacity, and banking more
 * audio then is exactly what makes resuming instant.
 */
async function fill(gen: number): Promise<void> {
  if (filling || gen !== generation) return;
  filling = true;

  try {
    while (gen === generation) {
      if (renderedAhead() >= BUFFER_HIGH) break;
      if (bufferedBytes() >= BUFFER_MAX_BYTES) break;

      // Run out of queued text? Pull in the next chapter, but only if we are
      // actually going to continue into it.
      let target = queue.findIndex((u, i) => i >= cursor && !u.blob);
      if (target === -1) {
        if (!get(continuousPlay) || get(stopAtChapterEnd)) break;
        if (!(await extendQueue())) break;
        if (gen !== generation) break;
        continue;
      }

      const utterance = queue[target];
      try {
        const blob = await synthesizeSpeech(utterance.text, voiceId);
        if (gen !== generation) break;
        utterance.blob = blob;
        utterance.bytes = blob.size;
      } catch (err) {
        if (gen !== generation) break;
        console.warn('🔊 Read Aloud could not render an utterance:', err);
        // Drop it rather than wedging the queue on one bad verse.
        utterance.text = '';
        utterance.blob = new Blob([], { type: 'audio/wav' });
        utterance.bytes = 0;
      }
    }
  } finally {
    filling = false;
  }
}

/**
 * Nudge the background filler.
 *
 * Normally it waits until the buffer has drained to the low-water mark and then
 * refills to the high one, rather than topping up a verse at a time — fewer,
 * longer runs are kinder to the CPU. `force` is for the case where playback is
 * waiting on a specific utterance and cannot afford to wait for the watermark.
 */
function kickFiller(force = false): void {
  if (!force && renderedAhead() > BUFFER_LOW) return;
  void fill(generation);
}

// ── playback ────────────────────────────────────────────────────────────────

async function playCursor(gen: number): Promise<void> {
  if (gen !== generation) return;

  // Past the end of what is queued: continue into the next chapter, or stop.
  if (cursor >= queue.length) {
    if (get(stopAtChapterEnd)) {
      // "End of chapter" beats auto-advance — that is the whole point of it.
      cancelSleepTimer();
      finish();
      return;
    }
    if (!get(continuousPlay)) {
      finish();
      return;
    }
    if (!(await extendQueue()) || gen !== generation) {
      finish();
      return;
    }
  }

  const utterance = queue[cursor];
  if (!utterance) {
    finish();
    return;
  }

  // Hold the silence before an announcement (or before the verse after one).
  if (utterance.gapBefore > 0) {
    await new Promise<void>((resolve) => {
      clearGap();
      gapTimer = setTimeout(() => {
        gapTimer = null;
        resolve();
      }, utterance.gapBefore);
    });
    if (gen !== generation) return;
    // Consumed — resuming after a pause should not replay the silence.
    utterance.gapBefore = 0;
    // Pausing during a silence has to actually hold. The timer is left to
    // resolve rather than cancelled (cancelling would strand this promise
    // forever); resuming picks the cursor back up from here.
    if (get(readingState) === 'paused') return;
  }

  // Wait for this utterance to be rendered if the filler has not reached it.
  if (!utterance.blob) {
    kickFiller(true);
    const started = Date.now();
    while (!utterance.blob && gen === generation && Date.now() - started < 120_000) {
      await new Promise((r) => setTimeout(r, 120));
    }
    if (gen !== generation) return;
    if (!utterance.blob) {
      readingState.set('error');
      readingError.set('Speech generation timed out.');
      return;
    }
  }

  // An empty blob is a verse that failed to render — skip rather than stall.
  if (utterance.blob.size === 0) {
    cursor++;
    void playCursor(gen);
    return;
  }

  const audio = getSharedTtsAudio();
  const url = URL.createObjectURL(utterance.blob);
  audio.src = url;
  audio.playbackRate = rate;
  audio.volume = 1;

  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (gen !== generation) return;
    cursor++;
    trimBehind();
    kickFiller();
    void playCursor(gen);
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    if (gen !== generation) return;
    readingState.set('error');
    readingError.set('Audio playback failed.');
  };

  try {
    await audio.play();
  } catch (err: any) {
    if (gen !== generation) return;
    readingState.set('error');
    readingError.set(err?.message ?? 'Playback blocked — press play again.');
    return;
  }
  if (gen !== generation) return;

  readingState.set('playing');
  publishPosition(utterance);
  kickFiller();
}

function publishPosition(utterance: Utterance): void {
  readingPosition.set({
    translation,
    book: utterance.book,
    chapter: utterance.chapter,
    verse: utterance.verse,
  });

  // The reader's highlight, glow and follow-scroll all read this already, so
  // they keep working untouched. Announcements have no verse to highlight.
  if (utterance.verse !== null) {
    ttsCurrentVerse.set({ book: utterance.book, chapter: utterance.chapter, verse: utterance.verse });
  }

  if (utterance.kind === 'verse') refreshVerseList(utterance.book, utterance.chapter);
}

function refreshVerseList(book: string, chapter: number): void {
  const verses = queue
    .filter((u) => u.kind === 'verse' && u.book === book && u.chapter === chapter)
    .map((u) => u.verse as number);
  readingVerseList.set(verses);
}

function finish(): void {
  console.log('🔊 Read Aloud finished');
  stopReading();
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Begin reading. Must be called from a user gesture: the audio element is
 * unlocked synchronously here so every later programmatic play is allowed,
 * including chapter handoffs hours later.
 */
export async function startReading(
  translationId: string,
  book: string,
  chapter: number,
  verse: number | null = null
): Promise<void> {
  unlockTtsAudio();

  stopReading();
  const gen = ++generation;

  const settings = getTtsSettings();
  translation = translationId;
  voiceId = settings.voiceId;
  rate = settings.rate;

  readingState.set('starting');
  readingError.set('');

  try {
    if (!(await isVoiceInstalled(voiceId))) {
      readingState.set('voice-needed');
      return;
    }
    if (gen !== generation) return;

    const utterances = await loadChapterUtterances(book, chapter, 'none');
    if (gen !== generation) return;
    if (utterances.length === 0) {
      readingState.set('error');
      readingError.set('No text available for this chapter.');
      return;
    }

    queue = utterances;
    cursor = verse === null ? 0 : Math.max(0, utterances.findIndex((u) => u.verse === verse));
    tailBook = book;
    tailChapter = chapter;
    refreshVerseList(book, chapter);

    kickFiller();
    await playCursor(gen);
  } catch (err: any) {
    if (gen !== generation) return;
    readingState.set('error');
    readingError.set(err?.message ?? 'Could not start reading.');
  }
}

export function pauseReading(): void {
  if (get(readingState) !== 'playing') return;
  getSharedTtsAudio().pause();
  readingState.set('paused');
  // A pause is free capacity — keep banking audio so resuming is instant.
  kickFiller();
}

export function resumeReading(): void {
  if (get(readingState) !== 'paused') return;
  const audio = getSharedTtsAudio();
  // Mid-utterance: just carry on. Between utterances (a gap was interrupted):
  // restart the cursor.
  if (audio.src && audio.currentTime > 0 && !audio.ended) {
    audio.play().then(
      () => readingState.set('playing'),
      () => {
        readingState.set('error');
        readingError.set('Playback blocked — press play again.');
      }
    );
    return;
  }
  void playCursor(generation);
}

export function togglePlayPause(): void {
  const state = get(readingState);
  if (state === 'playing') pauseReading();
  else if (state === 'paused') resumeReading();
}

/** Jump within the chapter being read. Renders the target first if needed. */
export function jumpToVerse(verse: number): void {
  const index = queue.findIndex((u) => u.kind === 'verse' && u.verse === verse);
  if (index === -1) return;

  const gen = ++generation;
  clearGap();
  const audio = getSharedTtsAudio();
  audio.onended = null;
  audio.onerror = null;
  audio.pause();

  cursor = index;
  // Anything already rendered stays rendered, so jumping back is instant.
  void fill(gen);
  void playCursor(gen);
}

/** Stop, and release the whole buffer — nothing should linger in memory. */
export function stopReading(): void {
  generation++;
  clearGap();

  const audio = getSharedTtsAudio();
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.volume = 1;

  queue = [];
  cursor = 0;
  tailBook = '';
  tailChapter = 0;

  readingState.set('idle');
  readingError.set('');
  readingPosition.set(null);
  readingVerseList.set([]);
  ttsCurrentVerse.set(null);
}

// ── settings changes ────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('settingsUpdated', () => {
    if (get(readingState) === 'idle') return;
    const settings = getTtsSettings();

    // Speed can change mid-sentence; the rendered audio is still valid.
    rate = settings.rate;
    getSharedTtsAudio().playbackRate = rate;

    // A different voice invalidates everything banked — it would play back in
    // the old voice, which is worse than a short pause.
    if (settings.voiceId !== voiceId) {
      console.log('🔊 Read Aloud stopped: the voice changed');
      stopReading();
    }
  });
}

// ── sleep timer ─────────────────────────────────────────────────────────────
// The timer runs the clock and the fade; only the engine can tear playback down
// properly, so it asks us here. Skip the value present at subscribe time — that
// is history, not a fresh request.

let lastStopNonce = get(sleepStopNonce);
sleepStopNonce.subscribe((nonce) => {
  if (nonce === lastStopNonce) return;
  lastStopNonce = nonce;
  if (get(readingState) !== 'idle') {
    console.log('🔊 Read Aloud stopped by the sleep timer');
    stopReading();
  }
});
