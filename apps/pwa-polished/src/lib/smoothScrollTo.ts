/**
 * A scroll tween that can be re-aimed while it is running.
 *
 * This exists because `scrollIntoView({ behavior: 'smooth' })` cannot be. Each
 * call cancels the animation already in flight and starts a fresh one easing
 * from zero velocity, so a follower being pushed a new target every ~150ms dies
 * about a third of the way through every time and re-accelerates from a
 * standstill. That is the joystick feel in the commentary window's anchor: the
 * motion is not too fast, it is too many motions.
 *
 * So the target here is a number that can be replaced at any moment, and the
 * tween never restarts — it keeps whatever velocity it already has and eases
 * toward the new figure. Retargeting a moving tween is the ordinary case here,
 * not an interruption.
 *
 * The shape of the motion:
 *
 * - **Speed is proportional to the distance left.** That single rule gives the
 *   slow landing for nothing: as the gap closes the tween slows itself, and it
 *   stays smooth through a retarget, because a retarget is only the gap
 *   changing.
 * - **A launch ramp gives the slow take-off**, since proportional speed alone
 *   starts at its fastest, which is exactly the lurch this is meant to remove.
 *   The ramp is skipped on retarget — a follower already moving must not stall
 *   just because the master moved again.
 * - **Velocity approaches its desired value rather than snapping to it**, so
 *   the ramp, the retarget and the landing read as one continuous motion rather
 *   than three joined at visible seams.
 * - **A ceiling** keeps a cross-chapter jump from becoming an unreadable blur,
 *   and a per-frame overshoot guard stops the step past the target that a large
 *   velocity and a small remaining gap would otherwise produce.
 *
 * Overall it is deliberately lazier than the commentary window — the ask was to
 * tame it down. Followers should look like they are being led, not yanked.
 *
 * Used by parallelSync for the harmony view's followers.
 */

/** How long the take-off ramp lasts, on a tween that starts from rest. */
const RAMP_MS = 180;

/**
 * Fraction of the remaining distance crossed per second.
 *
 * This is the whole character of the motion. Lower is lazier; at 3.4 a follower
 * covers roughly 97% of the gap in a second, which reads as unhurried without
 * ever looking like it has stopped trying.
 */
const APPROACH_PER_SEC = 3.4;

/**
 * How fast the actual velocity converges on the velocity the distance asks for,
 * as a fraction per second. This is the second-order smoothing that keeps a
 * retarget from showing a corner: the desired speed can change instantly, the
 * real one cannot.
 */
const VELOCITY_LERP_PER_SEC = 9;

/** Ceiling on scroll speed, px/sec, so a long jump stays readable. */
const MAX_SPEED = 2600;

/** Below this gap, in px, the tween has arrived. */
const ARRIVE_PX = 0.5;

/** Below this speed, in px/sec, a tween with a tiny gap left is done. */
const ARRIVE_SPEED = 40;

/** How far the scroller can move behind our back before we adopt its position. */
const DESYNC_PX = 2;

interface Tween {
  scroller: HTMLElement;
  /** Where we are heading. Replaced in place by a retarget. */
  target: number;
  /** Current speed, px/sec, signed. Survives retargets — that is the point. */
  velocity: number;
  /** Timestamp of the previous frame, for the real elapsed time. */
  lastFrame: number;
  /**
   * When this tween started from rest, for the launch ramp. Null once the ramp
   * is spent, and never set again by a retarget.
   */
  rampStart: number | null;
  /**
   * Our own idea of the scroll position, in floating point.
   *
   * Kept separately because `scrollTop` is rounded by the browser, and on some
   * engines snapped to device pixels. Reading it back each frame would discard
   * the sub-pixel remainder every time, which near the landing is most of the
   * movement — the tween would visibly stall a few pixels short.
   */
  position: number;
  frame: number;
}

const tweens = new WeakMap<HTMLElement, Tween>();

/**
 * Scroll `scroller` so that `top` becomes its scrollTop, easing.
 *
 * Calling this again while a tween is running re-aims that tween rather than
 * starting another, so the caller does not have to know or care whether the
 * previous move has finished.
 */
