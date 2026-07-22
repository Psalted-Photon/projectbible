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
 * Progress is read straight off the audio element each frame, so pausing,
 * jumping and speed changes are handled for free.
 *
 * Word positions are measured with Ranges — the verse markup is never touched,
 * so footnotes, red letters and interlinear layers stay intact.
 */

interface WordBox {
  left: number;   // relative to the verse element
  top: number;
  width: number;
  height: number;
  weight: number; // rough share of speaking time
}

const GLOW_CLASS = 'tts-glow';

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
        top: rect.top - originRect.top,
        width: rect.width,
        height: rect.height,
        weight: weighWord(match[0]),
      });
    }
  }
  return boxes;
}

/**
 * Start the glow over `verseEl`, paced by `audio`. Returns a cleanup function;
 * calling it stops the animation and removes the element.
 */
export function startGlow(verseEl: HTMLElement, audio: HTMLAudioElement): () => void {
  const textEl = verseEl.querySelector<HTMLElement>('.verse-text') ?? verseEl;
  let words = measureWords(textEl, verseEl);
  if (words.length === 0) return () => {};

  const totalWeight = words.reduce((sum, w) => sum + w.weight, 0);

  const glow = document.createElement('div');
  glow.className = GLOW_CLASS;
  glow.setAttribute('aria-hidden', 'true');
  verseEl.appendChild(glow);

  // Re-measure if the text reflows (rotation, font-size change, pane resize).
  const observer = new ResizeObserver(() => {
    words = measureWords(textEl, verseEl);
  });
  observer.observe(verseEl);

  let frame = 0;
  const draw = () => {
    frame = requestAnimationFrame(draw);
    if (words.length === 0) return;

    const duration = audio.duration;
    const progress =
      isFinite(duration) && duration > 0
        ? Math.min(1, Math.max(0, audio.currentTime / duration))
        : 0;

    // Walk the cumulative weights to find where we are, and how far through
    // the current word — so movement is continuous, never stepped.
    const target = progress * totalWeight;
    let acc = 0;
    let i = 0;
    for (; i < words.length; i++) {
      if (acc + words[i].weight >= target) break;
      acc += words[i].weight;
    }
    const word = words[Math.min(i, words.length - 1)];
    const within = Math.min(1, Math.max(0, (target - acc) / word.weight));

    const centerX = word.left + word.width * within;
    const centerY = word.top + word.height / 2;
    // Roughly two to three words wide, and never absurdly small on short words.
    const width = Math.max(word.width * 2.6, word.height * 4);
    const height = word.height * 1.9;

    glow.style.width = `${width}px`;
    glow.style.height = `${height}px`;
    glow.style.transform = `translate3d(${centerX - width / 2}px, ${centerY - height / 2}px, 0)`;
  };
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    glow.remove();
  };
}
