/**
 * The Transcribe add-on's two models and the planner between them, moved
 * here from the Voice Control lab (public/voice-control-lab/engine.js):
 *
 *   Punctuator   sherpa-onnx's English punctuation + case model (CNN-BiLSTM,
 *                7.5 MB int8), ported from online-punctuation-cnn-bilstm-impl.h.
 *   SileroVad    Silero voice detector v5, one probability per 32 ms frame.
 *   planChunks   turns those probabilities into 20–30 s pieces cut at pauses.
 *
 * Runs in transcribeWorker.ts.
 */

import type * as Ort from 'onnxruntime-web';

type OrtModule = typeof Ort;

// ── Punctuation + capitals ──────────────────────────────────────────────────

/**
 * sentencepiece unigram encoder over the vocab ("piece<TAB>score" per line,
 * the line number being the id). Viterbi over the scores, as sentencepiece
 * itself does; a character no piece covers becomes <unk>.
 */
class Unigram {
  private pieces = new Map<string, { id: number; score: number }>();
  private maxLen = 1;
  private unkScore: number;

  constructor(vocabText: string) {
    let min = 0;
    const lines = vocabText.split('\n');
    for (let id = 0; id < lines.length; id++) {
      const line = lines[id];
      if (!line) continue;
      const tab = line.lastIndexOf('\t');
      const piece = line.slice(0, tab);
      const score = Number(line.slice(tab + 1));
      // <unk>, <s> and </s> are never matched against text.
      if (id < 3) continue;
      this.pieces.set(piece, { id, score });
      this.maxLen = Math.max(this.maxLen, [...piece].length);
      if (score < min) min = score;
    }
    this.unkScore = min - 10;
  }

  encodeWord(word: string): number[] {
    const chars = [...('▁' + word)];
    const n = chars.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1);
    const ids = new Int32Array(n + 1);
    best[0] = 0;
    for (let end = 1; end <= n; end++) {
      for (let start = Math.max(0, end - this.maxLen); start < end; start++) {
        if (best[start] === -Infinity) continue;
        const hit = this.pieces.get(chars.slice(start, end).join(''));
        let score: number;
        let id: number;
        if (hit) {
          score = best[start] + hit.score;
          id = hit.id;
        } else if (end - start === 1) {
          score = best[start] + this.unkScore;
          id = 0;
        } else {
          continue;
        }
        if (score > best[end]) {
          best[end] = score;
          from[end] = start;
          ids[end] = id;
        }
      }
    }
    const out: number[] = [];
    for (let at = n; at > 0; at = from[at]) out.push(ids[at]);
    return out.reverse();
  }
}

const MAX_SEQ = 200;
const BOS = 1;
const EOS = 2;

export class Punctuator {
  static async create(ort: OrtModule, modelBytes: Uint8Array, vocabText: string): Promise<Punctuator> {
    const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
    return new Punctuator(ort, session, new Unigram(vocabText));
  }

  private constructor(
    private ort: OrtModule,
    private session: Ort.InferenceSession,
    private sp: Unigram,
  ) {}

