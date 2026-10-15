/**
 * The voice check every Read Aloud start button makes before it hands off to
 * the engine: which voice this tap reads with, and whether it is on the device.
 *
 * Shared by the chapter's talking head (TtsPlayer) and the plain-text button
 * (ReadAloudTextButton), so both offer the same voice and the same download.
 */
import {
  isVoiceInstalled,
  downloadVoice,
  greekSpeechRoute,
  voiceToOffer,
  isVoiceDownloading,
  adoptVoice,
} from '../../adapters/tts.js';
import { getTtsSettings } from '../../adapters/settings.js';

export interface VoiceCheck {
  voiceId: string;
  /** 'downloading': the first-launch download is already bringing it in. */
  status: 'ready' | 'needed' | 'downloading';
}

/**
 * Read fresh on each tap: the saved voice can change behind the button
 * (Settings, or the first-launch download finishing). For English that can be
 * Heart rather than the saved voice on a device with no voices yet — see
 * voiceToOffer. Greek always needs its own voice, so it is never swapped.
 */
export async function voiceForTap(greek = false): Promise<VoiceCheck> {
  const voiceId = greek
    ? greekSpeechRoute().voiceId
    : await voiceToOffer(getTtsSettings().voiceId);
  if (await isVoiceInstalled(voiceId)) return { voiceId, status: 'ready' };
  return { voiceId, status: isVoiceDownloading(voiceId) ? 'downloading' : 'needed' };
}

/** Download the voice, reporting whole percents. Throws if it fails. */
export async function fetchVoice(voiceId: string, onPct: (pct: number) => void): Promise<void> {
  await downloadVoice(voiceId, (p) => {
    onPct(p.total > 0 ? Math.round((100 * p.loaded) / p.total) : 0);
  });
}

/** Make the offered voice the saved one, so the engine reads with it. */
export function useVoice(voiceId: string, greek = false): void {
  if (!greek) adoptVoice(voiceId);
}
