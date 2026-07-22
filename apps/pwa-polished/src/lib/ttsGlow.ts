/**
 * Drifting glow for Read Aloud — a soft, out-of-focus cloud that glides along
 * the words as they're spoken.
 *
 * Why soft and wide: we don't get exact per-word timings back from the speech
 * model (the standard Piper export hands back finished audio and keeps its
 * internal durations to itself). So the pace here is an estimate. A crisp
 * highlight on the wrong word looks broken; a blurred cloud a few words wide
 * is almost always covering the right word somewhere in its span, and reads as
 * atmosphere rather than error.
 *
 * Positioning: the glow lives in `.text-container`, NOT inside the verse. In
 * paragraph layout a verse is an inline element flowing through the paragraph,
 * and for an inline box spanning several lines the browser's reference for
 * placing an absolutely positioned child is not the box measuring returns —
 * so anchoring to the verse put the glow in the wrong place, drifting as the
 * text rewrapped. `.text-container` is a block that scrolls with the content
 * and is already the anchor the text-selection drag handles use, so the same
 * "rect minus container rect" maths applies and layout mode stops mattering.
 *
 * Smoothness, in three parts — all of it matters, they compound:
 *  1. The size is fixed once. Changing width/height per frame forces layout
 *     and re-renders the (expensive) blur every frame; with a constant size
 *     the browser rasterises the blur once and just slides it around.
 *  2. Only `transform` changes per frame — the compositor-only path.
 *  3. Travel is continuous through the gaps between words, and the audio
 *     clock is predicted between its coarse updates. Reading currentTime raw
 *     makes the glow hold-then-hop, because it doesn't tick once per frame.
 *
 * Word positions are measured with Ranges — the verse markup is never touched,
 * so footnotes, red letters and interlinear layers stay intact.
 */

interface WordBox {
  left: number;   // relative to the positioning container
  right: number;
  top: number;
  height: number;
  weight: number; // rough share of speaking time
}

/** A word plus where its travel starts and ends, so motion is continuous. */
interface Step extends WordBox {
  xStart: number;
  xEnd: number;
  line: number;
}

const GLOW_CLASS = 'tts-glow';

/** Piper clips carry a little silence at the head and tail, which left the
 *  glow reading a touch behind the voice. Nudge it forward by this much.
 *  Tune by eye — bigger runs ahead, smaller lags. */
const LEAD_SECONDS = 0.12;

/** Fixed size, as multiples of the text height, so it never pulses. Width is
 *  deliberately generous — roughly two to three words. */
const WIDTH_RATIO = 5.5;
const HEIGHT_RATIO = 1.9;

/** How quickly the rendered position catches up to the target, per frame.
 *  Low enough to smooth out the audio clock's steps, high enough not to lag. */
const EASE = 0.28;

/** Never predict further than this past the last real clock reading. */
const MAX_PREDICT_SECONDS = 0.25;

/** Longer words take longer to say. Character count is a decent stand-in for
 *  duration, and the glow's width absorbs the slop. */
function weighWord(word: string): number {
  return Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, '').length) + 1; // +1 ≈ the gap after it
}

/**
 * Measure every visible word inside `root`, in reading order, positioned
 * relative to `origin`. Footnote markers and interlinear extras are skipped so
 * the glow tracks the spoken words only.
 */
function measureWords(root: HTMLElement, origin: HTMLElement): WordBox[] {
  const originRect = origin.getBoundingClientRect();
  const boxes: WordBox[] = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // Skip anything that isn't spoken: footnote/xref markers, interlinear layers.
      if (parent.closest('.inline-note, .il-gloss, .il-translit, .il-lemma, .il-strongs, .il-parse')) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.nodeValue ?? '').trim().length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const wordRe = /\S+/g;
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const text = textNode.nodeValue ?? '';
    wordRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = wordRe.exec(text))) {
      const range = document.createRange();
      range.setStart(textNode, match.index);
      range.setEnd(textNode, match.index + match[0].length);
      // A word can wrap mid-token; take the first fragment so the glow follows
      // the line it starts on.
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      range.detach?.();
      if (!rect || rect.width === 0) continue;
      boxes.push({
        left: rect.left - originRect.left,
        right: rect.right - originRect.left,
        top: rect.top - originRect.top,
        height: rect.height,
        weight: weighWord(match[0]),
      });
    }
  }
  return boxes;
}

/**
 * Turn measured words into a continuous travel path: each word's span runs to
 * where the next word begins, so the gaps between words are glided through
 * rather than skipped. A word that ends a visual line stops at its own right
 * edge, and the next line starts fresh at its left — the wrap.
 */
