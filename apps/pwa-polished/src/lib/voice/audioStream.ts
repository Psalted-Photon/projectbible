/**
 * A recording turned into 16 kHz mono samples a little at a time, for
 * transcribing in the worker, so an hour-long sermon never has to sit in
 * memory whole (an hour as samples is 230 MB, and the browser's own decoder
 * needs three times that on the way).
 *
 * Recordings made here are WebM with Opus inside, which is read element by
 * element and handed to the browser's audio decoder one packet at a time.
 * Anything else (an imported MP3, a phone's M4A, a browser without the
 * decoder) is decoded whole on the page instead: see `needsPageDecode`.
 */

/** This file can't be streamed here; the page decodes it and sends the samples. */
export class NeedsPageDecode extends Error {}

const OUT_RATE = 16000;

// ── WebM, just enough of it ─────────────────────────────────────────────────

const ID = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
} as const;

/**
 * Elements that hold others. Their contents are read as if they followed
 * them, so a size the recorder left open ("unknown", as a live recording
 * writes it) needs no special handling.
 */
const CONTAINERS = new Set<number>([ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Audio, ID.Cluster, ID.BlockGroup]);

/** A variable-length number: its value and how many bytes it took. Null when the bytes run out. */
function vint(b: Uint8Array, at: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } | null {
  if (at >= b.length) return null;
  const first = b[at];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new NeedsPageDecode('Not a WebM file');
  if (at + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[at + i];
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

function uint(b: Uint8Array): number {
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return v;
}

interface Track {
  number: number;
  codec: string;
  priv: Uint8Array | null;
  channels: number;
}

interface Packet {
  /** Milliseconds from the start. */
  ms: number;
  data: Uint8Array;
}

/**
 * The Opus packets of a WebM recording, in order, read from the file a
 * megabyte at a time. Calls `onTrack` once the audio track is known.
 */
async function* webmPackets(blob: Blob, onTrack: (t: Track) => void): AsyncGenerator<Packet> {
  const STEP = 1 << 20;
  let buf = new Uint8Array(0);
  let filePos = 0;
  let scale = 1_000_000; // nanoseconds per timecode tick
  let clusterTime = 0;
  let track: Partial<Track> | null = null;
  let audio: Track | null = null;
  let skipLeft = 0;

  while (filePos < blob.size || buf.length) {
    if (filePos < blob.size) {
      const next = new Uint8Array(await blob.slice(filePos, filePos + STEP).arrayBuffer());
      filePos += next.length;
      const joined = new Uint8Array(buf.length + next.length);
      joined.set(buf);
      joined.set(next, buf.length);
      buf = joined;
    }
    let at = 0;
    // A big element being skipped carries on from the last read.
    if (skipLeft) {
      const n = Math.min(skipLeft, buf.length);
      skipLeft -= n;
      at = n;
    }
    while (!skipLeft) {
      const id = vint(buf, at, true);
      if (!id) break;
      const size = vint(buf, at + id.len, false);
      if (!size) break;
      const head = id.len + size.len;
      if (CONTAINERS.has(id.value)) {
        if (id.value === ID.TrackEntry) track = { channels: 1, priv: null };
        at += head;
        continue;
      }
      if (size.unknown) throw new NeedsPageDecode('An element of unknown size');
      const body = at + head;
      const wanted = [ID.TimecodeScale, ID.TrackNumber, ID.CodecID, ID.CodecPrivate, ID.Channels, ID.Timecode, ID.SimpleBlock, ID.Block] as number[];
      if (!wanted.includes(id.value)) {
        // Not needed: skipped, even across reads.
        if (body + size.value > buf.length) {
          skipLeft = body + size.value - buf.length;
          at = buf.length;
          break;
        }
        at = body + size.value;
        continue;
      }
      if (body + size.value > buf.length) break; // the rest is in the next read
      const data = buf.subarray(body, body + size.value);
      at = body + size.value;
      switch (id.value) {
        case ID.TimecodeScale:
          scale = uint(data) || scale;
          break;
        case ID.TrackNumber:
          if (track) track.number = uint(data);
          break;
        case ID.CodecID:
          if (track) track.codec = new TextDecoder().decode(data);
          break;
        case ID.CodecPrivate:
          if (track) track.priv = data.slice();
          break;
        case ID.Channels:
          if (track) track.channels = uint(data) || 1;
          break;
        case ID.Timecode:
          clusterTime = uint(data);
          break;
        case ID.SimpleBlock:
        case ID.Block: {
          if (!audio) {
            if (!track?.codec || track.number == null) throw new NeedsPageDecode('No audio track before the audio');
            if (track.codec !== 'A_OPUS') throw new NeedsPageDecode(`Audio in ${track.codec}`);
            audio = track as Track;
            onTrack(audio);
          }
          const tn = vint(data, 0, false);
          if (!tn || tn.value !== audio.number) break;
          const rel = (data[tn.len] << 8) | data[tn.len + 1];
          const signed = rel & 0x8000 ? rel - 0x10000 : rel;
          const flags = data[tn.len + 2];
          // Laced frames: not something a recorder writes for audio.
          if (flags & 0x06) throw new NeedsPageDecode('Laced frames');
          yield { ms: ((clusterTime + signed) * scale) / 1e6, data: data.slice(tn.len + 3) };
          break;
        }
      }
    }
    buf = buf.slice(at);
    if (filePos >= blob.size && at === 0) break; // nothing more can be read
  }
}

// ── Down to 16 kHz ──────────────────────────────────────────────────────────

/**
 * Brings samples down to 16 kHz: a low-pass filter, then every second or
 * third sample (Opus always decodes at 48 kHz). Keeps its state, so it can be
 * fed a piece at a time.
 */
class Downsampler {
  private factor: number;
  private taps: Float32Array;
  private hist: Float32Array;
  /** The next sample to keep, counted from the start of the next piece. */
  private phase = 0;

  constructor(rate: number) {
    if (rate % OUT_RATE) throw new NeedsPageDecode(`Audio at ${rate} Hz`);
    this.factor = rate / OUT_RATE;
    const n = 48;
    this.taps = new Float32Array(n + 1);
    // Cut off a little under 8 kHz, so nothing above it folds back down.
    const fc = (0.45 * OUT_RATE) / rate;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const x = i - n / 2;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / n);
      this.taps[i] = sinc * w;
      sum += this.taps[i];
    }
    for (let i = 0; i <= n; i++) this.taps[i] /= sum;
    this.hist = new Float32Array(n);
  }

  push(input: Float32Array): Float32Array {
    if (this.factor === 1) return input;
    const n = this.hist.length;
    const x = new Float32Array(n + input.length);
    x.set(this.hist);
    x.set(input, n);
    this.hist = x.slice(x.length - n);
    const out = new Float32Array(Math.max(0, Math.ceil((input.length - this.phase) / this.factor)));
    let o = 0;
    for (let i = this.phase; i < input.length; i += this.factor) {
      let s = 0;
      for (let k = 0; k <= n; k++) s += this.taps[k] * x[i + k];
      out[o++] = s;
    }
    this.phase += o * this.factor - input.length;
    return out;
  }
}

