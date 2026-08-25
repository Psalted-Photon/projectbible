/**
 * Read Aloud engine.
 *
 * Owns the reading position, the text, the rendered speech, and the audio
 * element — and deliberately knows nothing about what is drawn on screen. Read
 * Aloud used to live inside each rendered chapter's control bar, so a chapter
 * could only be read while it happened to be visible. Nothing here depends on
 * components.
 *
 * **Playback is continuous.** Verses are generated one at a time as before, then
 * stitched — with their pauses as real silence — into segments of roughly a
 * minute and a half, and the player is handed those. This matters far more than
 * it sounds: audio is played by the browser's media engine, but *JavaScript* is
 * what gets throttled once the screen goes off. Handing over one verse at a time
 * meant JS had to wake every few seconds to keep going, and every new `src`
 * unloaded the current media and rebuilt the phone's media session from scratch.
 * Segments cut those wakeups by roughly twenty times, and let the media session
 * live for minutes instead of seconds.
 *
 * Segment length ramps up — the first is a single verse, so the time between
 * pressing play and hearing the first word is unchanged.
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
  greekSpeechRoute,
} from '../../adapters/tts';
import { getMorphologyForChapter } from '../../adapters/db';
import { originalSpeechText, canSpeakOriginal } from './originalText';
import { continuousPlay, ttsCurrentVerse } from '../../stores/audioStore';
// One-way dependency on purpose: the timer knows nothing about the engine, so
// the engine listens to it. The reverse would be a circular import.
import { stopAtChapterEnd, sleepStopNonce, cancelSleepTimer } from './sleepTimer';
import { readWav, silencePcm, joinPcm, pcmSeconds } from './stitchAudio';

// ── tuning dials ────────────────────────────────────────────────────────────

/** Target length of a stitched segment. Long, so JS rarely has to wake. */
const SEGMENT_SECONDS = 90;

/**
 * Audio banked before the first word, and the longest we will make the user wait
 * for it — whichever comes first.
 *
 * Starting the instant one verse exists means the generator begins the session
 * already behind playback and never catches up within the first chapter, which
 * is what produced a long silence before chapter two. A head start costs a
 * second or two once; the cushion then grows on its own, because generating runs
 * faster than speaking.
 */
const HEAD_START_SECONDS = 20;
const HEAD_START_MAX_WAIT_MS = 6000;

/** Audio kept ahead of the play position — the cushion for a throttled phone. */
const BUFFER_AHEAD_SECONDS = 150;
const BUFFER_MAX_BYTES = 24 * 1024 * 1024;

/** Silence around an automatic chapter announcement, in seconds. */
const GAP_BEFORE = 3;
const GAP_MID = 1;    // between "The book of Mark" and "Chapter 1"
const GAP_AFTER = 2;

/** Fallback pace before any real audio has been measured (seconds per character). */
const DEFAULT_SECONDS_PER_CHAR = 0.067;

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
  verse: number | null;
  /** Silence to hold before speaking this, in seconds — rendered as real samples. */
  gapBefore: number;
  pcm?: Uint8Array;
  seconds?: number;
  /** Seconds from the start of its chapter, for chapter-wide progress. */
  chapterOffset?: number;
  /**
   * Voice and pronunciation for this line specifically. Unset means the
   * session's own voice — only Greek and bilingual reading set them, so English
   * chapters behave exactly as before.
   */
  voiceId?: string;
  espeakVoice?: string;
  substitutions?: Record<string, string>;
  /** Measured from the rendered clip; clips of different rates cannot be stitched together. */
  sampleRate?: number;
}

interface Mark {
  utterance: Utterance;
  /** Where this utterance starts within its segment. */
  startSeconds: number;
}

