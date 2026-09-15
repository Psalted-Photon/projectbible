/**
 * Handing a file to the person: the share sheet on a phone (Save to Files,
 * Drive, email), a normal download everywhere else.
 */

import { isPhoneOrTablet } from '../device';

export type SaveResult = 'shared' | 'downloaded' | 'cancelled';

function download(file: File): void {
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
