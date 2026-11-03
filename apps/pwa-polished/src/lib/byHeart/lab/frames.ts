/** The lab: how smoothly the screen is keeping up while something runs. */

export interface FrameStats {
  fps: number;
  /** The longest gap between two frames, in ms. */
  worst: number;
  /** Frames that took over 50 ms, which the eye can catch. */
  slow: number;
  frames: number;
}

/** Start counting. Call what it returns to stop and get the count. */
export function watchFrames(): () => FrameStats {
  const gaps: number[] = [];
  const began = performance.now();
  let last = began;
  let raf = requestAnimationFrame(function tick(now) {
    gaps.push(now - last);
    last = now;
    raf = requestAnimationFrame(tick);
  });
  return () => {
    cancelAnimationFrame(raf);
    const ms = performance.now() - began;
    return {
      fps: Math.round((gaps.length / ms) * 1000),
      worst: Math.round(gaps.length ? Math.max(...gaps) : 0),
      slow: gaps.filter((g) => g > 50).length,
      frames: gaps.length,
    };
  };
}