interface Segment {
  blob: Blob;
  seconds: number;
  bytes: number;
  marks: Mark[];
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

/**
 * Where the verse being spoken sits inside the segment currently playing.
 *
 * The read-along glow needs this. It paces itself off the audio clock, and when
 * the element held exactly one verse it could simply divide by the element's own
 * duration. Segments hold many verses, so the verse's own start and length have
 * to be handed over or the glow crawls across the whole segment's worth of time.
 */
export const currentVerseWindow = writable<{ startSeconds: number; durationSeconds: number } | null>(null);

/** "Verse 5 of 36" — exact, known before any audio exists. */
export const verseCounter = writable<{ index: number; total: number } | null>(null);

/**
 * Progress through the whole chapter, in seconds. `position` is exact;
 * `duration` is estimated from the chapter's text length and sharpened against
 * the real pace as verses are generated — a chapter's true length cannot be
 * known without generating all of it, which would add the latency we refuse.
 */
export const chapterProgress = writable<{ position: number; duration: number } | null>(null);

export const isReadingActive = derived(readingState, ($s) =>
  $s === 'playing' || $s === 'paused' || $s === 'starting'
);

/**
 * True whenever the engine is generating audio rather than playing it.
 *
 * Starting up is only the obvious case. Playback also waits when the buffer runs
 * dry mid-chapter, and after jumping to a verse that has not been generated yet
 * — and in both of those the state stays "playing", so without this the controls
 * would show a pause button while the app was busy, looking broken rather than
 * busy.
 */
const waitingForAudio = writable(false);

export const isPreparing = derived(
  [readingState, waitingForAudio],
  ([$state, $waiting]) => $state === 'starting' || $waiting
);

// ── internals ───────────────────────────────────────────────────────────────

const textStore = new IndexedDBTextStore();

let queue: Utterance[] = [];      // what to say, in order, across chapters
let renderCursor = 0;             // next utterance to turn into audio
let segments: Segment[] = [];     // stitched, ready to play
let segmentIndex = 0;             // which segment is playing
let generation = 0;               // bumped to invalidate all in-flight work
let translation = '';
let voiceId = '';
let rate = 1;
/** Snapshotted at start, so a mid-read change to either can be detected. */
let greekPronunciation = 'modern';
let bilingualReading = false;
let sampleRate = 22050;
let tailBook = '';
let tailChapter = 0;
let currentUrl: string | null = null;
/** Element events are ours, not the user's, while a segment is being swapped. */
let swapping = false;

/** Measured pace, for the chapter-length estimate. */
let measuredChars = 0;
let measuredSeconds = 0;
/** Set by the sleep timer's "end of chapter": stop once we leave this chapter. */
let stopAfterChapter: { book: string; chapter: number } | null = null;

function secondsPerChar(): number {
  if (measuredChars < 200) return DEFAULT_SECONDS_PER_CHAR;
  return measuredSeconds / measuredChars;
}

function bufferedBytes(): number {
  let total = 0;
  for (let i = segmentIndex; i < segments.length; i++) total += segments[i].bytes;
  return total;
}

/** Seconds of audio ready beyond the one being played. */
function bufferedSecondsAhead(): number {
  let total = 0;
  for (let i = segmentIndex + 1; i < segments.length; i++) total += segments[i].seconds;
  return total;
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

  // Announcements mark an automatic handoff only — pressing play on a chapter
  // yourself does not announce it, since you already know where you are.
  if (announce === 'book') {
    out.push({
      kind: 'announce', text: `The book of ${spokenBookName(book)}`,
      book, chapter, verse: null, gapBefore: GAP_BEFORE,
    });
    out.push({
      kind: 'announce', text: `Chapter ${chapter}`,
      book, chapter, verse: null, gapBefore: GAP_MID,
    });
  } else if (announce === 'chapter') {
    out.push({
      kind: 'announce', text: `${spokenBookName(book)} Chapter ${chapter}`,
      book, chapter, verse: null, gapBefore: GAP_BEFORE,
    });
  }

  // Original-language chapters read from the per-word morphology rather than the
  // verse prose: the plain Greek in the pack is unaccented, which puts espeak's
  // stress on the wrong syllable.
  const greek = isGreekTranslation(translation)
    ? await loadGreekVerses(book, chapter)
    : null;

  let first = true;
  for (const row of rows) {
    let speech = extractSpeechText(row.text);
    const original = greek?.get(row.verse);
    if (!speech && !original) continue;
    if (settings.readHeadings && row.heading && speech) {
      speech = `${row.heading.trim().replace(/\.?$/, '.')} ${speech}`;
    }
    const gapBefore = first && announce !== 'none' ? GAP_AFTER : 0;

    if (original) {
      const route = greekSpeechRoute();
      out.push({
        kind: 'verse', text: original, book, chapter, verse: row.verse, gapBefore,
        voiceId: route.voiceId,
        espeakVoice: route.espeakVoice,
        substitutions: route.substitutions,
      });
      // Bilingual: the same verse again in English, close behind the Greek.
      if (settings.bilingualReading && speech) {
        out.push({
          kind: 'verse', text: speech, book, chapter, verse: row.verse,
          gapBefore: GAP_MID,
        });
      }
    } else if (speech) {
      out.push({ kind: 'verse', text: speech, book, chapter, verse: row.verse, gapBefore });
    }
    first = false;
  }

  return out;
}

function isGreekTranslation(translationId: string): boolean {
  const id = translationId.toLowerCase();
  return id === 'byz' || id === 'tr' || id === 'sblgnt' || id === 'lxx';
}

/** Speakable Greek text per verse, or null when this chapter has no word data. */
async function loadGreekVerses(
  book: string,
  chapter: number
): Promise<Map<number, string> | null> {
  if (!canSpeakOriginal(translation)) return null;
  const rows = await getMorphologyForChapter(translation, book, chapter);
  if (rows.length === 0) return null;

  const byVerse = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byVerse.get(row.verse);
    if (list) list.push(row);
    else byVerse.set(row.verse, [row]);
  }

