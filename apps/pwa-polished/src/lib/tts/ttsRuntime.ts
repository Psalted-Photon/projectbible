/**
 * Machinery both speech engines need: on-device file storage, downloading with
 * progress, starting onnxruntime, and writing a WAV.
 *
 * Lifted out of piperEngine.ts unchanged when Kokoro arrived, so the two engines
 * share one copy rather than drifting apart. Nothing here knows which engine is
 * calling it.
 *
 * Runs inside ttsWorker.ts — do not import from the main thread.
 */

import * as ort from 'onnxruntime-web';
import type { TtsProgressCallback } from './voices.js';

/** Where the runtime .wasm/.mjs files are served from (see copyTtsRuntime in vite.config.ts). */
export const ASSET_BASE = '/tts';

// ─── on-device storage ──────────────────────────────────────────────────────
// Each engine gets its own folder. Piper keeps one self-contained file per
// voice; Kokoro keeps one shared model plus a small style vector each, so
// mixing them in a single folder would make "which voices are installed?"
// ambiguous.

export function opfsFolder(dirName: string) {
  async function dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(dirName, { create: true });
  }

  return {
    async read(name: string): Promise<File | undefined> {
      try {
        const handle = await (await dir()).getFileHandle(name);
        return await handle.getFile();
      } catch {
        return undefined;
      }
    },

    async write(name: string, data: Blob | ArrayBuffer): Promise<void> {
      const handle = await (await dir()).getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },

    async remove(name: string): Promise<void> {
      try {
        await (await dir()).removeEntry(name);
      } catch {
        // already gone
      }
    },

    /** Every filename in the folder. Empty when storage is unavailable. */
    async list(): Promise<string[]> {
      const found: string[] = [];
      try {
        const handle = await dir();
        for await (const name of (handle as any).keys()) {
          if (typeof name === 'string') found.push(name);
        }
      } catch {
        // storage unavailable → nothing installed
      }
      return found;
    },
  };
}

// ─── downloading ────────────────────────────────────────────────────────────

export async function fetchWithProgress(
  url: string,
  onProgress?: TtsProgressCallback
): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const total = +(response.headers.get('Content-Length') ?? 0);
  const reader = response.body?.getReader();
  if (!reader) return response.blob();

  let loaded = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }
  return new Blob(chunks, { type: response.headers.get('Content-Type') ?? undefined });
}

// ─── onnxruntime ────────────────────────────────────────────────────────────

let ortConfigured = false;

export function configureOrt(): void {
  if (ortConfigured) return;
  // Single-threaded on purpose: the app is not cross-origin isolated, and a
  // deterministic single .wasm keeps the offline cache small and predictable.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = `${ASSET_BASE}/`;
  ortConfigured = true;
}

// ─── audio ──────────────────────────────────────────────────────────────────

/**
 * Mono 16-bit PCM WAV from float samples.
 *
 * stitchAudio.ts assumes exactly this layout — a 44-byte header and nothing
 * else — so it can join clips by dropping headers and concatenating, without
 * decoding. Changing the header here breaks joining silently.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const headerBytes = 44;
  const view = new DataView(new ArrayBuffer(samples.length * 2 + headerBytes));
  view.setUint32(0, 0x46464952, true); // "RIFF"
  view.setUint32(4, view.buffer.byteLength - 8, true);
  view.setUint32(8, 0x45564157, true); // "WAVE"
  view.setUint32(12, 0x20746d66, true); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true); // "data"
  view.setUint32(40, samples.length * 2, true);
  let offset = headerBytes;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return view.buffer;
}

/** Loudest sample in a clip. Zero means the model returned silence. */
export function peakAmplitude(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] < 0 ? -samples[i] : samples[i];
    if (v > peak) peak = v;
  }
  return peak;
}
