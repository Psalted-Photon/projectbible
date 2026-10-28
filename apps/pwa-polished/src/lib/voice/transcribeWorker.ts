/**
 * Transcribe's worker: a recording in, its words out a piece at a time.
 *
 * The voice detector finds the speech and cuts it into pieces of 20–30
 * seconds at pauses, so no word is split. Each piece goes through Whistle,
 * then the punctuation add-on, then the note's formatting
 * (transcriptFormat.ts), and is sent to the page as soon as it's done
 * (transcribe.ts adds it to the note). The recording is read a little at a
 * time (audioStream.ts), so an hour of it never sits in memory whole.
 *
 * Its own worker with its own copy of Whistle, apart from Voice Control's
 * commands (voiceWorker.ts), so a command is never kept waiting behind a
 * sermon.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error }
 * Progress:  { id, progress: { stage } | { readSec } }
 * Pieces:    { id, piece }
 *
 * From the Voice Control lab (public/voice-control-lab/worker.js, transcribeLong).
 */

import * as ort from 'onnxruntime-web';
import { configureOrt } from '../tts/ttsRuntime';
import { NeedleEngine } from './engine';
import { Punctuator, SileroVad, planChunks, VAD_FRAME } from './transcribeModels';
import { streamPcm, slicePcm, NeedsPageDecode, type PcmPart } from './audioStream';
import { BOOK_KEYWORDS } from './rules';
import type { TranscriptBlock } from './transcriptSink';
import { formatPiece, freshFormat } from './transcriptFormat';

/** One piece of the recording, done. */
export interface TranscriptPiece {
  /** Seconds into the recording. */
  start: number;
  end: number;
  /** Seconds of quiet before it. */
  gapBefore: number;
  blocks: TranscriptBlock[];
  /** Where the next piece starts looking, for carrying on after the app closes. */
  doneSec: number;
}

/** A pause this long starts a new paragraph. */
const PARA_SEC = 3;
const RATE = 16000;

const FOLDER = 'voice-control';
const FILES = {
  js: 'voice-needle.js',
  wasm: 'voice-needle.wasm',
  whistle: 'voice-whistle.cact',
  punct: 'voice-punct.int8.onnx',
  vocab: 'voice-punct.vocab',
  vad: 'voice-vad.onnx',
};

