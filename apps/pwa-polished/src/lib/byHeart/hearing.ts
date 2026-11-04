/**
 * By Heart: hearing a recital while it is said.
 *
 * The mic's audio goes to Whistle (hearingWorker.ts) in its live mode, one piece
 * at a time, the next piece as soon as the last is done, so nothing queues up
 * behind a slow phone. Each reply has the words it has settled and what it is
 * still unsure of, so right words can show at once and a wrong one can wait until
 * it has settled.
 *
 * Whistle can fall into a loop on repeated words ("holy, holy, holy" and then
 * only more holies) and stop hearing what comes next, so speech with no word
 * clearing for a few seconds starts it on a fresh stream.
 *
 * Audio is only held until Whistle has heard it. Nothing is saved here.
 */

import type { StreamReply, TimedWord } from '../voice/engine';
import { VoiceTake } from '../voice/mic';
import { splitWords } from './wordMatch';

/** One reply, in the mic's own time. */
export interface HeardUpdate {
  /** Words newly settled, in seconds from when the mic opened. NaN where it gave no times. */
  settled: TimedWord[];
  /** What came after them, which can still change. */
  pending: string;
  /** This stream is over, so whatever wasn't settled by now is gone. */
  ended: boolean;
}

export interface HearingOptions {
  /** The least audio to feed at a time. */
  hopMs: number;
  /** Asked before each feed, so they follow the word the user is on. */
  keywords: () => string | null;
  /** Changes whenever anything was done, to notice when nothing is. */
  progress: () => number;
  onUpdate: (update: HeardUpdate) => void;
  onLevel?: (level: number) => void;
  /** What the mic hears, at 16 kHz, for someone who asked to keep their own voice. */
  onPcm?: (pcm: Float32Array) => void;
}

const RATE = 16000;
/** Louder than this is speech. */
const SPEECH_LEVEL = 0.02;
/** This much speech with no word clearing starts a fresh stream, at the next gap between words. */
const STUCK_MS = 3000;
/** Or at this much, if no gap comes. */
const STUCK_MOST_MS = 4500;
/** A word with less than this share of the take's loudest speech was a breath or nothing. */
const SPOKEN_SHARE = 0.3;
/** How much of a word's time has to be that loud. */
const SPOKEN_TIME = 0.4;
/** Whistle's own confidence, below which a word isn't shown as heard. */
const SPOKEN_CONFIDENCE = 0.4;

// ── The worker ──────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function failAll(why: string): void {
  for (const [id, entry] of waiting) {
    entry.reject(new Error(why));
    waiting.delete(id);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./hearingWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data ?? {};
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error || 'Hearing failed'));
  };
  worker.onerror = (event) => {
    failAll(`Hearing stopped: ${event.message}`);
    closeHearing();
  };
  return worker;
}

function call<T>(action: string, payload?: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, action, payload }, transfer);
  });
}

let loaded: Promise<void> | null = null;

/** Load Whistle, once. A failed load isn't kept, so the next try starts over. */
export function loadHearing(): Promise<void> {
  if (!loaded) {
    loaded = call<void>('load').catch((error) => {
      loaded = null;
      throw error;
    });
  }
  return loaded;
}

/** Let go of Whistle and the memory it holds. */
export function closeHearing(): void {
  failAll('Hearing closed');
  worker?.terminate();
  worker = null;
  loaded = null;
}

// ── A take ──────────────────────────────────────────────────────────────────

/** Audio from a mic that wouldn't record at 16 kHz, brought down to it. */
class To16k {
  private sum = 0;
  private n = 0;
  private pos = 0;
  constructor(private ratio: number) {}

  push(input: Float32Array): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.n++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        out.push(this.sum / this.n);
        this.sum = 0;
        this.n = 0;
        this.pos -= this.ratio;
      }
    }
    return Float32Array.from(out);
  }
}

/** A reply's words, or its text as words without times where it gave none. */
function wordsOf(reply: { text?: string; words?: TimedWord[] } | null): TimedWord[] {
  if (reply?.words?.length) return reply.words;
  return splitWords(reply?.text).map((word) => ({ word, start: NaN, end: NaN, probability: NaN }));
}

export class LiveHearing {
  private take: VoiceTake | null = null;
  private down: To16k | null = null;
  private held: Float32Array[] = [];
  private heldLen = 0;
  /** Samples heard so far, and where the audio being held starts. */
  private samples = 0;
  private heldFrom = 0;
  private busy: Promise<void> | null = null;
  private closed = false;
  private lastProgress = -1;
  private stuckMs = 0;
  private freshDue = false;
  /** Where the stream now running starts, in seconds from when the mic opened. */
  private streamFrom = 0;
  /** Each piece's loudness and when it ended, to tell speech from what Whistle imagined. */
  private levels: { at: number; rms: number }[] = [];
  private loudest = 0;

