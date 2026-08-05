/**
 * The two rules that keep Bible references honest inside the editor.
 *
 * 1. Plain text becomes a reference — but only once the reference is followed
 *    by a space or punctuation, so "Luke 1" doesn't link and rewrite itself
 *    while you're still typing "12".
 *
 * 2. A reference re-checks itself after every edit. Correct "Luke 12:1" to
 *    "Luke 12:11" and the link follows; break it into something that isn't a
 *    reference and it drops quietly back to ordinary text.
 *
 * Both run inside the same update that produced the keystroke, before the
 * screen repaints — there is no timer and nothing to outrun.
 */

import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  TextNode,
  type LexicalEditor,
} from 'lexical';
import { findRefs, couldBecomeRef, type RefMatch } from '../bibleRefs';
import {
  BibleRefNode,
  $createBibleRefNode,
  $isBibleRefNode,
  $getRefDisplayNode,
  $getRefVerseNode,
} from './BibleRefNode';

/**
 * Characters that genuinely end a reference: whitespace, or the punctuation
 * that ends a sentence or closes a bracket.
 *
 * Deliberately absent are `:` `;` `,` and the dashes. Those all appear INSIDE
 * references — a colon separates chapter from verse, a dash makes a range, and
 * a comma or semicolon separates one reference in a list from the next. Treating
 * any of them as "finished" is what made `acts 10:5` link the instant you typed
 * the colon.
 *
 * End-of-text is also excluded: that's the "still typing" case.
 */
const BOUNDARY_RE = /[\s.!?)\]}"'—]/;

/** Still mid-reference: more of it could be coming. */
const CONTINUES_RE = /[\d:–-]/;

/** How an expanded verse reads: `Luke 12:1 — "In the mean time…"` */
export function formatVerseSuffix(text: string): string {
  return ` — “${text.trim()}”`;
}

// ---------------------------------------------------------------------------
// 1. Plain text → reference
// ---------------------------------------------------------------------------

function textNodeTransform(node: TextNode): void {
  if (!node.isSimpleText()) return;

  // Text living inside a link: re-check the link from here.
  //
  // This rule is the one that reliably fires. The editor skips element-level
  // rules when the change is only a side effect of editing text — which is
  // exactly what typing inside a link is — so the link's own rule never ran and
  // a link could keep pointing somewhere its text no longer said.
  const parent = node.getParent();
  if ($isBibleRefNode(parent)) {
    refNodeTransform(parent);
    return;
  }

  const text = node.getTextContent();
  if (text.length < 4) return;

  const matches = findRefs(text);
  if (matches.length === 0) return;

  // A list like "Psa 89:28, 29; 110:4" is several matches that belong together:
  // only the first carries the book name, so they have to be converted in one
  // pass. Convert one and start over and the leftover ", 29; 110:4" resolves to
  // nothing.
  for (const run of groupIntoRuns(text, matches)) {
    if (!runIsFinished(text, run)) continue;
    convertRun(node, run);
    return;
  }
}

