/**
 * Recording in Notes: record, pause and stop, one recording at a time.
 *
 * The browser's own recorder does the work, in a speech-quality format (about
 * 15 MB an hour) or, with Settings → Voice Control → Recording quality, a
 * music one. Pieces are saved every 2 seconds as it goes (recordings.ts), so
 * a crash or a closed app loses only the last couple of seconds.
 *
 * The mic goes dead silent when a phone's screen locks (Voice Control lab,
 * 10/27), so the screen is kept awake for as long as a recording runs. A
 * black pocket screen (PocketScreen.svelte) covers it on a phone, so the
 * screen costs little and pocket taps do nothing; it comes up by itself after
 * two minutes without a touch. If the screen locks anyway, the recorder
 * notices the dead silence and says so when there is sound again: "The screen
 * locked at 2:13. Nothing was recorded until 3:05."
 *
 * The recording itself is never turned into commands: a preacher saying "turn
 * to John 3" can't move the reader.
 */

import { get, writable } from 'svelte/store';
import { getSettings } from '../../adapters/settings';
import { showNotice } from '../../stores/noticeStore';
import { stayAwake, allowSleep } from '../installAwake';
import { micTrouble } from '../voice/mic';
import { micReadyToRecord, recordMicFailed } from '../voice/holdToTalk';
import {
  addChunk,
  clock,
  defaultRecordingName,
  markLive,
  newRecordingId,
  putRecording,
  type Recording,
  type RecordingGap,
  type RecordQuality,
} from './recordings';

export type RecPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export interface RecorderState {
  phase: RecPhase;
  id: string | null;
  /** Seconds recorded, pauses left out. */
  elapsed: number;
  /** Loudness, 0–1, for the meter. */
  level: number;
  /** The black pocket screen is up. */
  pocket: boolean;
  /** The page the recording was started from, if any. */
  page: Recording['page'];
}

const IDLE: RecorderState = { phase: 'idle', id: null, elapsed: 0, level: 0, pocket: false, page: null };

export const recorder = writable<RecorderState>(IDLE);

/** A recording is running or paused. */
export const recordingLive = (s: RecorderState) => s.phase !== 'idle';

/** Seconds between saved pieces. */
const PIECE_MS = 2000;
/** No sound at all for this long is a cut-off mic: even a quiet room is louder. */
const GAP_SEC = 3;
const DEAD = 0.0001;
/** A phone left this long without a touch gets the pocket screen. */
const POCKET_AFTER_MS = 2 * 60 * 1000;

const BITRATE: Record<RecordQuality, number> = { speech: 32000, music: 128000 };

/** Peak and loudness every tenth of a second, for the meter and the dead-silence check. */
const METER = `
  class Meter extends AudioWorkletProcessor {
    constructor() { super(); this.size = Math.round(sampleRate / 10); this.n = 0; this.peak = 0; this.sum = 0; }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (ch) {
        for (let i = 0; i < ch.length; i++) {
          const v = ch[i] < 0 ? -ch[i] : ch[i];
          if (v > this.peak) this.peak = v;
          this.sum += ch[i] * ch[i];
          if (++this.n === this.size) {
            this.port.postMessage([this.peak, Math.sqrt(this.sum / this.n)]);
            this.n = 0; this.peak = 0; this.sum = 0;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('meter', Meter);
`;

interface Live {
  rec: Recording;
  mr: MediaRecorder;
  stream: MediaStream;
  ctx: AudioContext | null;
  startedAt: number;
  pausedMs: number;
  pauseAt: number;
  seq: number;
  /** Pieces still being written, in order. */
  saving: Promise<void>;
  /** Seconds in when there was last any sound. */
  lastAlive: number;
  /** The app has been off the screen since then. */
  hiddenSinceAlive: boolean;
  timer: ReturnType<typeof setInterval>;
  stopped: Promise<void>;
}

let live: Live | null = null;
/** A gap that closed while the app was off the screen, said when it's back. */
let untold: RecordingGap | null = null;
let lastTouch = Date.now();

function elapsedOf(l: Live, now = Date.now()): number {
  return (now - l.startedAt - l.pausedMs - (l.pauseAt ? now - l.pauseAt : 0)) / 1000;
}