function buildTrack(words: WordBox[]): Step[] {
  const steps: Step[] = [];
  let line = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    // Sub-pixel differences are normal within a line; half a line height apart
    // means we've genuinely wrapped.
    if (prev && Math.abs(w.top - prev.top) > prev.height * 0.5) line++;
    const next = words[i + 1];
    const sameLineNext = next && Math.abs(next.top - w.top) <= w.height * 0.5;
    steps.push({
      ...w,
      xStart: w.left,
      xEnd: sameLineNext ? next.left : w.right,
      line,
    });
  }
  return steps;
}

/** Median text height — robust to the odd differently-sized inline bit. */
function medianHeight(words: WordBox[]): number {
  const heights = words.map((w) => w.height).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 20;
}

/**
 * Start the glow over `verseEl`, paced by `audio`. Returns a cleanup function;
 * calling it stops the animation and removes the element.
 */
export function startGlow(verseEl: HTMLElement, audio: HTMLAudioElement): () => void {
  const textEl = verseEl.querySelector<HTMLElement>('.verse-text') ?? verseEl;
  // Anchor to the block container, never the verse (see note at top of file).
  const container = verseEl.closest<HTMLElement>('.text-container') ?? verseEl;

  let words = measureWords(textEl, container);
  if (words.length === 0) return () => {};

  let track = buildTrack(words);
  let totalWeight = track.reduce((sum, w) => sum + w.weight, 0);

  const glow = document.createElement('div');
  glow.className = GLOW_CLASS;
  glow.setAttribute('aria-hidden', 'true');

  // Size is set once and never touched again — see note 1 at the top.
  let glowW = 0;
  let glowH = 0;
  const applySize = () => {
    const h = medianHeight(words);
    glowW = h * WIDTH_RATIO;
    glowH = h * HEIGHT_RATIO;
    glow.style.width = `${glowW}px`;
    glow.style.height = `${glowH}px`;
  };
  applySize();

  // Prepended so it paints beneath the verses that follow it in the container.
  container.insertBefore(glow, container.firstChild);

  // Re-measure when the container reflows: a width change rewraps the text, and
  // a height change means content above shifted the verse. Either invalidates
  // the coordinates we captured. (Not a per-frame cost — reflows are rare.)
  const observer = new ResizeObserver(() => {
    const fresh = measureWords(textEl, container);
    if (fresh.length === 0) return; // ignore a measurement taken mid-teardown
    words = fresh;
    track = buildTrack(words);
    totalWeight = track.reduce((sum, w) => sum + w.weight, 0);
    applySize();
  });
  observer.observe(container);

  // ── predicted playback clock ──────────────────────────────────────────────
  // audio.currentTime doesn't advance once per frame; it arrives in chunks.
  // Anchor on each real reading and extrapolate in between so motion is
  // continuous, and freeze entirely while paused.
  let anchorMedia = 0;
  let anchorWall = performance.now();
  let lastSeen = -1;

  function playbackSeconds(now: number): number {
    const t = audio.currentTime;
    if (t !== lastSeen) {
      lastSeen = t;
      anchorMedia = t;
      anchorWall = now;
    }
    if (audio.paused) return anchorMedia;
    const rate = audio.playbackRate || 1;
    const predicted = anchorMedia + ((now - anchorWall) / 1000) * rate;
    return Math.min(predicted, anchorMedia + MAX_PREDICT_SECONDS);
  }

  let renderX = 0;
  let renderY = 0;
  let renderLine = -1;

  let frame = 0;
  const draw = (now: number) => {
    // Self-terminate if we were ever orphaned — nothing can outlive its element.
    if (!glow.isConnected) {
      observer.disconnect();
      return;
    }
    frame = requestAnimationFrame(draw);
    if (track.length === 0) return;

    const duration = audio.duration;
    const progress =
      isFinite(duration) && duration > 0
        ? Math.min(1, Math.max(0, (playbackSeconds(now) + LEAD_SECONDS) / duration))
        : 0;

    // Walk the cumulative weights to find which word we're on, and how far
    // through it — continuous, because each step's span runs into the next.
    const target = progress * totalWeight;
    let acc = 0;
    let i = 0;
    for (; i < track.length; i++) {
      if (acc + track[i].weight >= target) break;
      acc += track[i].weight;
    }
    const step = track[Math.min(i, track.length - 1)];
    const within = Math.min(1, Math.max(0, (target - acc) / step.weight));

    const targetX = step.xStart + (step.xEnd - step.xStart) * within;
    const targetY = step.top + step.height / 2;

    if (step.line !== renderLine) {
      // Wrapping to a new line (or the very first frame): snap, so it appears
      // at the start of the next line rather than sliding diagonally.
      renderX = targetX;
      renderY = targetY;
      renderLine = step.line;
    } else {
      renderX += (targetX - renderX) * EASE;
      renderY += (targetY - renderY) * EASE;
    }

    // Only the transform changes — see note 2 at the top.
    glow.style.transform = `translate3d(${renderX - glowW / 2}px, ${renderY - glowH / 2}px, 0)`;
  };
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    glow.remove();
  };
}