export function smoothScrollTo(scroller: HTMLElement, top: number): void {
  const target = clampTarget(scroller, top);
  const existing = tweens.get(scroller);

  if (existing) {
    existing.target = target;
    // Deliberately not touching velocity, rampStart or position. A retarget is
    // a change of destination, not a new journey.
    return;
  }

  const now = performance.now();
  const tween: Tween = {
    scroller,
    target,
    velocity: 0,
    lastFrame: now,
    rampStart: now,
    position: scroller.scrollTop,
    frame: 0,
  };
  tweens.set(scroller, tween);
  tween.frame = requestAnimationFrame((at) => step(tween, at));
}

/**
 * Stop a scroller where it is.
 *
 * Never scrolls back to anything: a frozen follower keeps the position it had
 * reached, because losing its parallel is not a reason to undo the reading the
 * user can already see.
 */
export function cancelSmoothScroll(scroller: HTMLElement | null | undefined): void {
  if (!scroller) return;
  const tween = tweens.get(scroller);
  if (!tween) return;
  cancelAnimationFrame(tween.frame);
  tweens.delete(scroller);
}

/** Whether a tween is currently running on this scroller. */
export function isSmoothScrolling(scroller: HTMLElement | null | undefined): boolean {
  return !!scroller && tweens.has(scroller);
}

function clampTarget(scroller: HTMLElement, top: number): number {
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return Math.min(Math.max(0, top), max);
}

function step(tween: Tween, now: number): void {
  const { scroller } = tween;

  // The element can be torn down mid-flight — a pane closing, a chapter load
  // swapping out the subtree. Nothing to scroll, so nothing to keep alive.
  if (!scroller.isConnected) {
    tweens.delete(scroller);
    return;
  }

  // Clamped so a tab returning to the foreground after a long pause plays one
  // ordinary frame rather than integrating a ten-second dt into one huge jump.
  const dt = Math.min(0.05, Math.max(0.001, (now - tween.lastFrame) / 1000));
  tween.lastFrame = now;

  // If something else moved the scroller — the user's finger, a chapter load
  // resetting scrollTop — adopt that as reality rather than driving on from a
  // stale position. The engine's grace period is what stops us re-aiming at a
  // pane the user is holding; this is the smaller matter of staying honest
  // about where the pane actually is.
  if (Math.abs(scroller.scrollTop - tween.position) > DESYNC_PX) {
    tween.position = scroller.scrollTop;
  }

  // Re-clamped every frame: the reader appends chapters as it scrolls, so the
  // scrollable height under a follower grows while the tween is in flight.
  const target = clampTarget(scroller, tween.target);
  const remaining = target - tween.position;

  // The speed the distance asks for. Proportional, so it falls away as the gap
  // closes, which is the landing.
  let desired = remaining * APPROACH_PER_SEC;

  // The take-off. Only ever on a tween that began from rest; a retarget leaves
  // rampStart alone, so a moving follower is never throttled back to zero.
  if (tween.rampStart !== null) {
    const elapsed = now - tween.rampStart;
    if (elapsed >= RAMP_MS) {
      tween.rampStart = null;
    } else {
      desired *= easeInOutCubic(elapsed / RAMP_MS);
    }
  }

  desired = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, desired));

  // Approach the desired velocity instead of taking it. Framerate-independent:
  // the same fraction is crossed per second whether frames arrive at 60Hz or
  // 120Hz, which a bare `v += (d - v) * k` would not give.
  const blend = 1 - Math.exp(-VELOCITY_LERP_PER_SEC * dt);
  tween.velocity += (desired - tween.velocity) * blend;

  let move = tween.velocity * dt;

  // Overshoot guard. With a large velocity and a small gap a single frame can
  // step past the target and the next step back — a visible flutter at exactly
  // the moment the motion should be settling.
  if (Math.abs(move) > Math.abs(remaining)) move = remaining;

  tween.position += move;
  scroller.scrollTop = tween.position;

  // Arrived: close enough and slow enough. Both tests matter — a fast tween
  // passing through its target mid-flight is not finished, and a slow one that
  // has crept to within half a pixel is.
  if (
    Math.abs(target - tween.position) <= ARRIVE_PX &&
    Math.abs(tween.velocity) < ARRIVE_SPEED
  ) {
    scroller.scrollTop = target;
    tween.position = target;
    tweens.delete(scroller);
    return;
  }

  tween.frame = requestAnimationFrame((at) => step(tween, at));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