const patch = (p: Partial<RecorderState>) => recorder.update((s) => ({ ...s, ...p }));

function tellGap(gap: RecordingGap): void {
  const what = gap.screenOff ? 'The screen locked' : 'The mic went silent';
  showNotice(`${what} at ${clock(gap.from)}. Nothing was recorded until ${clock(gap.to)}.`, 'info');
}

function closeGap(l: Live, to: number): void {
  if (to - l.lastAlive < GAP_SEC) return;
  const gap: RecordingGap = { from: l.lastAlive, to, screenOff: l.hiddenSinceAlive };
  l.rec.gaps = [...l.rec.gaps, gap];
  if (document.visibilityState === 'visible') tellGap(gap);
  else untold = gap;
}

function onLevel(l: Live, peak: number, rms: number): void {
  if (live !== l || l.pauseAt) return;
  const now = elapsedOf(l);
  if (peak >= DEAD) {
    closeGap(l, now);
    l.lastAlive = now;
    l.hiddenSinceAlive = document.visibilityState !== 'visible';
  }
  patch({ level: Math.min(1, rms * 6) });
}

function saveDetails(l: Live, refresh = false): Promise<void> {
  l.rec.durationSec = elapsedOf(l);
  return putRecording({ ...l.rec }, refresh).catch(() => {});
}

function onVisibility(): void {
  const l = live;
  if (!l) return;
  if (document.visibilityState === 'hidden') {
    l.hiddenSinceAlive = true;
    // What's in hand is written down before the browser can freeze the app.
    try {
      if (l.mr.state === 'recording') l.mr.requestData();
    } catch {
      // Fine: the next piece carries it.
    }
    void saveDetails(l);
  } else {
    lastTouch = Date.now();
    if (untold) {
      tellGap(untold);
      untold = null;
    }
  }
}

function onTouch(): void {
  lastTouch = Date.now();
}

const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

function tick(l: Live): void {
  if (live !== l) return;
  const s = get(recorder);
  patch({ elapsed: elapsedOf(l) });
  if (!s.pocket && coarse() && document.visibilityState === 'visible' && Date.now() - lastTouch > POCKET_AFTER_MS) {
    patch({ pocket: true });
  }
}

