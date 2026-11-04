/**
 * The mic in a By Heart game, opened and closed by the VC button
 * (lib/voice/holdToTalk.ts), with Whistle hearing it live. The screen stays awake
 * only while it is open. It closes by itself after about 20 seconds of silence,
 * and the game closes it when the verse ends, on the red X and on leaving the
 * app. Nothing it hears is kept, unless Your Own Voice was turned on.
 */

import { showNotice } from '../../stores/noticeStore';
import { allowSleep, stayAwake } from '../installAwake';
import { gameTalk, recordMicFailed, type GameMic } from '../voice/holdToTalk';
import { isBlocked, isNoMic, micTrouble } from '../voice/mic';
import type { TimedWord } from '../voice/engine';
import { LiveHearing, closeHearing, type HeardUpdate } from './hearing';

const AWAKE = 'by-heart-mic';
const SILENCE_CLOSE_MS = 20_000;
/** Louder than this is someone speaking, on the mic's 0-1 level. */
const SOUND_LEVEL = 0.12;
/** Audio goes to Whistle every quarter second, as fast as it can go. */
const HOP_MS = 250;

export interface GameHearing {
  /** The next words for the recognizer to favor. */
  keywords: () => string | null;
  /** Changes whenever anything was done, for noticing when nothing is. */
  progress: () => number;
  /** The mic is opening: a new stream, starting from nothing heard. */
  onTake: () => void;
  /** Whether the mic may open now. It stays closed while the app's own voice is speaking. */
  canOpen?: () => boolean;
  onUpdate: (update: HeardUpdate) => void;
  onPcm?: (pcm: Float32Array) => void;
}

export interface GameMicControl extends GameMic {
  /** Whether someone was speaking when the last take heard this word. */
  wasSpoken: (word: TimedWord) => boolean;
  /** When what the last take still held has been heard. */
  closed: () => Promise<void>;
  /** The game's over: let go of everything, without hearing what's left. */
  dispose: () => void;
}

export function createGameMic(o: GameHearing): GameMicControl {
  let take: LiveHearing | null = null;
  let last: LiveHearing | null = null;
  let closing: Promise<void> = Promise.resolve();
  let lastSound = 0;

  function letGo(): void {
    take = null;
    allowSleep(AWAKE);
    gameTalk.update((s) => s && { ...s, on: false, starting: false, level: 0 });
  }

  function close(): void {
    const t = take;
    if (!t) return;
    letGo();
    closing = closing.then(() => t.stop()).catch((error) => console.warn('[By Heart] closing the mic', error));
  }

  function open(): void {
    if (take || o.canOpen?.() === false) return;
    const t = new LiveHearing({
      hopMs: HOP_MS,
      keywords: o.keywords,
      progress: o.progress,
      onUpdate: o.onUpdate,
      onPcm: o.onPcm,
      onLevel: (level) => {
        if (take !== t) return;
        const now = performance.now();
        if (level > SOUND_LEVEL) lastSound = now;
        if (now - lastSound >= SILENCE_CLOSE_MS) {
          close();
          return;
        }
        gameTalk.update((s) => s && { ...s, level });
      },
    });
    take = t;
    last = t;
    lastSound = performance.now();
    stayAwake(AWAKE);
    gameTalk.update((s) => s && { ...s, on: true, starting: true, level: 0 });
    // After the last take has let go of Whistle, so the two streams don't run together.
    closing
      .then(() => {
        if (take !== t) return;
        o.onTake();
        return t.start();
      })
      .then(() => {
        if (take === t) gameTalk.update((s) => s && { ...s, starting: false });
      })
      .catch((err) => {
        if (take !== t) return;
        t.cancel();
        letGo();
        if (isBlocked(err) || isNoMic(err)) {
          if (!recordMicFailed(err)) showNotice(micTrouble(err), 'error');
        } else {
          console.warn('[By Heart] the mic or Whistle could not start', err);
          showNotice('Listening could not start. Try the mic button again.', 'error');
        }
      });
  }

  return {
    open,
    close,
    isOpen: () => take !== null,
    wasSpoken: (word) => last?.wasSpoken(word) ?? false,
    closed: () => closing,
    dispose: () => {
      const t = take;
      letGo();
      t?.cancel();
      closeHearing();
    },
  };
}
