/**
 * The lab: one read of a verse out loud, and what it measured. Lag is how long
 * after a word ended it showed, from the word's own time in Whistle's reply.
 */

import type { HeardUpdate } from '../hearing';
import type { TimedWord } from '../../voice/engine';
import { heardAs, isSmallWord, plainWord, splitWords, walkWords, type WalkAt, type WordPass } from '../wordMatch';

export interface RunStats {
  total: number;
  shown: number;
  tapped: number;
  /** Words that had a time to measure against. */
  timed: number;
  lagMedian: number | null;
  lagP90: number | null;
  lagMax: number | null;
  /** Shown before the word had ended, by more than a slip of the clock. */
  early: number;
  /** Shown from what it was still unsure of, and from what had settled. */
  atOnce: number;
  settled: number;
  passes: number;
  passMedian: number | null;
  passMax: number | null;
  /** How the passes changed over the read, in case they slow as the audio grows. */
  passFirst: number | null;
  passLast: number | null;
  roundMedian: number | null;
  smallWords: number;
  dropped: string[];
  alike: string[];
  wrong: string[];
  /** Shown from a guess that never settled as that word. */
  overran: number;
  /** How many times it started on a fresh stream because no word was clearing. */
  freshStarts: number;
  heard: string;
  /** The last thing it was still unsure of. */
  lastGuess: string;
  sample: string;
}

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const median = (xs: number[]): number | null => percentile(xs, 0.5);

export class LiveRun {
  settled: TimedWord[] = [];
  pending = '';
  cursor = 0;
  /** The last thing heard that wasn't the word the user is on. */
  wrongNow: string | null = null;

  private place: WalkAt | undefined;
  private tapped = new Set<number>();
  private shownAt: number[] = [];
  private fromPending: boolean[] = [];
  /** For each word done: how it passed, which heard word passed it (-1 none), and what that word was. */
  private how: WordPass[] = [];
  private by: number[] = [];
  private passedAs: string[] = [];
  /** Settled words that weren't the word the user was on, by where they were heard. */
  private wrong = new Map<number, { heard: string; on: number }>();
  private lastGuess = '';
  private passMs: number[] = [];
  private roundMs: number[] = [];
  private sample = '';

  constructor(readonly words: string[]) {}

  get done(): boolean {
    return this.cursor >= this.words.length;
  }

  /** A reply from Whistle, arrived at `at`. */
  update(u: HeardUpdate, at = performance.now()): void {
    this.settled.push(...u.settled);
    this.pending = u.pending;
    if (u.pending) this.lastGuess = u.pending;
    // What was still a guess can't come back now, so the place can't be past what settled.
    if (u.ended && this.place) this.place.next = Math.min(this.place.next, this.settled.length);
    if (u.passMs != null) this.passMs.push(u.passMs);
    if (u.fedMs > 0) this.roundMs.push(u.roundMs);
    if (!this.sample && u.settled.length) this.sample = JSON.stringify(u.raw).slice(0, 320);
    this.advance(at);
  }

  /** The word the user is on, passed by hand. */
  tap(at = performance.now()): void {
    this.tapped.add(this.cursor);
    this.advance(at);
  }

  private advance(at: number): void {
    const said = this.settled.length;
    const heard = [...this.settled.map((w) => w.word), ...splitWords(this.pending)];
    const walk = walkWords(this.words, heard, this.tapped, this.place);
    for (let i = this.cursor; i < walk.cursor; i++) {
      this.shownAt[i] = at;
      this.fromPending[i] = walk.by[i] >= said;
      this.how[i] = walk.how[i];
      this.by[i] = walk.by[i];
      this.passedAs[i] = heard[walk.by[i]] ?? '';
    }
    this.cursor = walk.cursor;
    this.place = walk.place;
    for (const w of walk.wrong) {
      if (w.at < said && !this.wrong.has(w.at)) this.wrong.set(w.at, w);
    }
    const last = walk.wrong[walk.wrong.length - 1];
    this.wrongNow = last && last.on === this.cursor ? last.heard.trim() : null;
  }

  /** The settled word that said this word: where it passed, or close by if the words shifted as they settled. */
  private settledWord(i: number): TimedWord | null {
    for (const off of [0, 1, -1, 2, -2, 3, -3]) {
      const word = this.settled[this.by[i] + off];
      if (word && heardAs(word.word, this.words[i])) return word;
    }
    return null;
  }

  /** What the whole read comes to, after the last reply. */
  stats(startedAt: number, freshStarts = 0): RunStats {
    const lags: number[] = [];
    let early = 0;
    let overran = 0;
    for (let i = 0; i < this.cursor; i++) {
      if (this.by[i] < 0) continue;
      const word = this.settledWord(i);
      if (!word) {
        if (this.fromPending[i]) overran++;
        continue;
      }
      if (!Number.isFinite(word.end)) continue;
      const lag = this.shownAt[i] - (startedAt + word.end * 1000);
      lags.push(lag);
      if (lag < -50) early++;
    }
    const plain = this.words.map(plainWord);
    const dropped = this.how.flatMap((how, i) => (how === 'dropped' ? [plain[i]] : []));
    const alike = this.how.flatMap((how, i) => (how === 'alike' ? [`${this.passedAs[i].trim()}→${plain[i]}`] : []));
    const used = new Set(this.by);
    return {
      total: this.words.length,
      shown: this.cursor,
      tapped: this.tapped.size,
      timed: lags.length,
      lagMedian: median(lags),
      lagP90: percentile(lags, 0.9),
      lagMax: lags.length ? Math.max(...lags) : null,
      early,
      atOnce: this.fromPending.filter(Boolean).length,
      settled: this.fromPending.filter((p) => !p).length,
      passes: this.passMs.length,
      passMedian: median(this.passMs),
      passMax: this.passMs.length ? Math.max(...this.passMs) : null,
      passFirst: median(this.passMs.slice(0, 5)),
      passLast: median(this.passMs.slice(-5)),
      roundMedian: median(this.roundMs),
      smallWords: plain.filter((w, i) => i < this.cursor && isSmallWord(w)).length,
      dropped,
      alike,
      wrong: [...this.wrong].filter(([at]) => !used.has(at)).map(([, w]) => `${w.heard.trim()} (on ${plain[w.on]})`),
      overran,
      freshStarts,
      heard: this.settled.map((w) => w.word.trim()).join(' '),
      lastGuess: this.lastGuess.trim(),
      sample: this.sample,
    };
  }
}
