/**
 * One Greek word, spoken on its own.
 *
 * The voice cannot do it directly. Trained on sentences, it has no valid
 * behavior for a two- or three-sound utterance: `ἐν` alone runs 1.6s of
 * hallucinated noise, and the result is different every time. Chapter reading
 * is unaffected — even the shortest Greek verse is long enough.
 *
 * So the word is synthesized inside a carrier and cut back out. It appears at
 * BOTH ends, which is what makes the cut checkable: the first copy starts at the
 * clip start, the last copy ends at the clip end, so each is measured from an
 * edge we already know, and the two must agree.
 *
 * Runs inside ttsWorker.ts — do not import from the main thread.
 */

import { hebrewWordSounds } from './hebrewSounds.js';

/**
 * Long-short-long spine, long enough to keep the model in distribution.
 * A colon is the longest pause espeak offers (~0.37s); it cannot be told to
 * wait longer, and stacking punctuation does nothing (`,,,` is one token).
 */
const FILLER_WORDS = ['προκεχειροτονημένοις', 'ναί', 'καταδυναστευομένους'];
const CARRIER_MID = `: ${FILLER_WORDS.join(': ')}: `;

/** The carrier's filler said on its own, to learn how long it takes to say. */
export const FILLER_TEXT = `${FILLER_WORDS.join(': ')}.`;

/**
 * True silence, not "quiet".
 *
 * This one number caused every mis-cut. At 0.012 a voiceless fricative or a
 * stop closure reads as silence, so the cut lands *inside* the word — ἀγάπη
 * lost its head at the π, Χριστός and λόγος lost their final ς, βίβλος cut at
 * its own β. Those sounds live around 0.002–0.012; only a real pause goes
 * below 0.002. With the threshold here, the first gap is simply the answer.
 */
const SILENCE = 0.002;
/** Shorter than this is not a pause worth cutting at. */
const MIN_GAP_SECONDS = 0.06;
const FRAME_SECONDS = 0.005;

/** Two filler-only renders must land within this of each other to be trusted. */
const FILLER_AGREE_RATIO = 0.1;
export const FILLER_ATTEMPTS = 4;

/** The two copies must land within this of each other, or the render is rejected. */
const AGREE_RATIO = 0.25;
/** …with an absolute floor, since a percentage is far too tight on a 0.1s word. */
const AGREE_FLOOR_SECONDS = 0.08;

const MAX_ATTEMPTS = 8;

export function carrierFor(word: string): string {
  return `${word}${CARRIER_MID}${word}.`;
}

/**
 * The same long-short-long spine for a word given as sounds (Hebrew), in
 * Hebrew so the voice stays in one language throughout. Full stops rather
 * than colons: the colon's pause is espeak's, and with espeak skipped the
 * pause is whatever the voice learned — a full stop is the one every
 * recording ends on, so it is the pause the voice surely knows.
 */
const SOUNDS_FILLER_WORDS: string[][] = ['הַמִּתְהַלְּכִים', 'כֵּן', 'וּבְמִשְׁפְּטֵיהֶם'].map(
  (word) => hebrewWordSounds(word) ?? []
);
const SOUNDS_CARRIER_MID: string[] = [
  '.', ' ',
  ...SOUNDS_FILLER_WORDS.flatMap((sounds) => [...sounds, '.', ' ']),
];

/** The Hebrew filler said on its own, as FILLER_TEXT is for Greek. */
export const SOUNDS_FILLER: string[] = SOUNDS_FILLER_WORDS.flatMap((sounds, i) =>
  i === 0 ? sounds : ['.', ' ', ...sounds]
).concat('.');

export function soundsCarrierFor(sounds: string[]): string[] {
  return [...sounds, ...SOUNDS_CARRIER_MID, ...sounds, '.'];
}

interface Edges {
  /** First audible frame, in seconds. */
  start: number;
  /** Last audible frame, in seconds. */
  end: number;
  gaps: { from: number; to: number }[];
}

/** Where sound starts, stops, and pauses — measured against true silence. */
function findEdges(samples: Float32Array, sampleRate: number): Edges {
  const frame = Math.round(sampleRate * FRAME_SECONDS);
  const level: number[] = [];
  for (let i = 0; i + frame < samples.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += samples[j] * samples[j];
    level.push(Math.sqrt(sum / frame));
  }

  let first = 0;
  while (first < level.length && level[first] <= SILENCE) first++;
  let last = level.length - 1;
  while (last > 0 && level[last] <= SILENCE) last--;

  const gaps: { from: number; to: number }[] = [];
  let i = first;
  while (i <= last) {
    if (level[i] > SILENCE) { i++; continue; }
    let j = i;
    while (j <= last && level[j] <= SILENCE) j++;
    if ((j - i) * FRAME_SECONDS >= MIN_GAP_SECONDS) {
      gaps.push({ from: i * FRAME_SECONDS, to: j * FRAME_SECONDS });
    }
    i = j;
  }
  return { start: first * FRAME_SECONDS, end: (last + 1) * FRAME_SECONDS, gaps };
}

