/**
 * The mic in a By Heart game, opened and closed by the VC button
 * (lib/voice/holdToTalk.ts). The screen stays awake only while it is open. It
 * closes by itself after about 20 seconds of silence, and the game closes it
 * when the verse ends, on the red X and on leaving the app. Nothing it hears is
 * kept.
 */

import { showNotice } from '../../stores/noticeStore';
import { allowSleep, stayAwake } from '../installAwake';
import { gameTalk, recordMicFailed, type GameMic } from '../voice/holdToTalk';
import { VoiceTake, micTrouble } from '../voice/mic';

const AWAKE = 'by-heart-mic';
const SILENCE_CLOSE_MS = 20_000;
/** Louder than this is someone speaking, on the mic's 0-1 level. */
const SOUND_LEVEL = 0.12;

export function createGameMic(): GameMic {
  let take: VoiceTake | null = null;
  let lastSound = 0;

  function close(): void {
    take?.cancel();
    take = null;
    allowSleep(AWAKE);
    gameTalk.update((s) => s && { on: false, starting: false, level: 0 });
  }

  function open(): void {
    if (take) return;
    const t = new VoiceTake();
    take = t;
    lastSound = performance.now();
    stayAwake(AWAKE);
    gameTalk.update((s) => s && { on: true, starting: true, level: 0 });
    t.start({
      onAudio: () => {},
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
    })
      .then(() => {
        if (take === t) gameTalk.update((s) => s && { ...s, starting: false });
      })
      .catch((err) => {
        if (take !== t) return;
        close();
        if (!recordMicFailed(err)) showNotice(micTrouble(err), 'error');
      });
  }

  return { open, close, isOpen: () => take !== null };
}
