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

/**
 * Inference runs strictly one at a time.
 *
 * onnxruntime keeps a single "a run is in progress" marker per WASM module,
 * shared by every session it owns, and throws `Session already started` if a
 * second run begins before the first has finished.
 *
 * On one thread that could never happen. The WASM call blocks this worker's
 * only thread, so the next message could not even be read until the run was
 * over — the ordering came for free and nothing here had to ask for it. Several
 * threads hand the work off and leave this thread free to take the next
 * message, so two clips arriving close together genuinely overlap and the
 * second one throws.
 *
 * So this is not a threading bug: it is a missing queue that single-threading
 * had been hiding. Requests still arrive in whatever order the reader sends
 * them; they simply wait their turn here.
 */
let inferenceTail: Promise<unknown> = Promise.resolve();

function queueInference<T>(work: () => Promise<T>): Promise<T> {
  // Chained onto both outcomes: one failed clip must not wedge the queue for
  // the rest of the session.
  const run = inferenceTail.then(work, work);
  // The tail deliberately swallows the result, so a rejection here is never an
  // unhandled one, and finished clips are not kept alive by the chain.
  inferenceTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
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
        // Queued with the rest: probing runs a real clip through the model, so
        // it collides with a reader already speaking exactly like any other run.
        const usable = await queueInference(() => kokoro.canRunOnGraphicsChip());
        self.postMessage({ id, ok: true, result: usable });
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
        const clip = await queueInference(() =>
          piper.synthesizeWord(payload!.text!, payload!.voiceId!, {
            espeakVoice: payload!.espeakVoice,
            substitutions: payload!.substitutions,
          })
        );
        (self as unknown as Worker).postMessage({ id, ok: true, result: clip }, [clip]);
        break;
      }

      case 'synthesize': {
        const wav = await queueInference(() =>
          isKokoro
            ? kokoro.synthesize(payload!.text!, payload!.voiceId!, payload!.phonemeVoice!)
            : piper.synthesize(payload!.text!, payload!.voiceId!, {
                espeakVoice: payload!.espeakVoice,
                substitutions: payload!.substitutions,
              })
        );
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
