/**
 * Hold to talk, for every mic button: the floating one (FloatingMic.svelte),
 * the search bar's (NavigationBar.svelte) and the try row in Settings. One
 * take at a time, as there is one mic.
 *
 * Before the mic opens, a press checks what it needs from what is already
 * known, so it is never kept waiting: Voice Control downloaded, a mic plugged
 * in, and the browser allowing it. Whatever is missing opens its card
 * (VoiceCard.svelte) in place of the mic. The first time, the app says what
 * the mic is for before the browser asks, and the asking comes from a tap on
 * that card rather than in the middle of a hold.
 *
 * The mic is open only while the button is held. Let go and it closes, and
 * what was said runs; slide off first and it is dropped.
 */

import { get, writable } from 'svelte/store';
import { getSettings, updateSettings } from '../../adapters/settings';
import { showNotice } from '../../stores/noticeStore';
import {
  VoiceTake,
  micTrouble,
  isBlocked,
  isNoMic,
  watchMicPermission,
  hasMic,
  askForMic,
  type MicPermission,
} from './mic';
import { VOICE_DOWNLOADS_EVENT, voiceInstalledHere, type VoiceDownloadId } from './voicePack';
import { hearCommand, voiceGesture, type VoiceOutcome } from './voiceControl';

// ── The floating button's switch, size and drag dots ────────────────────────

/** The floating mic button is on, on this device. */
export const micButtonOn = writable(getSettings().micButton === true);

export function setMicButtonOn(on: boolean): void {
  micButtonOn.set(on);
  updateSettings({ micButton: on });
}

export type MicButtonSize = 'small' | 'normal' | 'large';
export type MicButtonGrip = 'left' | 'right' | 'top' | 'bottom';

export const MIC_BUTTON_SIZES: { value: MicButtonSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
];

export const MIC_BUTTON_GRIPS: { value: MicButtonGrip; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];

/** How big the floating mic button is, on this device. */
export const micButtonSize = writable<MicButtonSize>(getSettings().micButtonSize ?? 'normal');

export function setMicButtonSize(size: MicButtonSize): void {
  micButtonSize.set(size);
  updateSettings({ micButtonSize: size });
}

/** Which side of the floating mic button its drag dots are on, on this device. */
export const micButtonGrip = writable<MicButtonGrip>(getSettings().micButtonGrip ?? 'left');

export function setMicButtonGrip(grip: MicButtonGrip): void {
  micButtonGrip.set(grip);
  updateSettings({ micButtonGrip: grip });
}

// ── What a press needs ──────────────────────────────────────────────────────

export interface VoiceReady {
  /** Voice Control's files are on this device. Null until looked. */
  installed: boolean | null;
  permission: MicPermission;
  /** A mic is plugged in. Null where the browser can't say. */
  mic: boolean | null;
}

export const voiceReady = writable<VoiceReady>({ installed: null, permission: 'unknown', mic: null });

const set = (patch: Partial<VoiceReady>) => voiceReady.update((r) => ({ ...r, ...patch }));

let watching = false;

/** Keep voiceReady up to date from here on. Safe to call more than once. */
export function watchVoiceReady(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const installed = async () => set({ installed: await voiceInstalledHere('voice-control').catch(() => false) });
  const mic = async () => set({ mic: await hasMic() });
  void installed();
  void mic();
  window.addEventListener(VOICE_DOWNLOADS_EVENT, () => void installed());
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void mic());
  void watchMicPermission((permission) => {
    set({ permission });
    // Allowed from the site settings: the card that said how is done.
    if (permission === 'granted' && get(voiceCard) === 'blocked') voiceCard.set(null);
  }).then((permission) => set({ permission }));
}

/** Where the mic was asked for before, for browsers that won't say whether it's allowed. */
const ASKED_KEY = 'projectbible_mic_asked';

