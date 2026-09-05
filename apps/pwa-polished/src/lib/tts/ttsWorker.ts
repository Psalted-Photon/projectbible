/**
 * TTS worker — hosts the speech engines off the main thread so synthesis
 * never janks the reader UI. Message protocol mirrors SQLiteWorkerPool:
 * id-correlated request/response plus unsolicited progress events.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error, code? }
 * Progress:  { id, progress: { loaded, total } }
 *
 * Two engines live behind this one protocol. Which to use travels in the
 * payload rather than being looked up here, because custom voices are only
 * known to the main thread (they live in localStorage) — the same reason
 * `source` is passed in rather than resolved here.
 */

import * as piper from './piperEngine.js';
import * as kokoro from './kokoroEngine.js';
import { TtsError, type TtsEngine, type TtsSource } from './voices.js';

interface TtsRequest {
  id: number;
  action:
    | 'download'
    | 'installData'
    | 'remove'
    | 'stored'
    | 'installed'
    | 'synthesize'
    | 'synthesizeWord'
    | 'hasKokoroModel'
    | 'removeKokoroModel'
    | 'kokoroBackend'
    | 'probeGraphicsChip';
  payload?: {
    voiceId?: string;
    text?: string;
    source?: TtsSource;
    model?: ArrayBuffer;
    config?: ArrayBuffer;
    /** Which engine owns this voice. Absent means Piper. */
    engine?: TtsEngine;
    /** Piper: overrides the voice's own espeak language (Greek pronunciation). */
    espeakVoice?: string;
    substitutions?: Record<string, string>;
    /** Kokoro: the voice's espeak language, since it has no config file of its own. */
    phonemeVoice?: string;
  };
}

self.onmessage = async (event: MessageEvent<TtsRequest>) => {
  const { id, action, payload } = event.data;
  const engine: TtsEngine = payload?.engine ?? 'piper';
  const isKokoro = engine === 'kokoro';

  try {
    switch (action) {
      case 'download': {
        const onProgress = (progress: { loaded: number; total: number }) =>
          self.postMessage({ id, progress });
        if (isKokoro) {
          await kokoro.downloadVoice(payload!.voiceId!, payload!.source, onProgress);
        } else {
          await piper.downloadVoice(payload!.voiceId!, payload!.source, onProgress);
        }
        self.postMessage({ id, ok: true, result: null });
        break;
      }

      case 'installData': {
        // Installing from a picked file is Piper-only: a Kokoro voice is a style
        // vector for a model it does not ship with, so a lone file means nothing.
        if (isKokoro) throw new TtsError('UNKNOWN_VOICE', 'Kokoro voices cannot be installed from a file');
        await piper.installVoiceData(payload!.voiceId!, payload!.model!, payload!.config!);
        self.postMessage({ id, ok: true, result: null });
        break;
      }

      case 'remove': {
        if (isKokoro) await kokoro.removeVoice(payload!.voiceId!);
        else await piper.removeVoice(payload!.voiceId!);
        self.postMessage({ id, ok: true, result: null });
        break;
      }

      case 'stored': {
        // Both engines, since the caller wants everything installed, not one kind.
        const [p, k] = await Promise.all([piper.storedVoices(), kokoro.storedVoices()]);
        self.postMessage({ id, ok: true, result: [...p, ...k] });
        break;
      }

      case 'installed': {
        const installed = isKokoro
          ? await kokoro.isVoiceInstalled(payload!.voiceId!)
          : await piper.isVoiceInstalled(payload!.voiceId!);
        self.postMessage({ id, ok: true, result: installed });
        break;
      }

      case 'hasKokoroModel': {
        self.postMessage({ id, ok: true, result: await kokoro.hasSharedModel() });
        break;
      }

      case 'kokoroBackend': {
        // Which chip the engine actually ended up on. The engine knows, but it
        // only ever said so in a console warning from inside this worker, which
        // neither eruda nor a default DevTools console shows — so a silent drop
        // to the processor looked like an unexplained stall.
        self.postMessage({ id, ok: true, result: kokoro.backend() });
        break;
      }

      case 'probeGraphicsChip': {
        self.postMessage({ id, ok: true, result: await kokoro.canRunOnGraphicsChip() });
        break;
      }

      case 'removeKokoroModel': {
        await kokoro.removeSharedModel();
        self.postMessage({ id, ok: true, result: null });
        break;
      }

      case 'synthesizeWord': {
        // Tapping a word is a Greek feature and stays on Piper. Kokoro has no
        // Greek voice, and the carrier-and-cut trick is tuned to Piper's output.
        if (isKokoro) throw new TtsError('UNKNOWN_VOICE', 'Single words are spoken by Piper only');
        const clip = await piper.synthesizeWord(payload!.text!, payload!.voiceId!, {
          espeakVoice: payload!.espeakVoice,
          substitutions: payload!.substitutions,
        });
        (self as unknown as Worker).postMessage({ id, ok: true, result: clip }, [clip]);
        break;
      }

      case 'synthesize': {
        const wav = isKokoro
          ? await kokoro.synthesize(payload!.text!, payload!.voiceId!, payload!.phonemeVoice!)
          : await piper.synthesize(payload!.text!, payload!.voiceId!, {
              espeakVoice: payload!.espeakVoice,
              substitutions: payload!.substitutions,
            });
        (self as unknown as Worker).postMessage({ id, ok: true, result: wav }, [wav]);
        break;
      }

      default:
        self.postMessage({ id, ok: false, error: `Unknown TTS action: ${action satisfies never}` });
    }
  } catch (err: any) {
    // Describe the failure properly rather than trusting it to have a message.
    // `?? ` only falls through on null/undefined, so an Error with an empty
    // message used to arrive as '' and print as a bare `Error {}` - which is
    // what a mismatched emscripten runtime throws, and exactly when the detail
    // matters most. onnxruntime also throws plain strings and numbers.
    let error: string;
    if (err instanceof Error) {
      error = `${err.name || 'Error'}: ${err.message || '(no message)'}`;
    } else if (typeof err === 'object' && err !== null) {
      error = (err.message && String(err.message)) || JSON.stringify(err) || String(err);
    } else {
      error = String(err);
    }
    self.postMessage({
      id,
      ok: false,
      error,
      stack: err instanceof Error ? err.stack : undefined,
      code: err instanceof TtsError ? err.code : undefined,
    });
  }
};