  const out = new Map<number, string>();
  for (const [verse, words] of byVerse) {
    const text = originalSpeechText(words, words[0]?.language ?? 'greek');
    if (text) out.set(verse, text);
  }
  return out;
}

/** Append the chapter following the queue's tail. False at the end of the road. */
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

// ── chapter length estimate ─────────────────────────────────────────────────

function estimateChapterSeconds(book: string, chapter: number): number {
  let known = 0;
  let unknownChars = 0;
  let gaps = 0;
  for (const u of queue) {
    if (u.book !== book || u.chapter !== chapter) continue;
    gaps += u.gapBefore;
    if (u.seconds !== undefined) known += u.seconds;
    else unknownChars += u.text.length;
  }
  return known + gaps + unknownChars * secondsPerChar();
}

/** Assign each utterance its offset from the start of its chapter. */
function recomputeChapterOffsets(book: string, chapter: number): void {
  let offset = 0;
  for (const u of queue) {
    if (u.book !== book || u.chapter !== chapter) continue;
    offset += u.gapBefore;
    u.chapterOffset = offset;
    offset += u.seconds ?? u.text.length * secondsPerChar();
  }
}

// ── rendering and stitching ─────────────────────────────────────────────────

async function renderUtterance(u: Utterance, gen: number): Promise<boolean> {
  try {
    const blob = await synthesizeSpeech(u.text, u.voiceId ?? voiceId, {
      espeakVoice: u.espeakVoice,
      substitutions: u.substitutions,
    });
    if (gen !== generation) return false;
    const wav = readWav(await blob.arrayBuffer());
    if (gen !== generation) return false;

    sampleRate = wav.sampleRate;
    u.sampleRate = wav.sampleRate;
    u.pcm = wav.pcm;
    u.seconds = wav.seconds;

    measuredChars += u.text.length;
    measuredSeconds += wav.seconds;
    return true;
  } catch (err) {
    if (gen !== generation) return false;
    console.warn('🔊 Read Aloud could not render an utterance:', err);
    // Drop it rather than wedging the queue on one bad verse.
    u.pcm = new Uint8Array(0);
    u.seconds = 0;
    return true;
  }
}

/**
 * Build one segment: render utterances and join them, with their pauses as real
 * silence, until the target length is reached.
 */
