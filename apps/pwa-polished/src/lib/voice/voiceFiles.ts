/**
 * Reading Voice Control's model files, for the workers that run them
 * (voiceWorker, transcribeWorker, By Heart's hearingWorker).
 *
 * On the web they are in the folder voicePack.ts downloads them to, in the
 * browser's private file storage. The Android app carries them inside it,
 * beside its packs, so there they are read from there and never copied.
 */

import { IS_ANDROID_APP, INCLUDED_PACKS } from '../platform';

/** The folder in the browser's file storage that voicePack.ts writes to. */
export const VOICE_FOLDER = 'voice-control';

/** One model file's bytes. Throws when it isn't on this device. */
export async function readVoiceFile(name: string): Promise<Uint8Array> {
  if (IS_ANDROID_APP) {
    const response = await fetch(`${INCLUDED_PACKS}/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(`${name} is not inside the app (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(VOICE_FOLDER);
  const file = await (await dir.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}
