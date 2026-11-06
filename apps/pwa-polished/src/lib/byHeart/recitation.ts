/**
 * By Heart: one stretch of words being said, and how far along it is.
 *
 * What Whistle replies goes through walkWords, which only ever checks the word
 * the user is on, in order, and carries on from the last heard word that passed.
 * The spoken reference, when it has to be said, comes before or after the words
 * and holds the place the same way.
 *
 * A new stretch can carry on from the last one with the mic still open, and
 * what was heard before it started doesn't count toward it.
 */

import type { TimedWord } from '../voice/engine';
import type { HeardUpdate } from './hearing';
import { findSpokenRef, type RefTarget } from './spokenRef';
import { plainWord, splitWords, walkWords, type WalkAt } from './wordMatch';

export interface RecitationOptions {
  /** How many words are done already, on picking up a saved place. */
  cursor?: number;
  ref?: RefTarget | null;
  /** The reference is still to be said, before the words and after them. */
  refStart?: boolean;
  refEnd?: boolean;
  /** Mishearings this verse accepts, by plain word. */
  alsoAs?: Record<string, string[]>;
}

export class Recitation {
  settled: TimedWord[] = [];
  pending = '';
  cursor: number;
  refStart: boolean;
  refEnd: boolean;
  /** Settled words that weren't what the user is on. They may be nothing anyone said. */
  wrongNow: TimedWord[] = [];
  /** What earlier takes heard, for reading a whole recital back at the end. */
  private earlier: string[] = [];

  private place: WalkAt;
  private tapped = new Set<number>();

  constructor(readonly words: string[], private o: RecitationOptions = {}, carry?: Recitation) {
    this.cursor = o.cursor ?? 0;
    this.refStart = !!o.refStart && !!o.ref;
    this.refEnd = !!o.refEnd && !!o.ref;
    this.place = { cursor: this.cursor, next: 0, lastHeard: '' };
    if (carry) {
      this.settled = carry.settled;
      this.pending = carry.pending;
      const heard = carry.heard();
      this.place.next = heard.length;
      this.place.lastHeard = plainWord(heard[heard.length - 1] ?? '');
    }
    this.advance();
  }

  /** The reference is what the user is on. */
  get onReference(): boolean {
    return this.refStart || (this.refEnd && this.cursor >= this.words.length);
  }

  get done(): boolean {
    return this.cursor >= this.words.length && !this.refStart && !this.refEnd;
  }

  /** Changes whenever anything was done, for noticing when nothing is. */
  get mark(): number {
    return this.cursor * 3 + (this.refStart ? 0 : 1) + (this.refEnd ? 0 : 1);
  }

  /** A mishearing to accept from now on. */
  alsoAccept(word: string, heard: string): void {
    const on = plainWord(word);
    const as = plainWord(heard);
    if (!on || !as) return;
    const alsoAs = (this.o.alsoAs ??= {});
    (alsoAs[on] ??= []).push(as);
  }

  heard(): string[] {
    return [...this.settled.map((w) => w.word), ...splitWords(this.pending)];
  }

  /** Everything heard since this stretch started, however many times the mic opened. */
  allHeard(): string[] {
    return [...this.earlier, ...this.heard()];
  }

  /** The mic has opened again: a new stream, starting from nothing heard. */
  newTake(): void {
    this.earlier.push(...this.heard());
    this.settled = [];
    this.pending = '';
    this.wrongNow = [];
    this.place = { cursor: this.cursor, next: 0, lastHeard: '' };
  }

  update(u: HeardUpdate): void {
    this.settled.push(...u.settled);
    this.pending = u.pending;
    // What was still a guess can't come back now, so the place can't be past what settled.
    if (u.ended) this.place.next = Math.min(this.place.next, this.settled.length);
    this.advance();
  }

  /**
   * Keeps what was heard without checking it, for the pause before the next
   * stretch. Replies only carry what is new, so one let go would leave the next
   * stretch starting in the wrong place.
   */
  keep(u: HeardUpdate): void {
    this.settled.push(...u.settled);
    this.pending = u.pending;
  }

  /** What the user is on, passed by hand. */
  tap(): void {
    if (this.refStart) this.refStart = false;
    else if (this.cursor < this.words.length) this.tapped.add(this.cursor);
    else this.refEnd = false;
    this.advance();
  }

  private advance(): void {
    const heard = this.heard();
    if (this.refStart && !this.sayReference(heard)) return;
    if (this.cursor < this.words.length) {
      const walk = walkWords(this.words, heard, this.tapped, this.place, this.o.alsoAs);
      this.cursor = walk.cursor;
      this.place = walk.place;
      this.wrongNow = walk.wrong
        .filter((w) => w.on === walk.cursor && w.at < this.settled.length)
        .map((w) => this.settled[w.at]);
    }
    if (this.cursor >= this.words.length && this.refEnd) this.sayReference(heard);
  }

  /** The reference heard from the place on: passes it and moves the place past it. */
  private sayReference(heard: string[]): boolean {
    const got = this.o.ref ? findSpokenRef(heard, this.place.next, this.o.ref) : null;
    if (!got) {
      this.wrongNow = this.settled.slice(this.place.next);
      return false;
    }
    this.place = { cursor: this.cursor, next: got.end, lastHeard: plainWord(heard[got.end - 1]) };
    if (this.refStart) this.refStart = false;
    else this.refEnd = false;
    this.wrongNow = [];
    return true;
  }
}