async function openMeter(l: Live): Promise<void> {
  try {
    const ctx = new AudioContext();
    l.ctx = ctx;
    const url = URL.createObjectURL(new Blob([METER], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (live !== l) return;
    const node = new AudioWorkletNode(ctx, 'meter', { numberOfOutputs: 0 });
    node.port.onmessage = (e) => onLevel(l, e.data[0], e.data[1]);
    ctx.createMediaStreamSource(l.stream).connect(node);
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    // No meter and no dead-silence check; the recording itself is unaffected.
  }
}

/**
 * Starts a recording, opening the mic card first when the mic isn't ready
 * (the first time, the app says what it's for before the browser asks).
 * `page` is the notebook page its words go into once transcribed.
 */
export async function startRecording(opts: { page?: Recording['page'] } = {}): Promise<void> {
  if (get(recorder).phase !== 'idle') return;
  if (!micReadyToRecord(() => void startRecording(opts))) return;
  if (typeof MediaRecorder === 'undefined') {
    showNotice('This browser can’t record audio.', 'error');
    return;
  }
  const quality: RecordQuality = getSettings().recordQuality === 'music' ? 'music' : 'speech';
  patch({ ...IDLE, phase: 'starting', page: opts.page ?? null });
  let stream: MediaStream;
  try {
    // Speech is cleaned up for the words; music is left as it is, since the
    // clean-up flattens singing.
    stream = await navigator.mediaDevices.getUserMedia({
      audio:
        quality === 'music'
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    recorder.set(IDLE);
    if (!recordMicFailed(err)) showNotice(micTrouble(err), 'error');
    return;
  }

  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  let mr: MediaRecorder;
  try {
    mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: BITRATE[quality] });
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    recorder.set(IDLE);
    showNotice(`Recording couldn’t start: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return;
  }

  const rec: Recording = {
    id: newRecordingId(),
    name: defaultRecordingName(),
    mime: mr.mimeType || mime || 'audio/webm',
    createdAt: Date.now(),
    durationSec: 0,
    bytes: 0,
    pieces: 0,
    quality,
    state: 'recording',
    gaps: [],
    page: opts.page ?? null,
    transcript: null,
  };
  let stoppedResolve!: () => void;
  const l: Live = {
    rec,
    mr,
    stream,
    ctx: null,
    startedAt: Date.now(),
    pausedMs: 0,
    pauseAt: 0,
    seq: 0,
    saving: Promise.resolve(),
    lastAlive: 0,
    hiddenSinceAlive: false,
    timer: setInterval(() => tick(l), 500),
    stopped: new Promise<void>((r) => (stoppedResolve = r)),
  };
  live = l;
  markLive(rec.id);
  await putRecording(rec);

  mr.ondataavailable = (e) => {
    if (!e.data.size) return;
    const seq = l.seq++;
    l.rec.bytes += e.data.size;
    l.rec.pieces = l.seq;
    l.saving = l.saving
      .then(() => addChunk(rec.id, seq, e.data))
      .then(() => (seq % 5 === 4 ? saveDetails(l) : undefined))
      .catch((err) => {
        // Most likely the device is full. What's saved so far is kept.
        if (live === l) {
          showNotice(`The recording couldn’t be saved, so it was stopped: ${err instanceof Error ? err.message : String(err)}`, 'error');
          void stopRecording();
        }
      });
  };
  mr.onstop = () => stoppedResolve();
  // The mic taken away (unplugged, a phone call): what's there is kept.
  stream.getAudioTracks().forEach((t) =>
    t.addEventListener('ended', () => {
      if (live === l && get(recorder).phase !== 'stopping') {
        showNotice('The microphone stopped, so the recording was saved.', 'info');
        void stopRecording();
      }
    }),
  );
  mr.start(PIECE_MS);

  lastTouch = Date.now();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pointerdown', onTouch, true);
  window.addEventListener('keydown', onTouch, true);
  window.addEventListener('pagehide', onVisibility);
  stayAwake('recording');
  patch({ phase: 'recording', id: rec.id });
  void openMeter(l);
}

export function pauseRecording(): void {
  const l = live;
  if (!l || l.mr.state !== 'recording') return;
  l.mr.pause();
  l.pauseAt = Date.now();
  patch({ phase: 'paused', level: 0 });
  void saveDetails(l);
}

export function resumeRecording(): void {
  const l = live;
  if (!l || l.mr.state !== 'paused') return;
  l.mr.resume();
  l.pausedMs += Date.now() - l.pauseAt;
  l.pauseAt = 0;
  l.lastAlive = elapsedOf(l);
  l.hiddenSinceAlive = false;
  patch({ phase: 'recording' });
}

/** Stops and keeps the recording. Resolves to it once every piece is saved. */
export async function stopRecording(): Promise<Recording | null> {
  const l = live;
  if (!l || get(recorder).phase === 'stopping') return null;
  if (l.pauseAt) {
    l.pausedMs += Date.now() - l.pauseAt;
    l.pauseAt = 0;
  }
  patch({ phase: 'stopping', pocket: false });
  const end = elapsedOf(l);
  closeGap(l, end);
  try {
    if (l.mr.state !== 'inactive') l.mr.stop();
    else (l.mr.onstop as (() => void) | null)?.();
  } catch {
    // Already stopped.
  }
  // The last piece arrives just before the stop.
  await Promise.race([l.stopped, new Promise((r) => setTimeout(r, 3000))]);
  await l.saving;
  clearInterval(l.timer);
  l.stream.getTracks().forEach((t) => t.stop());
  void l.ctx?.close().catch(() => {});
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pointerdown', onTouch, true);
  window.removeEventListener('keydown', onTouch, true);
  window.removeEventListener('pagehide', onVisibility);
  allowSleep('recording');
  l.rec.state = 'done';
  l.rec.durationSec = end;
  live = null;
  markLive(null);
  untold = null;
  await putRecording({ ...l.rec }).catch(() => {});
  recorder.set(IDLE);
  return { ...l.rec };
}

/** Puts the pocket screen up, or takes it down. */
export function setPocket(on: boolean): void {
  if (!live) return;
  lastTouch = Date.now();
  patch({ pocket: on });
}