const gapLength = (gap: { from: number; to: number }): number => gap.to - gap.from;

/** Seconds of actual speech in a clip — first sound to last, less every pause. */
export function talkingTime(samples: Float32Array, sampleRate: number): number | null {
  const { start, end, gaps } = findEdges(samples, sampleRate);
  if (end <= start) return null;
  return end - start - gaps.reduce((sum, gap) => sum + gapLength(gap), 0);
}

/**
 * The filler's talking time from several renders, or null if no two agree.
 * One render can come out odd; two that match are trusted, and averaged.
 */
export function settleFiller(runs: number[]): number | null {
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (Math.abs(runs[i] - runs[j]) <= FILLER_AGREE_RATIO * Math.max(runs[i], runs[j])) {
        return (runs[i] + runs[j]) / 2;
      }
    }
  }
  return null;
}

/**
 * The word's length according to each copy, or null when the clip has no
 * recognizable shape.
 *
 * Without `fillerTalk` the first copy ends at the first pause and the last
 * copy begins at the last one. That is right for most words, but a word with
 * a full stop inside it (the π in ῥυπόω) goes silent there too, so the cut
 * landed mid-word and played as "ip".
 *
 * With `fillerTalk` — how long the filler takes to say on its own — the
 * clip's talking time less the filler, halved, is how long one copy of the
 * word takes. Each copy ends at whichever pause leaves it closest to that.
 * A word with no inner stop still ends at its first pause, since every later
 * pause adds a whole filler word. (An earlier attempt ranked pauses by length
 * against the clip's longest; one long filler pause hid the real one, and
 * words came out with the filler trailing after them.)
 */
export function measureCopies(
  samples: Float32Array,
  sampleRate: number,
  fillerTalk?: number | null
): { first: number; last: number; cutAt: number; gapEnd: number } | null {
  const { start, end, gaps } = findEdges(samples, sampleRate);
  if (gaps.length < 2) return null;
  let opening = gaps[0];
  let closing = gaps[gaps.length - 1];

  if (fillerTalk) {
    const pauses = gaps.reduce((sum, gap) => sum + gapLength(gap), 0);
    const expected = (end - start - pauses - fillerTalk) / 2;
    if (expected > 0) {
      // Talking time of the first copy if it ended at gap i, and of the last
      // copy if it began at gap i.
      const before: number[] = [];
      let paused = 0;
      for (const gap of gaps) {
        before.push(gap.from - start - paused);
        paused += gapLength(gap);
      }
      const after: number[] = [];
      paused = 0;
      for (let i = gaps.length - 1; i >= 0; i--) {
        after[i] = end - gaps[i].to - paused;
        paused += gapLength(gaps[i]);
      }
      let open = 0;
      for (let i = 1; i < gaps.length; i++) {
        if (Math.abs(before[i] - expected) < Math.abs(before[open] - expected)) open = i;
      }
      let close = gaps.length - 1;
      for (let i = gaps.length - 2; i >= 0; i--) {
        if (Math.abs(after[i] - expected) < Math.abs(after[close] - expected)) close = i;
      }
      if (open < close) {
        opening = gaps[open];
        closing = gaps[close];
      }
    }
  }

  return {
    first: opening.from,
    last: end - closing.to,
    cutAt: opening.from,
    gapEnd: opening.to,
  };
}

export function copiesAgree(first: number, last: number): boolean {
  const tolerance = Math.max(AGREE_RATIO * Math.max(first, last), AGREE_FLOOR_SECONDS);
  return Math.abs(first - last) <= tolerance;
}

/**
 * Cut the first copy out of a rendered carrier.
 *
 * Starts at sample 0 on purpose. The word opens the clip, so there is nothing
 * before it — trimming leading silence can only ever eat a quiet onset, which
 * is what made Koine ἀγάπη play as "ahh-pey". Reaches a little past the gap so
 * a voiceless ending is not clipped, but never past the pause itself.
 */
export function cutWord(
  samples: Float32Array,
  sampleRate: number,
  cutAt: number,
  gapEnd: number
): Float32Array {
  const until = Math.min(cutAt + 0.05, gapEnd - 0.01);
  const word = samples.slice(0, Math.min(samples.length, Math.round(until * sampleRate)));
  // Fade the tail only — a fade-in would soften the word's own attack.
  const fade = Math.round(sampleRate * 0.01);
  const out = Float32Array.from(word);
  for (let i = 0; i < fade && i < out.length; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

export const WORD_ATTEMPTS = MAX_ATTEMPTS;