async function readFile(name: string): Promise<Uint8Array> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(FOLDER);
  const file = await (await dir.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

// ── Models ──────────────────────────────────────────────────────────────────

let eng: NeedleEngine | null = null;
let punct: Punctuator | null = null;
let vad: SileroVad | null = null;

async function load(post: (stage: string) => void): Promise<void> {
  configureOrt();
  if (!eng) {
    post('engine');
    const [js, wasm] = await Promise.all([readFile(FILES.js), readFile(FILES.wasm)]);
    const createNeedle = new Function(new TextDecoder().decode(js) + '\nreturn createNeedle;')();
    const engine = await NeedleEngine.create(createNeedle, wasm);
    post('whistle');
    engine.load(await readFile(FILES.whistle));
    eng = engine;
  }
  if (!punct) {
    post('punct');
    const [model, vocab] = await Promise.all([readFile(FILES.punct), readFile(FILES.vocab)]);
    punct = await Punctuator.create(ort, model, new TextDecoder().decode(vocab));
  }
  if (!vad) {
    post('vad');
    vad = await SileroVad.create(ort, await readFile(FILES.vad));
  }
}

// ── The samples in hand ─────────────────────────────────────────────────────

/** The recording's samples from some point on, kept only as far back as the pieces still need. */
class PcmWindow {
  private data = new Float32Array(RATE * 60);
  private from = -1;
  private len = 0;

  get end(): number {
    return this.from < 0 ? 0 : this.from + this.len;
  }

  append(part: PcmPart): void {
    let pcm = part.pcm;
    if (this.from < 0) this.from = part.at;
    else if (part.at < this.end) pcm = pcm.subarray(Math.min(pcm.length, this.end - part.at));
    else if (part.at > this.end) {
      // A gap in the file: quiet, so the times stay right.
      this.grow(part.at - this.end);
      this.len += part.at - this.end;
    }
    this.grow(pcm.length);
    this.data.set(pcm, this.len);
    this.len += pcm.length;
  }

  private grow(more: number): void {
    if (this.len + more <= this.data.length) return;
    const next = new Float32Array(Math.max(this.data.length * 2, this.len + more));
    next.set(this.data.subarray(0, this.len));
    this.data = next;
  }

  /** Samples [a, b), counted from the start of the recording. */
  slice(a: number, b: number): Float32Array {
    const lo = Math.max(0, a - this.from);
    const hi = Math.max(lo, Math.min(this.len, b - this.from));
    return this.data.slice(lo, hi);
  }

  /** Forget everything before sample `a`. */
  dropBefore(a: number): void {
    const n = Math.min(this.len, a - this.from);
    if (n <= 0) return;
    this.data.copyWithin(0, n, this.len);
    this.len -= n;
    this.from += n;
  }
}

// ── Transcribing ────────────────────────────────────────────────────────────

let cancelled = false;

/** Lets a Stop from the page through between pieces. */
const breathe = () => new Promise((r) => setTimeout(r, 0));

async function transcribe(
  id: number,
  { blob, pcm, fromSec = 0 }: { blob?: Blob; pcm?: Float32Array; fromSec?: number },
): Promise<{ cancelled: boolean; needsPcm?: boolean; doneSec: number }> {
  const e = eng!;
  const p = punct!;
  const v = vad!;
  cancelled = false;
  v.reset();

  const win = new PcmWindow();
  let probs = new Float32Array(Math.ceil((RATE * 600) / VAD_FRAME));
  // Frames counted from the start of the recording.
  let scored = Math.floor((fromSec * RATE) / VAD_FRAME);
  let startFrame = scored;
  let doneSec = fromSec;
  let lastPost = 0;
  // Headings and numbered items waiting for their words carry over between pieces.
  const format = freshFormat();

  const score = async () => {
    const upTo = Math.floor(win.end / VAD_FRAME);
    if (upTo <= scored) return;
    const got = await v.probs(win.slice(scored * VAD_FRAME, upTo * VAD_FRAME));
    if (scored + got.length > probs.length) {
      const next = new Float32Array(Math.max(probs.length * 2, scored + got.length));
      next.set(probs);
      probs = next;
    }
    probs.set(got, scored);
    scored += got.length;
  };

  const plan = async (final: boolean) => {
    await score();
    for (const piece of planChunks(probs, scored, { startFrame, final, maxSec: 28, paraSec: PARA_SEC })) {
      startFrame = piece.endFrame;
      const clip = win.slice(piece.start, piece.end);
      const heard = e.transcribe(clip, BOOK_KEYWORDS).text?.trim() ?? '';
      const text = heard ? await p.punctuate(heard) : '';
      doneSec = (piece.endFrame * VAD_FRAME) / RATE;
      const out: TranscriptPiece = {
        start: piece.start / RATE,
        end: piece.end / RATE,
        gapBefore: piece.gapBefore,
        blocks: text ? formatPiece(text, piece.gapBefore < PARA_SEC, format) : [],
        doneSec,
      };
      self.postMessage({ id, piece: out });
      await breathe();
      if (cancelled) return;
    }
    // Kept a second back, for the padding at the start of the next piece.
    // Music or silence with no speech in it is let go too, a second short of
    // where speech could start, so a long stretch of it never piles up.
    let firstOn = startFrame;
    while (firstOn < scored && probs[firstOn] < 0.5) firstOn++;
    win.dropBefore(Math.max(startFrame * VAD_FRAME, (firstOn - 32) * VAD_FRAME) - RATE);
  };

  const source: AsyncIterable<PcmPart> | Iterable<PcmPart> = pcm ? slicePcm(pcm, fromSec) : streamPcm(blob!, fromSec);
  try {
    for await (const part of source) {
      if (cancelled) break;
      // The decoder starts a little early so it's settled; what's before the start is dropped.
      const skip = Math.floor(fromSec * RATE) - part.at;
      if (skip >= part.pcm.length) continue;
      win.append(skip > 0 ? { at: part.at + skip, pcm: part.pcm.subarray(skip) } : part);
      // Ten seconds of new audio at a time.
      if (win.end - scored * VAD_FRAME >= RATE * 10) {
        await plan(false);
        if (cancelled) break;
      }
      const readSec = win.end / RATE;
      if (readSec - lastPost >= 5) {
        lastPost = readSec;
        self.postMessage({ id, progress: { readSec } });
      }
    }
    if (!cancelled) await plan(true);
  } catch (err) {
    if (err instanceof NeedsPageDecode && scored === Math.floor((fromSec * RATE) / VAD_FRAME)) {
      return { cancelled: false, needsPcm: true, doneSec: fromSec };
    }
    throw err;
  }
  return { cancelled, doneSec: cancelled ? doneSec : Math.max(doneSec, win.end / RATE) };
}

self.onmessage = async (ev: MessageEvent<{ id: number; action: string; payload?: any }>) => {
  const { id, action, payload } = ev.data;
  try {
    let result: unknown = null;
    switch (action) {
      case 'load':
        await load((stage) => self.postMessage({ id, progress: { stage } }));
        break;

      case 'transcribe':
        if (!eng || !punct || !vad) throw new Error('Transcribe is not loaded');
        result = await transcribe(id, payload);
        break;

      case 'cancel':
        cancelled = true;
        break;

      default:
        throw new Error('Unknown action ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