function askedBefore(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

// ── The cards ───────────────────────────────────────────────────────────────

/**
 * What a press found missing: the download, the first ask, a blocked mic, no
 * mic. Or what Transcribe needs downloaded first.
 */
export type VoiceCardKind = 'download' | 'ask' | 'blocked' | 'nomic' | 'transcribe';

export const voiceCard = writable<VoiceCardKind | null>(null);

/** What the Transcribe card lists. */
export const cardDownloads = writable<VoiceDownloadId[]>([]);

/** The transcript waiting on the Transcribe card's downloads. */
let afterDownload: (() => void) | null = null;

/** Transcribe needs these downloaded first: the card for them, and `then` once they're in. */
export function openTranscribeCard(ids: VoiceDownloadId[], then: () => void): void {
  cardDownloads.set(ids);
  afterDownload = then;
  openCard('transcribe', 'record');
}

/** Everything the Transcribe card listed is downloaded: on with the transcript. */
export function transcribeDownloadsDone(): void {
  const then = afterDownload;
  afterDownload = null;
  voiceCard.set(null);
  then?.();
}

/** What the card is asking the mic for: a hold to talk, or a recording in Notes. */
export const micFor = writable<'talk' | 'record'>('talk');

/** A recording waiting on the ask card's Continue. */
let afterAllow: (() => void) | null = null;

function openCard(kind: VoiceCardKind, purpose: 'talk' | 'record', then: (() => void) | null = null): void {
  micFor.set(purpose);
  afterAllow = then;
  voiceCard.set(kind);
}

/** What stands in the way of a press, if anything. A recording doesn't need Voice Control downloaded. */
function blocker(needsDownload = true): VoiceCardKind | null {
  const r = get(voiceReady);
  if (needsDownload && r.installed === false) return 'download';
  if (r.mic === false) return 'nomic';
  if (r.permission === 'denied') return 'blocked';
  if (r.permission === 'prompt' || (r.permission === 'unknown' && !askedBefore())) return 'ask';
  return null;
}

/**
 * Record's tap: true when the mic can open now. Otherwise the card for what's
 * missing opens, and after the ask card's Continue `then` starts the recording.
 */
export function micReadyToRecord(then: () => void): boolean {
  watchVoiceReady();
  const stop = blocker(false);
  if (stop) openCard(stop, 'record', stop === 'ask' ? then : null);
  return !stop;
}

/** A recording's mic didn't open: the card for why, if there is one. True when a card opened. */
export function recordMicFailed(err: unknown): boolean {
  if (isBlocked(err)) {
    set({ permission: 'denied' });
    openCard('blocked', 'record');
    return true;
  }
  if (isNoMic(err)) {
    set({ mic: false });
    openCard('nomic', 'record');
    return true;
  }
  return false;
}

/** The ask card's Continue: the browser's own question, from a tap. */
export async function allowMic(): Promise<void> {
  try {
    await askForMic();
    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      // Private browsing: the card comes up again next time, that's all.
    }
    set({ permission: 'granted', mic: true });
    voiceCard.set(null);
    const then = afterAllow;
    afterAllow = null;
    if (then) then();
    else showNotice('The mic is ready. Hold the button while you speak.');
  } catch (err) {
    afterAllow = null;
    if (isNoMic(err)) {
      set({ mic: false });
      voiceCard.set('nomic');
      return;
    }
    if (isBlocked(err)) {
      // Closing the browser's question also comes back as "not allowed", but
      // leaves it to be asked again; only a real block needs the card.
      const now = await watchMicPermission();
      if (now === 'denied') {
        set({ permission: 'denied' });
        voiceCard.set('blocked');
      } else {
        voiceCard.set(null);
        showNotice('The browser didn’t get an answer. Tap the mic again to be asked again.');
      }
      return;
    }
    voiceCard.set(null);
    showNotice(micTrouble(err), 'error');
  }
}

// ── A take ──────────────────────────────────────────────────────────────────

/** Which button the take came from: each shows it its own way. */
export type TalkSource = 'float' | 'search' | 'settings';

export type TalkPhase =
  | 'idle'
  /** Held, the mic not open yet. */
  | 'starting'
  /** Held and hearing. */
  | 'listening'
  /** Let go: hearing it and carrying it out. */
  | 'working'
  /** Done: what was heard and done, or what went wrong, for a moment. */
  | 'shown';

export interface TalkState {
  phase: TalkPhase;
  source: TalkSource | null;
  /** The button held, for placing what it shows. */
  anchor: HTMLElement | null;
  /** The finger has slid off, so letting go cancels. */
  off: boolean;
  /** Loudness, 0–1. */
  level: number;
  /** A line on where it's got to, or what went wrong. */
  status: string;
  outcome: VoiceOutcome | null;
}

const IDLE: TalkState = { phase: 'idle', source: null, anchor: null, off: false, level: 0, status: '', outcome: null };

export const talk = writable<TalkState>({ ...IDLE });

const show = (patch: Partial<TalkState>) => talk.update((s) => ({ ...s, ...patch }));

