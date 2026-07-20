/**
 * TTS worker — hosts the Piper engine off the main thread so synthesis
 * never janks the reader UI. Message protocol mirrors SQLiteWorkerPool:
 * id-correlated request/response plus unsolicited progress events.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error, code? }
 * Progress:  { id, progress: { loaded, total } }
 */

import {
  downloadVoice,
  installVoiceData,
  removeVoice,
  storedVoices,
  isVoiceInstalled,
  synthesize,
} from './piperEngine.js';
import { TtsError, type TtsSource } from './voices.js';

interface TtsRequest {
  id: number;
  action: 'download' | 'installData' | 'remove' | 'stored' | 'installed' | 'synthesize';
  payload?: {
    voiceId?: string;
    text?: string;
    source?: TtsSource;
    model?: ArrayBuffer;
    config?: ArrayBuffer;
  };
}

self.onmessage = async (event: MessageEvent<TtsRequest>) => {
  const { id, action, payload } = event.data;
  try {
    switch (action) {
      case 'download': {
        await downloadVoice(payload!.voiceId!, payload!.source, (progress) => {
          self.postMessage({ id, progress });
        });
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'installData': {
        await installVoiceData(payload!.voiceId!, payload!.model!, payload!.config!);
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'remove': {
        await removeVoice(payload!.voiceId!);
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'stored': {
        self.postMessage({ id, ok: true, result: await storedVoices() });
        break;
      }
      case 'installed': {
        self.postMessage({ id, ok: true, result: await isVoiceInstalled(payload!.voiceId!) });
        break;
      }
      case 'synthesize': {
        const wav = await synthesize(payload!.text!, payload!.voiceId!);
        (self as unknown as Worker).postMessage({ id, ok: true, result: wav }, [wav]);
        break;
      }
      default:
        self.postMessage({ id, ok: false, error: `Unknown TTS action: ${action satisfies never}` });
    }
  } catch (err: any) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message ?? String(err),
      code: err instanceof TtsError ? err.code : undefined,
    });
  }
};