async function buildSegment(gen: number): Promise<boolean> {
  const pieces: Uint8Array[] = [];
  const marks: Mark[] = [];
  let seconds = 0;
  // A segment is one WAV, so everything in it has to share a rate. Bilingual
  // reading can alternate voices that do not (the Compact English voice is
  // 16 kHz where Greek is 22.05 kHz), so the segment ends at the change instead
  // of splicing mismatched samples into noise.
  let segmentRate = 0;

  // Long segments are the goal, but never at the cost of a silence. If the
  // player has nothing queued behind what it is playing, hand over whatever is
  // ready instead of holding out for the full length. When the generator is
  // behind, segments come out short and playback keeps moving; once it is ahead
  // they grow back to full length on their own.
  const starving = () => segments.length - segmentIndex <= 1;

  while (gen === generation) {
    if (renderCursor >= queue.length) {
      // Out of planned text. Continue into the next chapter, if we are going to.
      if (get(stopAtChapterEnd) || !get(continuousPlay)) break;
      if (!(await extendQueue())) break;
      if (gen !== generation) return false;
      continue;
    }

    const u = queue[renderCursor];
    if (!u.pcm) {
      if (!(await renderUtterance(u, gen))) return false;
    }

    // Leave it for the next segment, rendered audio and all — the cursor does
    // not advance, so nothing is lost and nothing is synthesized twice.
    const rate = u.sampleRate ?? sampleRate;
    if (marks.length > 0 && rate !== segmentRate) break;
    segmentRate = rate;

    // The pause before an utterance becomes part of the audio, so the player
    // never stops between chapters — silence is just quiet audio.
    if (u.gapBefore > 0) {
      const gap = silencePcm(u.gapBefore, segmentRate);
      pieces.push(gap);
      seconds += u.gapBefore;
    }

    marks.push({ utterance: u, startSeconds: seconds });
    if (u.pcm && u.pcm.byteLength > 0) {
      pieces.push(u.pcm);
      seconds += u.seconds ?? 0;
    }
    renderCursor++;

    recomputeChapterOffsets(u.book, u.chapter);

    if (seconds >= SEGMENT_SECONDS) break;
    // Playing the last thing we have: get this out now rather than making it
    // wait for ninety seconds of audio to finish generating.
    if (starving() && seconds > 0) break;
  }

  if (marks.length === 0) return false;

  segments = [
    ...segments,
    { blob: joinPcm(pieces, segmentRate), seconds: pcmSeconds(pieces, segmentRate), bytes: pieces.reduce((n, p) => n + p.byteLength, 0), marks },
  ];

  // The samples are now inside the segment; drop the per-utterance copies so we
  // are not holding the same audio twice.
  for (const mark of marks) mark.utterance.pcm = undefined;

  return true;
}

/**
 * Every build goes through here, one at a time.
 *
 * This used to be a `filling` boolean, which quietly did two incompatible jobs:
 * a lock ("do not build twice at once") and a signal ("more audio is coming").
 * Straight after a jump those mean opposite things — the flag says work is in
 * flight while that work is stale and about to abandon itself — so a request to
 * build was refused, playback saw the flag clear a moment later, concluded there
 * was nothing left, and stopped. A queue cannot lose a request that way.
 */
let buildChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = buildChain.then(task, task);
  buildChain = run.catch(() => {});
  return run;
}

/** Build segments until there is enough audio banked ahead. */
async function fillLoop(gen: number): Promise<void> {
  while (gen === generation) {
    if (bufferedSecondsAhead() >= BUFFER_AHEAD_SECONDS) break;
    if (bufferedBytes() >= BUFFER_MAX_BYTES) break;
    if (!(await buildSegment(gen))) break;
  }
}

function kickFiller(): void {
  const gen = generation;
  void serialize(() => fillLoop(gen));
}

/** Build exactly one segment, waiting for any build already running. */
function buildOne(gen: number): Promise<boolean> {
  return serialize(() => (gen === generation ? buildSegment(gen) : Promise.resolve(false)));
}

/**
 * Bank a cushion before the first word.
 *
 * Starting the moment one verse exists leaves the generator permanently behind
 * for the whole first chapter, which is what caused a long silence before
 * chapter two. Waiting briefly here costs a second or two once; because
 * generating is faster than speaking, the cushion then grows by itself.
 *
 * Capped in real time so a slow phone starts reading rather than appearing to
 * hang — whichever of the two limits arrives first.
 */
async function buildHeadStart(gen: number): Promise<void> {
  const started = Date.now();

  while (gen === generation) {
    let ready = 0;
    for (const segment of segments) ready += segment.seconds;
    if (ready >= HEAD_START_SECONDS) break;
    if (Date.now() - started >= HEAD_START_MAX_WAIT_MS) break;
    // Build one at a time so the wall-clock cap is checked between them, and a
    // build that yields nothing ends the wait instead of spinning.
    if (!(await buildOne(gen))) break;
  }

  // Whatever else happens, keep banking in the background.
  kickFiller();
}

// ── playback ────────────────────────────────────────────────────────────────