let take: VoiceTake | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** How far off the button a finger can slide and still count as on it. */
const SLIDE_MARGIN = 28;

function hideIn(ms: number) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (get(talk).phase === 'shown') talk.set({ ...IDLE });
  }, ms);
}

/** Done: say how it went for a moment, or nothing at all. */
function end(status: string, outcome: VoiceOutcome | null = null) {
  if (!status && !outcome) {
    talk.set({ ...IDLE });
    return;
  }
  show({ phase: 'shown', status, outcome, level: 0, off: false });
  hideIn(outcome?.plan.kind === 'act' ? 5000 : 3000);
}

/** A take is under way: held, or being carried out. */
export const talkBusy = (s: TalkState) => s.phase === 'starting' || s.phase === 'listening' || s.phase === 'working';

/**
 * The press. Opens what is missing, or the mic. `pointerId` keeps the moves
 * coming to the button when the finger slides off it.
 */
export function startTalk(anchor: HTMLElement, source: TalkSource, pointerId?: number): void {
  if (talkBusy(get(talk))) return;
  const stop = blocker();
  if (stop) {
    openCard(stop, 'talk');
    return;
  }
  if (pointerId != null) {
    try {
      anchor.setPointerCapture(pointerId);
    } catch {
      // Fine without it.
    }
  }
  voiceGesture();
  if (hideTimer) clearTimeout(hideTimer);
  const t = new VoiceTake();
  take = t;
  talk.set({ ...IDLE, phase: 'starting', source, anchor, status: 'Starting the mic…' });
  t.start({
    onLevel: (level) => {
      if (take === t) show({ level });
    },
    onFull: () => void releaseTalk(),
  })
    .then(() => {
      if (take !== t) return;
      show({ phase: 'listening', status: get(talk).off ? 'Let go to cancel' : 'Listening… slide off to cancel' });
    })
    .catch((err) => {
      if (take !== t) return;
      take = null;
      t.cancel();
      if (isBlocked(err)) {
        set({ permission: 'denied' });
        openCard('blocked', 'talk');
        end('');
      } else if (isNoMic(err)) {
        set({ mic: false });
        openCard('nomic', 'talk');
        end('');
      } else {
        end(micTrouble(err));
      }
    });
}

/** A press on a button, for its on:pointerdown. */
export function pressToTalk(e: PointerEvent, source: TalkSource): void {
  if (e.button > 0) return;
  e.preventDefault();
  startTalk(e.currentTarget as HTMLElement, source, e.pointerId);
}

/** The finger moving: off the button, letting go cancels. */
export function moveTalk(e: PointerEvent): void {
  const s = get(talk);
  if (!take || !s.anchor || (s.phase !== 'starting' && s.phase !== 'listening')) return;
  const r = s.anchor.getBoundingClientRect();
  const m = SLIDE_MARGIN;
  const off = e.clientX < r.left - m || e.clientX > r.right + m || e.clientY < r.top - m || e.clientY > r.bottom + m;
  if (off === s.off) return;
  show({
    off,
    status: off ? 'Let go to cancel' : s.phase === 'listening' ? 'Listening… slide off to cancel' : 'Starting the mic…',
  });
}

/** Let go: the mic closes, and what was said runs. */
export async function releaseTalk(): Promise<void> {
  const s = get(talk);
  if (!take || (s.phase !== 'starting' && s.phase !== 'listening')) return;
  const t = take;
  take = null;
  if (s.off) {
    t.cancel();
    end('Cancelled.');
    return;
  }
  show({ phase: 'working', level: 0, status: 'Working…' });
  const pcm = await t.finish();
  if (!pcm) {
    end(s.phase === 'starting'
      ? 'Let go before the mic was ready. Hold until it says Listening.'
      : 'Too short. Hold the button the whole time you speak.');
    return;
  }
  try {
    // From the search bar, what isn't a command is searched for.
    const outcome = await hearCommand(pcm, { orSearch: s.source === 'search' });
    end('', outcome);
  } catch (error) {
    end(error instanceof Error ? error.message : String(error));
  }
}

/** The press was taken away (a scroll, a call): drop what was heard. */
export function cancelTalk(): void {
  if (!take) return;
  take.cancel();
  take = null;
  end('Cancelled.');
}

/** Put away what a finished take is showing. */
export function dismissTalk(): void {
  if (get(talk).phase !== 'shown') return;
  if (hideTimer) clearTimeout(hideTimer);
  talk.set({ ...IDLE });
}
