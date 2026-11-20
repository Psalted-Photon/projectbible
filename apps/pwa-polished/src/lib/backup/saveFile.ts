/**
 * Handing a file to the person: the share sheet on a phone (Save to Files,
 * Drive, email), a normal download everywhere else.
 *
 * In the Android app neither exists in the web view, so lib/android/files.ts
 * stands in: pictures go straight into Pictures/irisBible, any other file
 * opens Android's "Save to" screen, and sharing opens Android's share sheet.
 */

import { isPhoneOrTablet } from '../device';
import { IS_ANDROID_APP } from '../platform';
import { appSaveFile, appShareFile } from '../android/files';
import { showNotice, errorText } from '../../stores/noticeStore';

export type SaveResult = 'shared' | 'saved' | 'downloaded' | 'cancelled';

/** A plain browser download, with no share sheet. The share card's Save uses it directly. */
export function download(file: File): void {
  if (IS_ANDROID_APP) {
    appSaveFile(file).catch((err) => showNotice(errorText(err), 'error'));
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freeing the file straight after the click can cancel the download in
  // some browsers (older Safari especially), so give it a moment.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Call straight from a tap: the share sheet refuses to open otherwise. */
export async function saveFile(file: File): Promise<SaveResult> {
  if (IS_ANDROID_APP) return appSaveFile(file);

  const canShareFile =
    isPhoneOrTablet() &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFile) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      // Closing the share sheet isn't a failure.
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
      console.warn('[Backup] Share sheet failed, downloading instead:', err);
    }
  }

  download(file);
  return 'downloaded';
}

/**
 * Whether the share sheet can take an image file. Probed with a real image
 * type, once, by the share card and the Connections picture. The app always can.
 */
export function canShareImages(): boolean {
  if (IS_ANDROID_APP) return true;
  try {
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [probe] })
    );
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with one file. Call straight from a tap. Rejects with
 * an AbortError when the sheet is closed without picking anything, the same
 * as navigator.share, so callers can tell that apart from a failure.
 */
export async function shareFile(file: File): Promise<void> {
  if (IS_ANDROID_APP) {
    if (!(await appShareFile(file))) throw new DOMException('The share sheet was closed.', 'AbortError');
    return;
  }
  await navigator.share({ files: [file] });
}
