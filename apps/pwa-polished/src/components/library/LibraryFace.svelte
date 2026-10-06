<script lang="ts">
  import { tick } from "svelte";
  import { MOTION, motionLevel } from "../../lib/motion";

  /**
   * The page of a library card: everything under the four work tabs.
   *
   * turn() is the flip between the A–Z index and an entry. The page turns
   * edge-on, the change is made while it can't be seen, and the new side turns
   * in from the other edge. Opening an entry turns one way and going back to the
   * index turns the other. The tabs stay where they are, like a book's spine.
   * On Reduced motion it is a short fade instead; on Off it just swaps.
   *
   * Nothing here touches the page at rest. The depth, the dark behind the page,
   * the page's own background and its shadow are all put on for the turn and
   * taken off after, so a card or a docked window looks exactly as it did.
   *
   * Tapping again mid-turn finishes the first turn on the spot (its change made,
   * its styles gone) and starts the new one. Nothing queues.
   *
   * Timings are MOTION.flip in lib/motion.ts, tuned in motion-lab.html. Of the
   * lab's three styles this plays the quick turn and the tilt; a full flip
   * needs both sides drawn at once, which these cards never have.
   */

  let wrapEl: HTMLDivElement;
  let faceEl: HTMLDivElement;
  let shadeEl: HTMLDivElement | null = null;

  /** True for the length of a turn: puts the dark behind and the shadow on. */
  let turning = false;
  /** The page's background while it turns, so it reads as a page and not as
   *  text floating over the dark. Borrowed from whatever paints the card. */
  let pageBg: string | null = null;

  type Run = { anims: Animation[]; pending: (() => void) | null; done: boolean };
  let run: Run | null = null;

  /** The first solid background at or above `el`. */
  function solidBackground(el: Element | null): string {
    for (let node = el; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== "transparent" && !/,\s*0\)$/.test(bg)) return bg;
    }
    return "#1e1e1e";
  }

  function play(r: Run, el: Element, frames: Keyframe[], duration: number, easing: string): Animation {
    const a = el.animate(frames, { duration, easing, fill: "both" });
    r.anims.push(a);
    return a;
  }

  /** True once every animation has played out and this turn is still the live one. */
  async function settled(r: Run, ...anims: Animation[]): Promise<boolean> {
    try {
      await Promise.all(anims.map((a) => a.finished));
    } catch {
      return false;
    }
    return !r.done;
  }

  /** Make the change and let it draw, while the page can't be seen. */
  async function swap(r: Run): Promise<boolean> {
    const apply = r.pending;
    r.pending = null;
    apply?.();
    await tick();
    return !r.done;
  }

  function end(r: Run) {
    r.done = true;
    for (const a of r.anims) a.cancel();
    r.anims = [];
    if (run === r) run = null;
    turning = false;
    pageBg = null;
  }

  /** Finish whatever turn is playing: its change made, its styles gone. */
  function finish() {
    const r = run;
    if (!r) return;
    const apply = r.pending;
    r.pending = null;
    end(r);
    apply?.();
  }

  export async function turn(toEntry: boolean, apply: () => void): Promise<void> {
    finish();
    const level = motionLevel();
    if (level === "off" || !faceEl || typeof faceEl.animate !== "function") {
      apply();
      return;
    }
    const r: Run = { anims: [], pending: apply, done: false };
    run = r;
    const flip = MOTION.flip;

    if (level === "reduced") {
      const total = MOTION.reducedFadeMs;
      const out = play(r, faceEl, [{ opacity: 1 }, { opacity: 0 }], total * 0.4, flip.awayEase);
      if (!(await settled(r, out))) return;
      if (!(await swap(r))) return;
      const back = play(r, faceEl, [{ opacity: 0 }, { opacity: 1 }], total * 0.6, flip.inEase);
      out.cancel();
      if (await settled(r, back)) end(r);
      return;
    }

    const tilt = flip.style === "tilt";
    const angle = tilt ? flip.tiltDeg : 90;
    let dir = toEntry ? -1 : 1;
    if (flip.reverse) dir = -dir;
    // perspective() inside the transform rather than the perspective property:
    // the property would make this a containing block for anything fixed inside
    // the card all the time, not just during the turn.
    const p = `perspective(${flip.perspective}px)`;

    pageBg = solidBackground(wrapEl.parentElement);
    turning = true;
    await tick();
    if (r.done) return;

    const away = play(r, faceEl, [
      { transform: `${p} rotateY(0deg)`, opacity: 1 },
      { transform: `${p} rotateY(${dir * angle}deg)`, opacity: tilt ? 0 : 1 },
    ], flip.awayMs, flip.awayEase);
    const awayShade = shadeEl
      ? play(r, shadeEl, [{ opacity: 0 }, { opacity: flip.shade }], flip.awayMs, flip.awayEase)
      : null;
    if (!(await settled(r, away, ...(awayShade ? [awayShade] : [])))) return;

    // Edge-on: nobody can see the page, so this is when it changes.
    if (!(await swap(r))) return;

    const back = play(r, faceEl, [
      { transform: `${p} rotateY(${-dir * angle}deg)`, opacity: tilt ? 0 : 1 },
      { transform: `${p} rotateY(0deg)`, opacity: 1 },
    ], flip.inMs, flip.inEase);
    const backShade = shadeEl
      ? play(r, shadeEl, [{ opacity: flip.shade }, { opacity: 0 }], flip.inMs, flip.inEase)
      : null;
    away.cancel();
    awayShade?.cancel();
    if (await settled(r, back, ...(backShade ? [backShade] : []))) end(r);
  }
</script>

<div class="lib-face-wrap" class:turning bind:this={wrapEl}>
  <div class="lib-face" style:background={pageBg} bind:this={faceEl}>
    <slot />
    {#if turning}
      <div class="lib-shade" bind:this={shadeEl} aria-hidden="true"></div>
    {/if}
  </div>
</div>

<style>
  /* Both layers lay out exactly like the card they sit in (a flex column that
     fills it), so the header, index and body inside behave as before. */
  .lib-face-wrap,
  .lib-face {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  /* The dark you glimpse behind the page while it turns. */
  .lib-face-wrap.turning {
    background: rgba(0, 0, 0, var(--motion-flip-behind, 0.8));
  }
  /* Only exists mid-turn, when the page's transform makes it the containing
     block, so inset 0 covers the page and nothing else. */
  .lib-shade {
    position: absolute;
    inset: 0;
    background: #000;
    opacity: 0;
    pointer-events: none;
    z-index: 20;
  }
</style>
