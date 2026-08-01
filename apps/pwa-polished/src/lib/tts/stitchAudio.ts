/**
 * Joining generated speech into one continuous piece of audio.
 *
 * Handing the player a new file every few seconds is what made locked-screen
 * playback fragile: assigning a new `src` unloads the current media and loads
 * different media from scratch, so the phone's media session — and the work
 * JavaScript has to do to keep things moving — restarts constantly. Stitching a
 * run of verses into one longer piece means JavaScript wakes roughly once a
 * minute instead of once a verse, which is the whole point.
 *
 * Everything here is a memory copy. There is no decoding, no re-encoding and no
 * measurable cost: the generator already emits mono 16-bit PCM at one sample
 * rate (see encodeWav in piperEngine.ts), so joining is a matter of dropping
 * each header, concatenating the samples, and writing one new header.
 */

/** Standard PCM WAV header written by the voice generator. */
const HEADER_BYTES = 44;

const BYTES_PER_SAMPLE = 2; // mono 16-bit

export interface WavInfo {
  sampleRate: number;
  /** Sample data only, header excluded. */
  pcm: Uint8Array;
  seconds: number;
}

/** Read a generated WAV without decoding it. Throws if it is not what we expect. */
export function readWav(buffer: ArrayBuffer): WavInfo {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error('Audio is too short to be a WAV file');
  }
  const view = new DataView(buffer);
  const sampleRate = view.getUint32(24, true);
  if (!sampleRate) throw new Error('Audio has no sample rate');

  const pcm = new Uint8Array(buffer, HEADER_BYTES);
  return {
    sampleRate,
    pcm,
    seconds: pcm.byteLength / (sampleRate * BYTES_PER_SAMPLE),
  };
}

/** Silence, as real samples, so a pause is audio rather than nothing playing. */
export function silencePcm(seconds: number, sampleRate: number): Uint8Array {
  const samples = Math.max(0, Math.round(seconds * sampleRate));
  // Zero-filled: 16-bit signed silence is literally zeroes.
  return new Uint8Array(samples * BYTES_PER_SAMPLE);
}

function writeHeader(view: DataView, pcmBytes: number, sampleRate: number): void {
  view.setUint32(0, 0x46464952, true);            // "RIFF"
  view.setUint32(4, pcmBytes + HEADER_BYTES - 8, true);
  view.setUint32(8, 0x45564157, true);            // "WAVE"
  view.setUint32(12, 0x20746d66, true);           // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                    // PCM
  view.setUint16(22, 1, true);                    // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true);           // "data"
  view.setUint32(40, pcmBytes, true);
}

/** One WAV blob from a run of PCM pieces. */
export function joinPcm(pieces: Uint8Array[], sampleRate: number): Blob {
  let pcmBytes = 0;
  for (const piece of pieces) pcmBytes += piece.byteLength;

  const out = new Uint8Array(HEADER_BYTES + pcmBytes);
  writeHeader(new DataView(out.buffer), pcmBytes, sampleRate);

  let offset = HEADER_BYTES;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.byteLength;
  }

  return new Blob([out], { type: 'audio/wav' });
}

/** Seconds of audio represented by a run of PCM pieces. */
export function pcmSeconds(pieces: Uint8Array[], sampleRate: number): number {
  let bytes = 0;
  for (const piece of pieces) bytes += piece.byteLength;
  return bytes / (sampleRate * BYTES_PER_SAMPLE);
}
