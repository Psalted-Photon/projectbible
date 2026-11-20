/**
 * Sharing and saving in the Android app.
 *
 * The web view inside the app has no share sheet and ignores downloads, so
 * the IrisFiles plugin (IrisFilesPlugin.java) does both: Android's own share
 * sheet, pictures straight into Pictures/irisBible, and Android's "Save to"
 * screen for every other file.
 *
 * Reached only through lib/clipboard.ts, lib/backup/saveFile.ts and
 * lib/recorder/recordings.ts, each behind IS_ANDROID_APP.
 */

import { callNative } from './bridge';

/** A file's contents as base64, the only way the bridge carries bytes. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** The plain type Android matches apps by: "audio/webm;codecs=opus" becomes "audio/webm". */
function plainType(file: File): string {
  return file.type.split(';')[0].trim() || 'application/octet-stream';
}

/** Opens Android's share sheet with text. False when it was closed without picking an app. */
export async function appShareText(text: string): Promise<boolean> {
  const { shared } = await callNative<{ shared: boolean }>('IrisFiles', 'share', { text });
  return shared;
}

/** Opens Android's share sheet with one file. False when it was closed without picking an app. */
export async function appShareFile(file: File): Promise<boolean> {
  const { shared } = await callNative<{ shared: boolean }>('IrisFiles', 'share', {
    name: file.name,
    mimeType: plainType(file),
    data: await toBase64(file),
  });
  return shared;
}

/**
 * Saves a file on the phone. A picture goes straight into Pictures/irisBible;
 * anything else opens "Save to", and 'cancelled' means it was closed there.
 */
export async function appSaveFile(file: File): Promise<'saved' | 'cancelled'> {
  const { saved } = await callNative<{ saved: boolean }>('IrisFiles', 'save', {
    name: file.name,
    mimeType: plainType(file),
    data: await toBase64(file),
  });
  return saved ? 'saved' : 'cancelled';
}
