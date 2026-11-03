/**
 * By Heart: hearing a recital while it is said.
 *
 * The mic's audio goes to Whistle (hearingWorker.ts) one piece at a time, the
 * next piece as soon as the last is done, so nothing queues up behind a slow
 * phone. Two ways of doing it, which the lab compares:
 *
 * - stream: Whistle's own live mode. Each reply has the words it has settled
 *   and what it is still unsure of, so right words can show at once and a
 *   wrong one can wait until it has settled.
 * - pauses: nothing until the speaker pauses, then that whole stretch at once.
 *   The fallback if live hearing can't keep up.
 *
 * Audio is only held until Whistle has heard it. Nothing is saved.
 */

import type { StreamReply, TimedWord, Transcript } from '../voice/engine';
import { VoiceTake } from '../voice/mic';
import { splitWords } from './wordMatch';

export type HearingMethod = 'stream' | 'pauses';

/** One reply, in the mic's own time. */
export interface HeardUpdate {
  /** Words newly settled, in seconds from when the mic opened. NaN where it gave no times. */
  settled: TimedWord[];
  /** What came after them, which can still change. */
  pending: string;
  /** How long Whistle spent on this pass, by its own count. */
  passMs: number | null;
  /** From sending the audio to having the answer. */
  roundMs: number;
  /** How much audio this reply covered. */
  fedMs: number;
  /** The last reply of this take. */
  final: boolean;
  /** The reply as it came, for the lab's results. */
  raw: unknown;
}

export interface HearingOptions {
  method: HearingMethod;
  /** Stream only: the least audio to feed at a time. */
  hopMs: number;
  /** Asked before each feed, so they follow the word the user is on. */
  keywords: () => string | null;
  onUpdate: (update: HeardUpdate) => void;
  onLevel?: (level: number) => void;
}

const RATE = 16000;
/** Louder than this is speech, for finding pauses. */
const SPEECH_LEVEL = 0.02;
/** This much quiet after speech is a pause. */
const PAUSE_MS = 350;

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

let loaded: Promise<number> | null = null;

/** Load Whistle, once. Gives how long it took. A failed load isn't kept, so the next try starts over. */
export function loadHearing(): Promise<number> {
  if (!loaded) {
    const from = performance.now();
    loaded = call('load')
      .then(() => performance.now() - from)
      .catch((error) => {
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
  /** When the mic's first audio started, on performance.now()'s clock. */
  startedAt = 0;

  private take: VoiceTake | null = null;
  private down: To16k | null = null;
  private held: Float32Array[] = [];
  private heldLen = 0;
  /** Samples heard so far, and where the audio being held starts. */
  private samples = 0;
  private heldFrom = 0;
  private busy: Promise<void> | null = null;
  private closed = false;
  private spoke = false;
  private quietMs = 0;

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
    if (!this.startedAt) this.startedAt = performance.now() - (pcm.length / rate) * 1000;
    const piece = rate === RATE ? pcm : (this.down ??= new To16k(rate / RATE)).push(pcm);
    this.held.push(piece);
    this.heldLen += piece.length;
    this.samples += piece.length;
    if (this.o.method === 'stream') {
      if (!this.busy && this.heldLen >= (RATE * this.o.hopMs) / 1000) this.send(this.feed());
      return;
    }
    let sum = 0;
    for (let i = 0; i < piece.length; i++) sum += piece[i] * piece[i];
    if (Math.sqrt(sum / (piece.length || 1)) > SPEECH_LEVEL) {
      this.spoke = true;
      this.quietMs = 0;
    } else {
      this.quietMs += (piece.length / RATE) * 1000;
    }
    if (this.spoke && this.quietMs >= PAUSE_MS && !this.busy) {
      this.spoke = false;
      this.send(this.clip(false));
    }
  }

  private send(job: Promise<void>): void {
    this.busy = job
      .catch((error) => console.warn('[By Heart] hearing failed', error))
      .finally(() => {
        this.busy = null;
      });
  }

  /** Everything held, joined, and where it starts. */
  private takeHeld(): { pcm: Float32Array; fromSec: number } {
    const pcm = new Float32Array(this.heldLen);
    let at = 0;
    for (const part of this.held) {
      pcm.set(part, at);
      at += part.length;
    }
    const fromSec = this.heldFrom / RATE;
    this.held = [];
    this.heldLen = 0;
    this.heldFrom = this.samples;
    return { pcm, fromSec };
  }

  private async feed(): Promise<void> {
    const { pcm } = this.takeHeld();
    const fedMs = (pcm.length / RATE) * 1000;
    const sent = performance.now();
    const reply = await call<StreamReply>('feed', { pcm, keywords: this.o.keywords() }, [pcm.buffer as ArrayBuffer]);
    this.o.onUpdate({
      settled: wordsOf(reply),
      pending: reply.pending ?? '',
      passMs: reply.pass_ms ?? null,
      roundMs: performance.now() - sent,
      fedMs,
      final: false,
      raw: reply,
    });
  }

  private async clip(final: boolean): Promise<void> {
    const { pcm, fromSec } = this.takeHeld();
    const fedMs = (pcm.length / RATE) * 1000;
    const sent = performance.now();
    const reply = await call<Transcript>('clip', { pcm, keywords: this.o.keywords() }, [pcm.buffer as ArrayBuffer]);
    this.o.onUpdate({
      settled: wordsOf(reply).map((w) => ({ ...w, start: w.start + fromSec, end: w.end + fromSec })),
      pending: '',
      passMs: null,
      roundMs: performance.now() - sent,
      fedMs,
      final,
      raw: reply,
    });
  }

  /** Closes the mic, and hears what is left before it resolves. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.take?.cancel();
    this.take = null;
    await this.busy;
    if (this.o.method === 'pauses') {
      if (this.heldLen) await this.clip(true).catch((error) => console.warn('[By Heart] last clip failed', error));
      return;
    }
    if (this.heldLen) await this.feed().catch((error) => console.warn('[By Heart] last feed failed', error));
    const sent = performance.now();
    const reply = await call<StreamReply>('stop').catch(() => null);
    this.o.onUpdate({
      settled: wordsOf(reply),
      pending: '',
      passMs: reply?.pass_ms ?? null,
      roundMs: performance.now() - sent,
      fedMs: 0,
      final: true,
      raw: reply,
    });
  }

  /** Closes the mic and forgets the take. */
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    this.take?.cancel();
    this.take = null;
    if (this.o.method === 'stream') void call('stop').catch(() => {});
  }
}