  /** Words the model sees: lowercase, with the recognizer's own marks taken off. */
  static words(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Lowercase words in, sentences out. Packs the words into 200-token rows,
   * <s> … </s>, marking the first piece of each word as the one that carries
   * that word's labels — exactly the reference encoder's layout.
   */
  async punctuate(text: string): Promise<string> {
    const words = Punctuator.words(text);
    if (!words.length) return '';

    const rows: Array<{ tokens: number[]; valids: number[]; labelLen: number }> = [];
    let tokens = [BOS];
    let valids = [1];
    const closeRow = () => {
      tokens.push(EOS);
      valids.push(1);
      const labelLen = valids.reduce((a, v) => a + v, 0);
      while (tokens.length < MAX_SEQ) {
        tokens.push(0);
        valids.push(0);
      }
      rows.push({ tokens, valids, labelLen });
      tokens = [BOS];
      valids = [1];
    };
    for (const w of words) {
      const pieces = this.sp.encodeWord(w);
      if (tokens.length + pieces.length > MAX_SEQ - 1) closeRow();
      tokens.push(...pieces);
      valids.push(1);
      for (let i = 1; i < pieces.length; i++) valids.push(0);
    }
    closeRow();

    const n = rows.length;
    const tok = new Int32Array(n * MAX_SEQ);
    const val = new Int32Array(n * MAX_SEQ);
    const len = new Int32Array(n);
    rows.forEach((r, i) => {
      tok.set(r.tokens, i * MAX_SEQ);
      val.set(r.valids, i * MAX_SEQ);
      len[i] = r.labelLen;
    });
    const T = this.ort.Tensor;
    const [inTok, inVal, inLen] = this.session.inputNames;
    const out = await this.session.run({
      [inTok]: new T('int32', tok, [n, MAX_SEQ]),
      [inVal]: new T('int32', val, [n, MAX_SEQ]),
      [inLen]: new T('int32', len, [n]),
    });
    const caseOut = out[this.session.outputNames[0]];
    const punctOut = out[this.session.outputNames[1]];
    const caseData = caseOut.data as Float32Array;
    const punctData = punctOut.data as Float32Array;
    const nCase = caseOut.dims[1];
    const nPunct = punctOut.dims[1];
    const argmax = (data: Float32Array, row: number, width: number) => {
      let bi = 0;
      for (let i = 1; i < width; i++) if (data[row * width + i] > data[row * width + bi]) bi = i;
      return bi;
    };

    // One row of logits per word; <s> and </s> are dropped inside the model.
    const rowsOut = caseOut.dims[0];
    const skip = rowsOut === words.length ? 0 : 1;
    let s = '';
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      const r = i + skip;
      const c = argmax(caseData, r, nCase);
      if (c === 1) w = w.toUpperCase();
      else if (c === 2) w = w[0].toUpperCase() + w.slice(1);
      const p = argmax(punctData, r, nPunct);
      s += (i ? ' ' : '') + w + (p === 1 ? ',' : p === 2 ? '.' : p === 3 ? '?' : '');
    }
    return s;
  }
}

// ── Voice detector ──────────────────────────────────────────────────────────

export const VAD_FRAME = 512; // 32 ms at 16 kHz
const VAD_CONTEXT = 64;

export class SileroVad {
  static async create(ort: OrtModule, modelBytes: Uint8Array): Promise<SileroVad> {
    const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
    return new SileroVad(ort, session);
  }

  private state = new Float32Array(2 * 1 * 128);
  private context = new Float32Array(VAD_CONTEXT);

  private constructor(
    private ort: OrtModule,
    private session: Ort.InferenceSession,
  ) {}

  reset(): void {
    this.state = new Float32Array(2 * 1 * 128);
    this.context = new Float32Array(VAD_CONTEXT);
  }

  /**
   * Speech probability for each 512-sample frame of `pcm`, carrying the
   * model's state across calls so a long recording can go in pieces.
   */
  async probs(pcm: Float32Array): Promise<Float32Array> {
    const T = this.ort.Tensor;
    const sr = new T('int64', BigInt64Array.from([16000n]), []);
    const frames = Math.floor(pcm.length / VAD_FRAME);
    const out = new Float32Array(frames);
    const x = new Float32Array(VAD_CONTEXT + VAD_FRAME);
    for (let f = 0; f < frames; f++) {
      const at = f * VAD_FRAME;
      x.set(this.context, 0);
      x.set(pcm.subarray(at, at + VAD_FRAME), VAD_CONTEXT);
      const r = await this.session.run({
        input: new T('float32', x, [1, x.length]),
        state: new T('float32', this.state, [2, 1, 128]),
        sr,
      });
      out[f] = (r.output.data as Float32Array)[0];
      this.state = r.stateN.data as Float32Array<ArrayBuffer>;
      this.context = x.slice(x.length - VAD_CONTEXT);
    }
    return out;
  }
}

export interface PlannedPiece {
  /** Sample range, padded a little either side. */
  start: number;
  end: number;
  /** The frame the speech ends at, where the next plan starts. */
  endFrame: number;
  /** Seconds of quiet before it. */
  gapBefore: number;
}

