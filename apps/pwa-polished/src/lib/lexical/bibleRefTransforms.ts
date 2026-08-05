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
 * Still mid-reference: more of it could be coming.
 *
 * An allowlist, and a deliberately short one. Everything else finishes a
 * reference — a space, a letter, a period, a bracket, a newline. There is no
 * list of terminators to keep in step, which is what makes this hard to get
 * wrong again; treating the colon as a terminator is what once made
 * `acts 10:5` link the moment you typed the colon.
 *
 * Digits are absent on purpose. The detector already takes every digit that
 * makes a real chapter or verse, so a digit left over is one it refused — the
 * "2" in "acts 28:32", where Acts 28 stops at verse 31. Waiting for that to
 * become valid would mean waiting forever.
 */
const CONTINUES_RE = /[:–-]/;

/**
 * What may follow a COMPLETE reference and still leave it open.
 *
 * An allowlist on purpose. Once the reference is finished, everything ends it —
 * a letter, a period, a bracket, a newline, a space — except a colon, a dash, or
 * a comma or semicolon. There is nothing to enumerate on the other side, which
 * is what makes this hard to get wrong again.
 *
 * Digits are excluded for the same reason as CONTINUES_RE: a leftover digit is
 * one the detector refused, so it belongs outside the link, not in it.
 *
 * A separator may be followed by whitespace ("Psa 89:28, " on its way to
 * "…, 29"), but whitespace alone never keeps a finished reference open.
 */
const CONTINUES_REST = /^(?:[:–-]|[;,]\s*)*$/;

/** How an expanded verse reads: `Luke 12:1 — "In the mean time…"` */
export function formatVerseSuffix(text: string): string {
  return ` — “${text.trim()}”`;
}

/**
 * Recognises the printed verse by the shape formatVerseSuffix gives it.
 *
 * Used to tell which half is left when an expanded link loses a child: the
 * reference, or the scripture. They are treated very differently.
 */
const VERSE_SUFFIX_RE = /^\s*—\s*“/;

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
  if (rest.length === 0) return false; // nothing after it yet — still typing
  if (CONTINUES_RE.test(rest[0])) return false; // a colon or dash: more coming
  // A separator with numbers behind it is a list still being written. Firing
  // there would strand the "110:4" mid-type. A separator with nothing after it
  // yet is the same story.
  if (/^\s*[;,]\s*$/.test(rest)) return false;
  if (/^\s*[;,]\s*\d/.test(rest)) return false;
  // Everything else finishes it — including a leftover digit, which the
  // detector already refused, so there is nothing to wait for. That is what
  // makes "acts 28:32" link the instant you type the 2.
  return true;
}

/** Replace every reference in one list with a link, leaving the separators. */
function convertRun(node: TextNode, run: RefMatch[]): void {
  // Where the writer was before we rearrange anything underneath them.
  const caretBefore = $caretOffsetInText(node);

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

  // Put the writer back where they were.
  //
  // Not "just after the link" — that only looks right when the link is the last
  // thing on the line. With anything after it, forcing the cursor there drags
  // you backwards over your own typing.
  if (!lastCreated || caretBefore === null) return;
  const lastMatch = run[run.length - 1];

  if (caretBefore > lastMatch.end) {
    // Past the end of the reference: stay that far past it. Measuring from the
    // reference's end rather than from the start of the line keeps this right
    // even though the label may have changed length — "lk 12:1" became
    // "Luke 12:1" and everything after it shifted.
    const following = lastCreated.getNextSibling();
    if ($isTextNode(following)) {
      const offset = Math.min(caretBefore - lastMatch.end, following.getTextContentSize());
      following.select(offset, offset);
    }
    return;
  }

  // Inside the reference itself, which is where it lands when a link forms
  // around the word you just finished. Sit at its end, ready to keep writing.
  if (caretBefore >= lastMatch.start) lastCreated.selectEnd();
}

/** The caret's offset within one text node, or null if it isn't in it. */
function $caretOffsetInText(node: TextNode): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor;
  return anchor.getNode().getKey() === node.getKey() ? anchor.offset : null;
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
    if ($getRefVerseNode(node)) {
      // Both halves present. Locked: every child is a token, so the verse
      // cannot be typed into or nibbled at. Enforced each pass so a reload
      // can't land in a soft state.
      for (const child of children) {
        if ($isTextNode(child) && child.getMode() !== 'token') child.setMode('token');
      }
      return;
    }

    // Only one half survived a deletion. Which one decides everything.
    if (VERSE_SUFFIX_RE.test(children[0].getTextContent())) {
      // The reference was deleted and the scripture is what's left. It does not
      // get to stay behind as ordinary prose — the whole point of locking it is
      // that printed scripture is never editable. Delete the link entirely.
      node.remove();
      return;
    }

    // The verse was deleted, leaving the reference: that is a collapse. Without
    // this the node stays flagged as expanded holding only the reference —
    // locked against typing, and offering "Collapse" for a verse already gone.
    node.setExpanded(false);
    // falls through to the collapsed handling below
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

  // 3. A complete reference with only continuing characters after it — you're
  //    part-way through typing a verse number. Point at what resolves so far.
  //
  //    Once a reference is complete, EVERYTHING ends it except the characters
  //    in CONTINUES_REST. A space ends it just as surely as a letter does; that
  //    it didn't is why spaces used to cling to a link forever.
  //    The leniency only lasts while you are actually in there typing. Once you
  //    move away it has to be exactly a reference or it lets go, so a half-typed
  //    "Acts 5:44" cannot settle as a link quietly pointing at Acts 5.
  const leading = matches[0];
  const hasLeading = !isFullRun && leading?.start === 0;
  if (hasLeading && inside && CONTINUES_REST.test(text.slice(leading.end))) {
    if (leading.canonical !== node.getRef()) {
      node.setTarget(leading.canonical, leading.book, leading.chapter, leading.verse);
    }
    return;
  }

  // 4. No complete reference yet, but on its way back to being one — "Acts "
  //    with the numbers backspaced away. Hold the link together while the
  //    cursor is still in it, with no destination until it resolves, so
  //    retyping the numbers brings it straight back instead of stranding the
  //    edit.
  //
  //    Only when nothing has resolved yet: "Acts 5:4 " has a finished reference
  //    in it, so the space ends it rather than holding it open.
  if (!isFullRun && !hasLeading && inside && couldBecomeRef(text)) {
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
  // cursor moves away, anything unsettled has to resolve — either it is exactly
  // a reference or it becomes plain text. Without this, "Acts " would sit there
  // looking like half a link forever, and a half-typed "Acts 5:44" would keep a
  // link quietly pointing somewhere its text doesn't say.
  const unregisterSelection = editor.registerCommand(
    SELECTION_CHANGE_COMMAND,
    () => {
      editor.update(() => {
        for (const node of $nodesOfType(BibleRefNode)) {
          if (node.isExpanded()) continue;
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
