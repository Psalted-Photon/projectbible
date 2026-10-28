/**
 * The microphone for hold-to-talk commands, from the Voice Control lab.
 *
 * Opened on each press (the browser asks the first time, never at launch) and
 * closed the moment the press ends. Whistle wants 16 kHz mono, which most
 * browsers record at directly; the rest are converted when the press ends.
 */

/** Batches the mic into ~64 ms blocks for the page. */
const TAP = `
  class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (ch) {
        for (let i = 0; i < ch.length; i++) {
          this.buf[this.n++] = ch[i];
          if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
        }
      }
      return true;
    }
  }
  registerProcessor('tap', Tap);
`;

/** The longest command, as Whistle hears 30 s in one pass. */
const MAX_SEC = 30;
/** Shorter than this is a slip of the finger. */
const MIN_SEC = 0.4;

function join(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function to16k(pcm: Float32Array, from: number): Promise<Float32Array> {
  if (from === 16000) return pcm;
  const off = new OfflineAudioContext(1, Math.ceil((pcm.length * 16000) / from), 16000);
  const buf = off.createBuffer(1, pcm.length, from);
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const s = off.createBufferSource();
  s.buffer = buf;
  s.connect(off.destination);
  s.start();
  return (await off.startRendering()).getChannelData(0);
}

/** What to tell someone whose mic didn't start. */
export function micTrouble(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The microphone is blocked. Tap the icon to the left of the address, then Microphone, Allow, and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found.';
  return `The microphone could not start: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * One press of a hold-to-talk button: the mic opens on the press, and closes
 * on the release or when the finger slides off.
 */
export class VoiceTake {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private rate = 16000;
  private parts: Float32Array[] = [];
  private len = 0;
  private live = false;

  /**
   * Opens the mic (asking for it the first time) and keeps what it hears from
   * then on. `onLevel` gets the loudness, 0–1, for a meter; `onFull` is called at 30 s.
   */
  async start(opts: { onLevel?: (level: number) => void; onFull?: () => void } = {}): Promise<void> {
    this.live = true;
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.stream = s;
    if (!this.live) {
      // Let go while the browser was asking for the mic.
      this.close();
      return;
    }
    let c: AudioContext;
    let src: MediaStreamAudioSourceNode;
    try {
      c = new AudioContext({ sampleRate: 16000 });
      src = c.createMediaStreamSource(s);
    } catch {
      // Some browsers refuse a mic at a rate other than the device's own.
      c = new AudioContext();
      src = c.createMediaStreamSource(s);
    }
    this.ctx = c;
    this.rate = c.sampleRate;
    const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
    try {
      await c.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (!this.live) {
      this.close();
      return;
    }
    const node = new AudioWorkletNode(c, 'tap', { numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e) => {
      if (!this.live) return;
      const f = e.data as Float32Array;
      this.parts.push(f);
      this.len += f.length;
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      opts.onLevel?.(Math.min(1, Math.sqrt(sum / f.length) * 6));
      if (this.len >= this.rate * MAX_SEC) opts.onFull?.();
    };
    src.connect(node);
    node.connect(c.destination);
    if (c.state === 'suspended') await c.resume();
  }

  private close() {
    this.live = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
  }

  /** The speech at 16 kHz, or null when the press was too short to be a command. */
  async finish(): Promise<Float32Array | null> {
    this.close();
    if (this.len < this.rate * MIN_SEC) return null;
    return to16k(join(this.parts), this.rate);
  }

  cancel(): void {
    this.close();
    this.parts = [];
    this.len = 0;
  }
}
