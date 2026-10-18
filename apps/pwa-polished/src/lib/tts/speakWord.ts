/**
 * Saying one Greek or Hebrew word on its own, for anything outside the reader
 * that wants a speaker button — the Strong's entry, so far.
 *
 * The same steps the reader's ring takes for a tapped word: the shared audio
 * element, the voice and pronunciation from Settings, and the worker that says
 * the word inside a carrier and cuts it back out. Hebrew goes to its own voice
 * as sounds (hebrewSounds.ts), since espeak cannot read it.
 */

import {
  downloadVoice,
  getSharedTtsAudio,
  getVoiceInfo,
  greekSpeechRoute,
  isTtsSupported,
  isVoiceInstalled,
  synthesizeWordSpeech,
  synthesizeHebrewWordSpeech,
  unlockTtsAudio,
  HEBREW_VOICE_ID,
} from '../../adapters/tts';
import { speechWordText } from './originalText';
import { hebrewWordSounds } from './hebrewSounds';
import { FEATURES } from '../../config';

export type WordLanguage = 'greek' | 'hebrew';

/** Greek or Hebrew for a lexicon language; Aramaic is read as Hebrew. */
export function wordLanguage(language: string | undefined): WordLanguage | null {
  if (language === 'greek') return 'greek';
  if (language === 'hebrew' || language === 'aramaic') return 'hebrew';
  return null;
}

/**
 * Whether this device can say this word at all. A Hebrew headword with no
 * vowels to read — an unpointed root, a prefix fragment — has nothing to say.
 */
export function canSpeakWord(word: string, language: WordLanguage): boolean {
  if (!FEATURES.ttsReadAloud || !isTtsSupported()) return false;
  return language === 'greek' || hebrewWordSounds(word) !== null;
}

/** Call from inside the tap, before any await, or iOS refuses to play. */
export function readyWordAudio(): void {
  unlockTtsAudio();
}

function wordVoiceId(language: WordLanguage): string {
  return language === 'hebrew' ? HEBREW_VOICE_ID : greekSpeechRoute().voiceId;
}

export function wordVoiceInstalled(language: WordLanguage): Promise<boolean> {
  return isVoiceInstalled(wordVoiceId(language));
}

/** The voice's download size, for the offer to fetch it. */
export function wordVoiceSizeMB(language: WordLanguage): number {
  return getVoiceInfo(wordVoiceId(language))?.approxSizeMB ?? 60;
}

export function downloadWordVoice(
  language: WordLanguage,
  onPercent: (pct: number) => void,
): Promise<void> {
  return downloadVoice(wordVoiceId(language), (p) =>
    onPercent(p.total > 0 ? Math.round((100 * p.loaded) / p.total) : 0),
  );
}

/** The last word's clip, released when the next one replaces it. */
let lastUrl: string | null = null;

/** Say one word. Rejects when the word couldn't be said cleanly. */
export async function speakWord(word: string, language: WordLanguage): Promise<void> {
  let blob: Blob;
  if (language === 'hebrew') {
    const sounds = hebrewWordSounds(word ?? '');
    if (!sounds) return;
    blob = await synthesizeHebrewWordSpeech(sounds);
  } else {
    const text = speechWordText(word ?? '', 'greek');
    if (!text) return;
    const route = greekSpeechRoute();
    blob = await synthesizeWordSpeech(text, route.voiceId, {
      espeakVoice: route.espeakVoice,
      substitutions: route.substitutions,
    });
  }
  const audio = getSharedTtsAudio();
  audio.src = URL.createObjectURL(blob);
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = audio.src;
  audio.playbackRate = 1;
  await audio.play();
}
