/**
 * Your Own Voice: off by default, and the app explains it and asks first. With it
 * on, the best recital of each verse is kept so it can be listened back to. It
 * stays on this device, in by_heart_voice: never synced, not in the backup file,
 * and gone on sign-out, along with this switch.
 *
 * With it off, audio is only held until Whistle has heard it.
 */

import type { GameMode } from './game';

/** Cleared on sign-out (clearPersonalData.ts), so the next account is asked for itself. */
export const OWN_VOICE_KEY = 'projectbible_byheart_own_voice';

const RATE = 16000;
/** Longer than this isn't kept, as it would hold too much of a phone's memory. */
const LONGEST_SECONDS = 300;

export function ownVoiceOn(): boolean {
  try {
    return localStorage.getItem(OWN_VOICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setOwnVoice(on: boolean): void {
  try {
    if (on) localStorage.setItem(OWN_VOICE_KEY, '1');
    else localStorage.removeItem(OWN_VOICE_KEY);
  } catch {
    // Blocked storage: it stays off, and nothing is kept.
  }
}

/** The ways of playing that say a whole verse from memory. */
export const keepsVoice = (mode: GameMode): boolean => mode === 'focus' || mode === 'recital' || mode === 'flashcards' || mode === 'call';

/** One round's audio, held until its score says whether to keep it. */
export class VoiceKeeper {
  private parts: Float32Array[] = [];
  private length = 0;

  add(pcm: Float32Array): void {
    if (this.length > RATE * LONGEST_SECONDS) return;
    this.parts.push(pcm.slice());
    this.length += pcm.length;
  }

  get empty(): boolean {
    return this.length === 0;
  }

  /** All of it as a 16-bit WAV file, or null if it ran too long to keep. */
  toWav(): Blob | null {
    if (this.length > RATE * LONGEST_SECONDS) return null;
    const bytes = this.length * 2;
    const view = new DataView(new ArrayBuffer(44 + bytes));
    const text = (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + bytes, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, RATE, true);
    view.setUint32(28, RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, bytes, true);
    let at = 44;
    for (const part of this.parts) {
      for (let i = 0; i < part.length; i++) {
        const s = Math.max(-1, Math.min(1, part[i]));
        view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        at += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }
}
