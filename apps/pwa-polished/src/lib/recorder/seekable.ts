/**
 * A recording straight from the browser's recorder has no length written in
 * it, so a player can't seek until it has been sent to the far end once.
 * Use on an <audio> element: `use:seekable`.
 */
export function seekable(audio: HTMLAudioElement) {
  const fix = () => {
    if (Number.isFinite(audio.duration)) return;
    const back = () => {
      if (!Number.isFinite(audio.duration)) return;
      audio.removeEventListener('durationchange', back);
      audio.currentTime = 0;
    };
    audio.addEventListener('durationchange', back);
    audio.currentTime = 1e101;
  };
  audio.addEventListener('loadedmetadata', fix);
  return { destroy: () => audio.removeEventListener('loadedmetadata', fix) };
}
