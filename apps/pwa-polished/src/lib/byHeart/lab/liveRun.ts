/**
 * The lab: one read of a verse out loud, and what it measured. Lag is how long
 * after a word ended it showed, from the word's own time in Whistle's reply.
 */

import type { HeardUpdate } from '../hearing';
import type { TimedWord } from '../../voice/engine';
import { isSmallWord, plainWord, splitWords, walkWords } from '../wordMatch';

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
  /** Shown from a guess that never settled. */
  overran: number;
  heard: string;
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

  private tapped = new Set<number>();
  private shownAt: number[] = [];
  private fromPending: boolean[] = [];
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
    const walk = walkWords(this.words, [...this.settled.map((w) => w.word), ...splitWords(this.pending)], this.tapped);
    for (let i = this.cursor; i < walk.cursor; i++) {
      this.shownAt[i] = at;
      this.fromPending[i] = walk.by[i] >= said;
    }
    this.cursor = Math.max(this.cursor, walk.cursor);
    const last = walk.wrong[walk.wrong.length - 1];
    this.wrongNow = last && last.on === this.cursor ? last.heard.trim() : null;
  }

  /** What the whole read comes to, after the last reply. */
  stats(startedAt: number): RunStats {
    const walk = walkWords(this.words, this.settled.map((w) => w.word), this.tapped);
    const lags: number[] = [];
    let early = 0;
    for (let i = 0; i < Math.min(walk.cursor, this.cursor); i++) {
      const word = this.settled[walk.by[i]];
      if (!word || !Number.isFinite(word.end)) continue;
      const lag = this.shownAt[i] - (startedAt + word.end * 1000);
      lags.push(lag);
      if (lag < -50) early++;
    }
    const plain = this.words.map(plainWord);
    const dropped = walk.how.flatMap((how, i) => (how === 'dropped' ? [plain[i]] : []));
    const alike = walk.how.flatMap((how, i) => (how === 'alike' ? [`${this.settled[walk.by[i]]?.word.trim()}→${plain[i]}`] : []));
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
      wrong: walk.wrong.map((w) => `${w.heard.trim()} (on ${plain[w.on]})`),
      overran: Math.max(0, this.cursor - walk.cursor),
      heard: this.settled.map((w) => w.word.trim()).join(' '),
      sample: this.sample,
    };
  }
}