function releaseUrl(): void {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

async function playSegment(gen: number, seekSeconds = 0): Promise<void> {
  if (gen !== generation) return;

  if (segmentIndex >= segments.length) {
    // Nothing ready. Ask for one segment and wait for the answer, rather than
    // watching a flag — a stale build clearing that flag is what used to make a
    // jump look like a stop. Keep asking while segments keep arriving; give up
    // only when a build genuinely produces nothing, which means there is nothing
    // left to read (end of a chapter with auto-advance off, say).
    waitingForAudio.set(true);
    try {
      while (gen === generation && segmentIndex >= segments.length) {
        if (!(await buildOne(gen))) break;
      }
    } finally {
      // Cleared however this ends, so nothing is ever left spinning.
      waitingForAudio.set(false);
    }
    if (gen !== generation) return;
    if (segmentIndex >= segments.length) {
      finish();
      return;
    }
  }

  const segment = segments[segmentIndex];
  const audio = getSharedTtsAudio();

  swapping = true;
  releaseUrl();
  currentUrl = URL.createObjectURL(segment.blob);
  audio.src = currentUrl;
  audio.playbackRate = rate;
  audio.volume = 1;

  audio.onended = () => {
    if (gen !== generation) return;
    segmentIndex++;
    trimPlayed();
    kickFiller();
    void playSegment(gen);
  };
  audio.onerror = () => {
    if (gen !== generation) return;
    readingState.set('error');
    readingError.set('Audio playback failed.');
  };

  try {
    if (seekSeconds > 0) audio.currentTime = seekSeconds;
    await audio.play();
  } catch (err: any) {
    swapping = false;
    if (gen !== generation) return;
    readingState.set('error');
    readingError.set(err?.message ?? 'Playback blocked — press play again.');
    return;
  }
  swapping = false;
  if (gen !== generation) return;

  readingState.set('playing');
  updatePositionFromClock();
  kickFiller();
}

/** Drop segments already played; keep one behind so a small rewind is cheap. */
function trimPlayed(): void {
  const drop = segmentIndex - 1;
  if (drop <= 0) return;
  segments = segments.slice(drop);
  segmentIndex -= drop;
}

/**
 * Which utterance is being spoken, worked out from the playback clock rather
 * than from starting each verse — there is no per-verse event any more.
 */
function currentMark(): Mark | null {
  const segment = segments[segmentIndex];
  if (!segment) return null;
  const t = getSharedTtsAudio().currentTime;
  let found: Mark | null = null;
  for (const mark of segment.marks) {
    if (mark.startSeconds <= t) found = mark;
    else break;
  }
  return found ?? segment.marks[0] ?? null;
}

let lastVerseKey = '';

function updatePositionFromClock(): void {
  const mark = currentMark();
  if (!mark) return;
  const u = mark.utterance;

  // "End of chapter" beats auto-advance — stop the moment we leave it.
  if (stopAfterChapter && (u.book !== stopAfterChapter.book || u.chapter !== stopAfterChapter.chapter)) {
    stopAfterChapter = null;
    cancelSleepTimer();
    stopReading();
    return;
  }

  const key = `${u.book}|${u.chapter}|${u.verse ?? 'a'}`;
  if (key !== lastVerseKey) {
    lastVerseKey = key;
    readingPosition.set({ translation, book: u.book, chapter: u.chapter, verse: u.verse });

    if (u.verse !== null) {
      // The reader's highlight, glow and follow-scroll already read this.
      ttsCurrentVerse.set({ book: u.book, chapter: u.chapter, verse: u.verse });
      currentVerseWindow.set({
        startSeconds: mark.startSeconds,
        durationSeconds: u.seconds ?? 0,
      });
    } else {
      // A spoken announcement — no verse is being read, so the page goes quiet
      // rather than leaving the previous verse lit with its glow still sweeping.
      ttsCurrentVerse.set(null);
      currentVerseWindow.set(null);
    }

    refreshChapterInfo(u.book, u.chapter, u.verse);
  }

  // Progress through the chapter: where this utterance starts, plus how far
  // into it we are. Exact, even though the chapter total is an estimate.
  const into = Math.max(0, getSharedTtsAudio().currentTime - mark.startSeconds);
  const position = (u.chapterOffset ?? 0) + into;
  chapterProgress.set({ position, duration: Math.max(position, estimateChapterSeconds(u.book, u.chapter)) });
}

function refreshChapterInfo(book: string, chapter: number, verse: number | null): void {
  // Bilingual reading queues each verse twice (original, then English), but it
  // is still one verse as far as the counter and the jump list are concerned.
  const verses = [
    ...new Set(
      queue
        .filter((u) => u.kind === 'verse' && u.book === book && u.chapter === chapter)
        .map((u) => u.verse as number)
    ),
  ];
  readingVerseList.set(verses);

  if (verse === null) {
    verseCounter.set(verses.length > 0 ? { index: 0, total: verses.length } : null);
    return;
  }
  const index = verses.indexOf(verse);
  verseCounter.set({ index: index >= 0 ? index + 1 : 0, total: verses.length });
}

function finish(): void {
  console.log('🔊 Read Aloud finished');
  stopReading();
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Begin reading. Must be called from a user gesture: the audio element is
 * unlocked synchronously here so every later programmatic play is allowed,
 * including chapter handoffs hours later with the screen off.
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
  greekPronunciation = settings.greekPronunciation;
  bilingualReading = settings.bilingualReading;

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
      readingError.set(
        isGreekTranslation(translationId) && !canSpeakOriginal(translationId)
          ? 'This text has no word-by-word data, so it cannot be read aloud yet.'
          : 'No text available for this chapter.'
      );
      return;
    }

    // Greek can be voiced by a model the user has not downloaded yet.
    const needed = utterances.find((u) => u.voiceId && u.voiceId !== voiceId)?.voiceId;
    if (needed && !(await isVoiceInstalled(needed))) {
      readingState.set('voice-needed');
      return;
    }
    if (gen !== generation) return;

    queue = utterances;
    renderCursor = verse === null ? 0 : Math.max(0, utterances.findIndex((u) => u.verse === verse));
    segments = [];
    segmentIndex = 0;
    tailBook = book;
    tailChapter = chapter;
    lastVerseKey = '';
    recomputeChapterOffsets(book, chapter);
    refreshChapterInfo(book, chapter, verse);

    await buildHeadStart(gen);
    if (gen !== generation) return;

    await playSegment(gen);
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
  getSharedTtsAudio().play().then(
    () => readingState.set('playing'),
    () => {
      readingState.set('error');
      readingError.set('Playback blocked — press play again.');
    }
  );
}