/** Matches separated only by a comma or semicolon are one list. */
function groupIntoRuns(text: string, matches: RefMatch[]): RefMatch[][] {
  const runs: RefMatch[][] = [];
  let current: RefMatch[] = [];

  for (const match of matches) {
    const previous = current[current.length - 1];
    const joined = previous && /^\s*[;,]\s*$/.test(text.slice(previous.end, match.start));
    if (joined) current.push(match);
    else {
      if (current.length) runs.push(current);
      current = [match];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

/**
 * Is the writer done with this list?
 *
 * Not while the next character could extend it — a digit, a colon, a dash — and
 * not while a trailing comma or semicolon suggests another reference is coming.
 */
function runIsFinished(text: string, run: RefMatch[]): boolean {
  const rest = text.slice(run[run.length - 1].end);
  if (rest.length === 0) return false; // still typing
  if (CONTINUES_RE.test(rest[0])) return false;
  if (BOUNDARY_RE.test(rest[0])) return true;
  // A separator ends the list only once something that clearly isn't another
  // reference follows it. "Psa 89:28, and something" is finished; "…, 29; 110"
  // is mid-list, and firing there would strand the "110:4" still being typed.
  return /^\s*[;,]\s*[^\d\s]/.test(rest);
}

/** Replace every reference in one list with a link, leaving the separators. */
function convertRun(node: TextNode, run: RefMatch[]): void {
  // Right to left, so each split leaves the earlier offsets untouched.
  let tail: TextNode = node;
  let lastCreated: BibleRefNode | null = null;

  for (let i = run.length - 1; i >= 0; i--) {
    const match = run[i];
    const [head, target] = tail.splitText(match.start, match.end);
    // splitText returns the pieces in order; with start > 0 the match is the
    // second piece, otherwise the first.
    const matchNode = match.start === 0 ? head : target;
    if (!matchNode) break;

    const refNode = $createBibleRefNode(
      match.canonical,
      match.book,
      match.chapter,
      match.verse,
      false,
    );
    // The label is canonicalised here: "lk 12:1" becomes "Luke 12:1".
    refNode.append($createTextNode(match.canonical));
    matchNode.replace(refNode);
    if (i === run.length - 1) lastCreated = refNode;

    if (match.start === 0) break;
    tail = head;
  }

  // Put the cursor immediately after the link that was just made, where the
  // writer was already typing. Left to the editor to guess, it lands in odd
  // places — between "Acts" and "5", for instance.
  if (!lastCreated) return;
  const following = lastCreated.getNextSibling();
  if ($isTextNode(following)) following.select(0, 0);
  else lastCreated.selectNext(0, 0);
}

// ---------------------------------------------------------------------------
// 2. Reference re-checks itself
// ---------------------------------------------------------------------------

function refNodeTransform(node: BibleRefNode): void {
  const children = node.getChildren();
  if (children.length === 0) {
    node.remove();
    return;
  }

  if (node.isExpanded()) {
    // Locked: every child is a token, so the verse cannot be typed into or
    // nibbled at. Enforced on each pass so a reload can't land in a soft state.
    for (const child of children) {
      if ($isTextNode(child) && child.getMode() !== 'token') child.setMode('token');
    }
    return;
  }

  // Collapsed: the label is ordinary editable text.
  const display = $getRefDisplayNode(node);
  if (display && display.getMode() === 'token') display.setMode('normal');

  const text = node.getTextContent();
  const matches = findRefs(text);
  const inside = $cursorIsInside(node);

  // 1. Still exactly one reference — just update where it points.
  //    "Acts 5:4" → "Acts 6:4", or "acts 5" swapped for "job 3".
  const whole = matches.find((m) => m.start === 0 && m.end === text.length);
  if (whole) {
    if (whole.canonical !== node.getRef()) {
      node.setTarget(whole.canonical, whole.book, whole.chapter, whole.verse);
    }
    // Tidy the spelling once the writer has moved on — never underneath a
    // moving cursor, which is how cursors get thrown across the line.
    if (!inside && text !== whole.canonical) {
      const display = $getRefDisplayNode(node);
      if (display) display.setTextContent(whole.canonical);
    }
    return;
  }

  // 2. Grew into a list — "1cor 4:8" edited to "1cor 4:8, 9". Break the single
  //    link apart so the run rule can rebuild it as several.
  const isFullRun =
    matches.length > 1 &&
    matches[0].start === 0 &&
    matches[matches.length - 1].end === text.length;

  // 3. A valid reference with only reference characters trailing it — a colon
  //    or dash mid-typing. Keep pointing at what resolves so far.
  const leading = matches[0];
  if (!isFullRun && leading?.start === 0 && /^[\d:;,\s–-]*$/.test(text.slice(leading.end))) {
    if (leading.canonical !== node.getRef()) {
      node.setTarget(leading.canonical, leading.book, leading.chapter, leading.verse);
    }
    return;
  }

  // 4. Not a reference yet, but on its way back to being one — "Acts " with the
  //    numbers backspaced away. Hold the link together while the cursor is
  //    still in it, with no destination until it resolves, so retyping the
  //    numbers brings it straight back instead of stranding the edit.
  if (!isFullRun && inside && couldBecomeRef(text)) {
    if (node.getRef() !== '') node.clearTarget();
    return;
  }

  // 5. Anything else — dissolve back to plain text. Rule 1 re-links whatever
  //    part still qualifies and leaves the rest alone.
  //
  //    Note where the caret was sitting first: editing "Romans 15" into
  //    "Romans 125" happens mid-word, and dropping the caret at the end of the
  //    replacement would yank the cursor away from what you were typing.
  const caret = $caretOffsetWithin(node, text.length);
  const replacement = $createTextNode(text);
  node.insertBefore(replacement);
  node.remove();
  replacement.select(caret, caret);

  // A list rebuilds immediately rather than waiting for a trailing space — it
  // was already a link, so there is nothing to wait for.
  if (isFullRun) convertRun(replacement, matches);
}

/** Is the writer's cursor currently inside this link? */
function $cursorIsInside(node: BibleRefNode): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const key = node.getKey();
  for (const point of [selection.anchor, selection.focus]) {
    const target = point.getNode();
    if (target.getKey() === key) return true;
    if (target.getParents().some((p) => p.getKey() === key)) return true;
  }
  return false;
}

/**
 * How far into a node's text the caret currently sits, as an offset the
 * replacement text node can reuse. Falls back to the end when the selection
 * isn't inside this node.
 */
function $caretOffsetWithin(node: BibleRefNode, fallback: number): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return fallback;

  const anchor = selection.anchor.getNode();
  if (!$isTextNode(anchor)) return fallback;

  // Sum the text before the anchor's own child, then add the offset inside it.
  let offset = 0;
  for (const child of node.getChildren()) {
    if (child.getKey() === anchor.getKey()) {
      return offset + selection.anchor.offset;
    }
    offset += child.getTextContent().length;
  }
  return fallback;
}

/**
 * Wire both rules into an editor. Returns a teardown function.
 */
export function registerBibleRefTransforms(editor: LexicalEditor): () => void {
  const unregisterText = editor.registerNodeTransform(TextNode, textNodeTransform);
  const unregisterRef = editor.registerNodeTransform(BibleRefNode, refNodeTransform);

  // A link only holds itself together while the cursor is inside it. Once the
  // cursor moves away, anything still unresolved has to settle — either it is a
  // real reference or it is plain text. Without this, "Acts " would sit there
  // looking like half a link forever.
  const unregisterSelection = editor.registerCommand(
    SELECTION_CHANGE_COMMAND,
    () => {
      editor.update(() => {
        for (const node of $nodesOfType(BibleRefNode)) {
          if (node.isExpanded() || node.hasTarget()) continue;
          if ($cursorIsInside(node)) continue;
          refNodeTransform(node);
        }
      });
      return false; // never swallow the event
    },
    COMMAND_PRIORITY_LOW,
  );

  return () => {
    unregisterText();
    unregisterRef();
    unregisterSelection();
  };
}

// ---------------------------------------------------------------------------
// Expand / collapse
// ---------------------------------------------------------------------------

/**
 * Print the verse inside the reference and lock the whole thing.
 * Call inside editor.update().
 */
export function $expandRef(node: BibleRefNode, verseText: string): void {
  if (node.isExpanded()) return;
  const display = $getRefDisplayNode(node);
  if (!display) return;

  const verse = $createTextNode(formatVerseSuffix(verseText));
  verse.setMode('token');
  display.setMode('token');
  display.insertAfter(verse);
  node.setExpanded(true);
}

/** Strip the verse back off and hand the reference back to the keyboard. */
export function $collapseRef(node: BibleRefNode): void {
  if (!node.isExpanded()) return;
  $getRefVerseNode(node)?.remove();
  const display = $getRefDisplayNode(node);
  if (display) display.setMode('normal');
  node.setExpanded(false);
}