export interface PlanOptions {
  on?: number;
  off?: number;
  minSilenceMs?: number;
  minSpeechMs?: number;
  padMs?: number;
  maxSec?: number;
  paraSec?: number;
  startFrame?: number;
  final?: boolean;
}

/**
 * Plans transcription pieces from frame probabilities.
 *
 * Speech starts above `on` and ends after `minSilenceMs` below `off`. Speech
 * runs are packed into pieces of at most `maxSec`; a pause of `paraSec` or
 * more always starts a new piece and is reported, for paragraph breaks. A run
 * longer than `maxSec` with no pause in it is cut at its quietest frame in the
 * last few seconds before the limit.
 *
 * `final` false holds back the last piece, which may still grow, so a long
 * recording can be planned as its frames arrive.
 */
export function planChunks(probs: ArrayLike<number>, frameCount: number, opts: PlanOptions = {}): PlannedPiece[] {
  const {
    on = 0.5,
    off = 0.35,
    minSilenceMs = 400,
    minSpeechMs = 250,
    padMs = 150,
    maxSec = 28,
    paraSec = 3,
    startFrame = 0,
    final = true,
  } = opts;
  const fps = 16000 / VAD_FRAME;
  const minSilence = Math.ceil((minSilenceMs / 1000) * fps);
  const minSpeech = Math.ceil((minSpeechMs / 1000) * fps);
  const pad = Math.round((padMs / 1000) * fps);
  const maxFrames = Math.floor(maxSec * fps);

  // Speech runs.
  const runs: Array<[number, number]> = [];
  let inSpeech = false;
  let runStart = 0;
  let quietSince = -1;
  for (let f = startFrame; f < frameCount; f++) {
    const p = probs[f];
    if (!inSpeech) {
      if (p >= on) {
        inSpeech = true;
        runStart = f;
        quietSince = -1;
      }
    } else if (p < off) {
      if (quietSince < 0) quietSince = f;
      if (f - quietSince >= minSilence) {
        if (quietSince - runStart >= minSpeech) runs.push([runStart, quietSince]);
        inSpeech = false;
      }
    } else {
      quietSince = -1;
    }
  }
  // Speech still going at the end: taken in when this is the last call, or
  // when it already runs past one piece's length and must be cut regardless.
  const openTaken = inSpeech && (final || frameCount - runStart > maxFrames);
  if (openTaken) runs.push([runStart, frameCount]);

  // Long runs cut at their quietest point.
  const cut: Array<[number, number]> = [];
  for (let [a, b] of runs) {
    while (b - a > maxFrames) {
      const lo = a + maxFrames - Math.floor(6 * fps);
      let at = a + maxFrames;
      for (let f = lo; f < a + maxFrames; f++) if (probs[f] < probs[at]) at = f;
      cut.push([a, at]);
      a = at;
    }
    cut.push([a, b]);
  }

  // Pack runs into pieces.
  const pieces: Array<{ a: number; b: number; gapBefore: number }> = [];
  let cur: { a: number; b: number; gapBefore: number } | null = null;
  let lastEnd = startFrame;
  for (const [a, b] of cut) {
    const gap = (a - (cur ? cur.b : lastEnd)) / fps;
    if (cur && (gap >= paraSec || b - cur.a > maxFrames)) {
      pieces.push(cur);
      cur = null;
    }
    if (!cur) cur = { a, b, gapBefore: (a - lastEnd) / fps };
    else cur.b = b;
    lastEnd = b;
  }
  // When not final, the last piece may still be joined by speech to come, so
  // it waits for the next call unless that speech can no longer join it: a
  // paragraph-length pause already follows it, or it would grow too long.
  let done = final;
  if (!done && cur && !openTaken) {
    const nextSpeech = inSpeech ? runStart : frameCount;
    done = (nextSpeech - cur.b) / fps >= paraSec || frameCount - cur.a > maxFrames;
  }
  if (cur && done) pieces.push(cur);

  return pieces.map((p) => ({
    start: Math.max(0, p.a - pad) * VAD_FRAME,
    end: Math.min(frameCount, p.b + pad) * VAD_FRAME,
    endFrame: p.b,
    gapBefore: p.gapBefore,
  }));
}
