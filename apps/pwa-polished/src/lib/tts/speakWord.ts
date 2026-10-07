/**
 * Saying one Greek word on its own, for anything outside the reader that
 * wants a speaker button — the Strong's entry, so far.
 *
 * The same steps the reader's ring takes for a tapped word: the shared audio
 * element, the voice and pronunciation from Settings, and the worker that says
 * the word inside a carrier and cuts it back out. Hebrew has no voice, so
 * there is nothing here for it.
 */

import {
  downloadVoice,
  getSharedTtsAudio,
  getVoiceInfo,
  greekSpeechRoute,
  isTtsSupported,
  isVoiceInstalled,
  synthesizeWordSpeech,
  unlockTtsAudio,
} from '../../adapters/tts';
import { speechWordText } from './originalText';
import { FEATURES } from '../../config';

/** Whether this device can say a Greek word at all. */
export function canSpeakGreek(): boolean {
  return FEATURES.ttsReadAloud && isTtsSupported();
}

/** Call from inside the tap, before any await, or iOS refuses to play. */
export function readyWordAudio(): void {
  unlockTtsAudio();
}

export function greekVoiceInstalled(): Promise<boolean> {
  return isVoiceInstalled(greekSpeechRoute().voiceId);
}

/** The Greek voice's download size, for the offer to fetch it. */
export function greekVoiceSizeMB(): number {
  return getVoiceInfo(greekSpeechRoute().voiceId)?.approxSizeMB ?? 60;
}

export function downloadGreekVoice(onPercent: (pct: number) => void): Promise<void> {
  return downloadVoice(greekSpeechRoute().voiceId, (p) =>
    onPercent(p.total > 0 ? Math.round((100 * p.loaded) / p.total) : 0),
  );
}

/** The last word's clip, released when the next one replaces it. */
let lastUrl: string | null = null;

/** Say one Greek word. Rejects when the word couldn't be said cleanly. */
export async function speakGreekWord(word: string): Promise<void> {
  const text = speechWordText(word ?? '', 'greek');
  if (!text) return;
  const route = greekSpeechRoute();
  const blob = await synthesizeWordSpeech(text, route.voiceId, {
    espeakVoice: route.espeakVoice,
    substitutions: route.substitutions,
  });
  const audio = getSharedTtsAudio();
  audio.src = URL.createObjectURL(blob);
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = audio.src;
  audio.playbackRate = 1;
  await audio.play();
}
