/**
 * By Heart's worker: Whistle alone, hearing a recital as it is said. Its own
 * engine, apart from Voice Control's commands (voiceWorker.ts), so it needs no
 * Needle and a game never waits behind a command.
 *
 * Reads the files voicePack.ts downloaded for Voice Control.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error }
 */

import { NeedleEngine } from '../voice/engine';

const FOLDER = 'voice-control';
const FILES = { js: 'voice-needle.js', wasm: 'voice-needle.wasm', whistle: 'voice-whistle.cact' };

async function readFile(name: string): Promise<Uint8Array> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(FOLDER);
  const file = await (await dir.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

let eng: NeedleEngine | null = null;

async function load(): Promise<void> {
  const [js, wasm] = await Promise.all([readFile(FILES.js), readFile(FILES.wasm)]);
  const createNeedle = new Function(new TextDecoder().decode(js) + '\nreturn createNeedle;')();
  const engine = await NeedleEngine.create(createNeedle, wasm);
  engine.load(await readFile(FILES.whistle));
  eng = engine;
}

function ready(): NeedleEngine {
  if (!eng) throw new Error('Hearing is not loaded');
  return eng;
}

self.onmessage = async (e: MessageEvent<{ id: number; action: string; payload?: any }>) => {
  const { id, action, payload } = e.data;
  try {
    let result: unknown = null;
    switch (action) {
      case 'load':
        if (!eng) await load();
        break;
      case 'feed':
        result = ready().streamFeed(payload.pcm, payload.keywords);
        break;
      case 'stop':
        result = ready().streamStop();
        break;
      default:
        throw new Error('Unknown action ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