export function togglePlayPause(): void {
  const state = get(readingState);
  if (state === 'playing') pauseReading();
  else if (state === 'paused') resumeReading();
}

/**
 * Find an utterance inside the segments already built.
 *
 * Searches from the first segment still held, not from the one playing, so
 * jumping *backwards* into the segment kept in reserve is a seek rather than a
 * regenerate.
 */
function locate(predicate: (u: Utterance) => boolean): { index: number; at: number } | null {
  for (let i = 0; i < segments.length; i++) {
    for (const mark of segments[i].marks) {
      if (predicate(mark.utterance)) return { index: i, at: mark.startSeconds };
    }
  }
  return null;
}

/**
 * Move to somewhere already buffered: just a seek, no database read and no
 * generation. That distinction is the whole point — the heavy path is exactly
 * what stalls when the screen is off.
 */
function seekTo(found: { index: number; at: number }): void {
  const gen = ++generation;
  const audio = getSharedTtsAudio();

  if (found.index === segmentIndex) {
    audio.currentTime = found.at;
    lastVerseKey = '';
    updatePositionFromClock();
    // Re-arm the handlers under the new generation.
    audio.onended = () => {
      if (gen !== generation) return;
      segmentIndex++;
      trimPlayed();
      kickFiller();
      void playSegment(gen);
    };
    kickFiller(); // bumping the generation stopped the old filler
    if (get(readingState) === 'paused') return;
    void audio.play();
    return;
  }

  segmentIndex = found.index;
  lastVerseKey = '';
  void playSegment(gen, found.at);
}

/** Jump within the chapter being read. */
export function jumpToVerse(verse: number): void {
  const position = get(readingPosition);
  if (!position) return;

  const found = locate(
    (u) => u.kind === 'verse' && u.verse === verse && u.book === position.book && u.chapter === position.chapter
  );
  if (found) {
    seekTo(found);
    return;
  }

  // Not rendered yet — re-plan from there. Same cost as starting fresh.
  const index = queue.findIndex(
    (u) => u.kind === 'verse' && u.verse === verse && u.book === position.book && u.chapter === position.chapter
  );
  if (index === -1) return;

  const gen = ++generation;
  renderCursor = index;
  segments = [];
  segmentIndex = 0;
  lastVerseKey = '';
  void playSegment(gen);
}