  constructor(private o: HearingOptions) {}

  /** Loads Whistle if need be and opens the mic. Throws what the mic or the load threw. */
  async start(): Promise<void> {
    await loadHearing();
    if (this.closed) return;
    const take = new VoiceTake();
    this.take = take;
    await take.start({ onLevel: this.o.onLevel, onAudio: (pcm, rate) => this.hear(pcm, rate) });
  }

  private hear(pcm: Float32Array, rate: number): void {
    if (this.closed) return;
    const piece = rate === RATE ? pcm : (this.down ??= new To16k(rate / RATE)).push(pcm);
    this.held.push(piece);
    this.heldLen += piece.length;
    this.samples += piece.length;
    this.o.onPcm?.(piece);
    let sum = 0;
    for (let i = 0; i < piece.length; i++) sum += piece[i] * piece[i];
    const rms = Math.sqrt(sum / (piece.length || 1));
    this.levels.push({ at: this.samples / RATE, rms });
    this.loudest = Math.max(this.loudest, rms);
    this.watchStuck((piece.length / RATE) * 1000, rms > SPEECH_LEVEL);
    if (!this.busy && this.heldLen >= (RATE * this.o.hopMs) / 1000) this.send(this.feed());
  }

  /** Only speech counts, so stopping to think never starts a fresh stream. */
  private watchStuck(ms: number, loud: boolean): void {
    const progress = this.o.progress();
    if (progress !== this.lastProgress) {
      this.lastProgress = progress;
      this.stuckMs = 0;
      return;
    }
    if (loud) this.stuckMs += ms;
    if (this.stuckMs >= (loud ? STUCK_MOST_MS : STUCK_MS)) {
      this.stuckMs = 0;
      this.freshDue = true;
    }
  }

  /**
   * Whether someone was speaking when this word was heard, for telling a real
   * word from what Whistle imagines in silence or a breath ("Thank you.", "Poop?").
   * It goes by how loud the mic was, so it can't be a list of phrases to catch.
   */
  wasSpoken(word: TimedWord): boolean {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) return false;
    if (word.probability < SPOKEN_CONFIDENCE) return false;
    const floor = Math.max(SPEECH_LEVEL, this.loudest * SPOKEN_SHARE);
    let all = 0;
    let loud = 0;
    for (const level of this.levels) {
      if (level.at < word.start) continue;
      if (level.at > word.end + 0.07) break;
      all++;
      if (level.rms >= floor) loud++;
    }
    return all > 0 && loud / all >= SPOKEN_TIME;
  }

  /** Word times in the mic's own time, from the stream's. */
  private inMicTime(words: TimedWord[]): TimedWord[] {
    return words.map((w) => ({ ...w, start: w.start + this.streamFrom, end: w.end + this.streamFrom }));
  }

  /** Ends this stream, hearing what it still held. The next feed starts a new one. */
  private async startFresh(): Promise<void> {
    this.freshDue = false;
    const reply = await call<StreamReply>('stop');
    this.o.onUpdate({ settled: this.inMicTime(wordsOf(reply)), pending: '', ended: true });
    this.streamFrom = this.heldFrom / RATE;
  }

  private send(job: Promise<void>): void {
    this.busy = job
      .catch((error) => console.warn('[By Heart] hearing failed', error))
      .finally(() => {
        this.busy = null;
      });
  }

  /** Everything held, joined. */
  private takeHeld(): Float32Array {
    const pcm = new Float32Array(this.heldLen);
    let at = 0;
    for (const part of this.held) {
      pcm.set(part, at);
      at += part.length;
    }
    this.held = [];
    this.heldLen = 0;
    this.heldFrom = this.samples;
    return pcm;
  }

  private async feed(): Promise<void> {
    if (this.freshDue) await this.startFresh();
    const pcm = this.takeHeld();
    const reply = await call<StreamReply>('feed', { pcm, keywords: this.o.keywords() }, [pcm.buffer as ArrayBuffer]);
    this.o.onUpdate({ settled: this.inMicTime(wordsOf(reply)), pending: reply.pending ?? '', ended: false });
  }

  /** Closes the mic, and hears what is left before it resolves. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.take?.cancel();
    this.take = null;
    await this.busy;
    if (this.heldLen) await this.feed().catch((error) => console.warn('[By Heart] last feed failed', error));
    const reply = await call<StreamReply>('stop').catch(() => null);
    this.o.onUpdate({ settled: this.inMicTime(wordsOf(reply)), pending: '', ended: true });
  }

  /** Closes the mic and forgets the take. */
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    this.take?.cancel();
    this.take = null;
    void call('stop').catch(() => {});
  }
}