// ── Decoding ────────────────────────────────────────────────────────────────

export interface PcmPart {
  /** Where these samples start, in 16 kHz samples from the start of the recording. */
  at: number;
  pcm: Float32Array;
}

/**
 * The recording as 16 kHz mono, from `fromSec` on (a little earlier, so the
 * decoder is settled by then). Throws NeedsPageDecode when it can't be done
 * here.
 */
export async function* streamPcm(blob: Blob, fromSec = 0): AsyncGenerator<PcmPart> {
  if (typeof AudioDecoder === 'undefined' || !/webm/i.test(blob.type)) throw new NeedsPageDecode('Not streamable here');

  const out: PcmPart[] = [];
  let failed: Error | null = null;
  let down: Downsampler | null = null;
  let at = -1;
  const skipBefore = Math.max(0, fromSec - 2) * 1000;
  /** When the first packet sent to the decoder starts, which is where its samples start. */
  let firstMs = 0;

  const decoder = new AudioDecoder({
    output: (frame) => {
      try {
        const ch = frame.numberOfChannels;
        const n = frame.numberOfFrames;
        const mono = new Float32Array(n);
        const plane = new Float32Array(n);
        for (let c = 0; c < ch; c++) {
          frame.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          for (let i = 0; i < n; i++) mono[i] += plane[i] / ch;
        }
        if (!down) down = new Downsampler(frame.sampleRate);
        const pcm = down.push(mono);
        if (at < 0) at = Math.round((firstMs / 1000) * OUT_RATE);
        out.push({ at, pcm });
        at += pcm.length;
      } catch (err) {
        failed = err instanceof Error ? err : new Error(String(err));
      } finally {
        frame.close();
      }
    },
    error: (err) => {
      failed = err;
    },
  });

  let configured = false;
  let sent = 0;
  try {
    for await (const p of webmPackets(blob, (t) => {
      decoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: t.channels,
        ...(t.priv ? { description: t.priv } : {}),
      });
      configured = true;
    })) {
      if (failed) throw failed;
      if (!configured || p.ms < skipBefore) continue;
      if (!sent) firstMs = p.ms;
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(p.ms * 1000), data: p.data }));
      sent++;
      // A few seconds at a time, so memory stays small.
      if (decoder.decodeQueueSize > 100 || sent % 250 === 0) {
        while (decoder.decodeQueueSize > 20) await new Promise((r) => setTimeout(r, 5));
        while (out.length) yield out.shift()!;
      }
    }
    if (configured) await decoder.flush();
    if (failed) throw failed;
    while (out.length) yield out.shift()!;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  if (!sent && blob.size > 0 && fromSec === 0) throw new NeedsPageDecode('No audio found');
}

/** Samples already in hand (decoded by the page), handed out in the same shape, from `fromSec` on. */
export function* slicePcm(pcm: Float32Array, fromSec = 0): Generator<PcmPart> {
  const step = OUT_RATE * 10;
  for (let a = Math.floor(fromSec * OUT_RATE); a < pcm.length; a += step) {
    yield { at: a, pcm: pcm.subarray(a, Math.min(pcm.length, a + step)) };
  }
}