/** Skip to the next chapter — instant when it is already buffered. */
export function skipChapter(direction: 1 | -1): void {
  const position = get(readingPosition);
  if (!position) return;

  if (direction === -1) {
    // Back to the top of the current chapter, like a music player's back button.
    const found = locate((u) => u.book === position.book && u.chapter === position.chapter);
    if (found) seekTo(found);
    return;
  }

  const next = nextChapterOf(position.book, position.chapter);
  if (!next) return;

  const found = locate((u) => u.book === next.book && u.chapter === next.chapter);
  if (found) {
    seekTo(found);
    return;
  }

  // Not buffered — this is the slow path, and the one that stalls with the
  // screen off. Unavoidable here, but the buffer usually makes it unnecessary.
  void startReading(translation, next.book, next.chapter);
}

/** Stop, and release everything — nothing should linger in memory. */
export function stopReading(): void {
  generation++;
  waitingForAudio.set(false);

  swapping = true;
  const audio = getSharedTtsAudio();
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.volume = 1;
  releaseUrl();
  swapping = false;

  queue = [];
  segments = [];
  renderCursor = 0;
  segmentIndex = 0;
  tailBook = '';
  tailChapter = 0;
  lastVerseKey = '';
  measuredChars = 0;
  measuredSeconds = 0;

  readingState.set('idle');
  readingError.set('');
  readingPosition.set(null);
  readingVerseList.set([]);
  verseCounter.set(null);
  chapterProgress.set(null);
  currentVerseWindow.set(null);
  ttsCurrentVerse.set(null);
}

// ── keeping in step with the element ────────────────────────────────────────
// The phone, a headset button or another app can pause playback without going
// through us. Without these, the engine keeps believing it is playing and the
// lock-screen buttons end up wrong.

if (typeof window !== 'undefined') {
  const audio = getSharedTtsAudio();

  audio.addEventListener('timeupdate', () => {
    if (get(readingState) === 'playing') updatePositionFromClock();
  });

  audio.addEventListener('pause', () => {
    if (swapping || audio.ended) return;
    if (get(readingState) === 'playing') readingState.set('paused');
  });

  audio.addEventListener('play', () => {
    if (swapping) return;
    if (get(readingState) === 'paused') readingState.set('playing');
  });

  window.addEventListener('settingsUpdated', () => {
    if (get(readingState) === 'idle') return;
    const settings = getTtsSettings();

    // Speed can change mid-sentence; rendered audio is still valid.
    rate = settings.rate;
    getSharedTtsAudio().playbackRate = rate;

    // A different voice invalidates everything banked — it would play back in
    // the old voice, which is worse than a short pause. Changing the Greek
    // pronunciation or turning bilingual on is the same problem: the banked
    // audio no longer matches what was asked for.
    if (settings.voiceId !== voiceId) {
      console.log('🔊 Read Aloud stopped: the voice changed');
      stopReading();
    } else if (
      settings.greekPronunciation !== greekPronunciation ||
      settings.bilingualReading !== bilingualReading
    ) {
      console.log('🔊 Read Aloud stopped: the reading language changed');
      stopReading();
    }
  });
}

// ── sleep timer ─────────────────────────────────────────────────────────────

let lastStopNonce = get(sleepStopNonce);
sleepStopNonce.subscribe((nonce) => {
  if (nonce === lastStopNonce) return;
  lastStopNonce = nonce;
  if (get(readingState) !== 'idle') {
    console.log('🔊 Read Aloud stopped by the sleep timer');
    stopReading();
  }
});

// "End of chapter" has to interrupt mid-segment, because a segment can span the
// boundary. Recorded as a target and checked on the playback clock rather than
// with a nested subscription, which would stack up each time it was armed.
stopAtChapterEnd.subscribe((armed) => {
  if (!armed) {
    stopAfterChapter = null;
    return;
  }
  const position = get(readingPosition);
  stopAfterChapter = position ? { book: position.book, chapter: position.chapter } : null;
});
