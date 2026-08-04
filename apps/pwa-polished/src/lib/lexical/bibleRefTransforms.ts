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
  $isTextNode,
  TextNode,
  type LexicalEditor,
} from 'lexical';
import { findRefs } from '../bibleRefs';
import {
  BibleRefNode,
  $createBibleRefNode,
  $isBibleRefNode,
  $getRefDisplayNode,
  $getRefVerseNode,
} from './BibleRefNode';

/**
 * A reference only converts once one of these follows it. End-of-text is
 * deliberately excluded: that's the "still typing" case.
 */
const BOUNDARY_RE = /[\s.,;:!?)\]}"'—–-]/;

/** How an expanded verse reads: `Luke 12:1 — "In the mean time…"` */
export function formatVerseSuffix(text: string): string {
  return ` — “${text.trim()}”`;
}

// ---------------------------------------------------------------------------
// 1. Plain text → reference
// ---------------------------------------------------------------------------

function textNodeTransform(node: TextNode): void {
  if (!node.isSimpleText()) return;
  // Never re-detect inside a reference; rule 2 owns those.
  if ($isBibleRefNode(node.getParent())) return;

  const text = node.getTextContent();
  if (text.length < 4) return;

  for (const match of findRefs(text)) {
    const after = text[match.end];
    if (after === undefined || !BOUNDARY_RE.test(after)) continue;

    // Split the matched span out of this text node, then swap it for a
    // reference. Handling one match per pass is fine — the transform re-runs on
    // what's left until the tree settles.
    let target: TextNode;
    if (match.start === 0) {
      [target] = node.splitText(match.end);
    } else {
      [, target] = node.splitText(match.start, match.end);
    }
    if (!target) return;

    const refNode = $createBibleRefNode(
      match.canonical,
      match.book,
      match.chapter,
      match.verse,
      false,
    );
    // The label is canonicalised here: "lk 12:1" becomes "Luke 12:1".
    refNode.append($createTextNode(match.canonical));
    target.replace(refNode);
    return;
  }
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
  const whole = matches.find((m) => m.start === 0 && m.end === text.length);

  if (whole) {
    if (whole.canonical !== node.getRef()) {
      node.setTarget(whole.canonical, whole.book, whole.chapter, whole.verse);
    }
    return;
  }

  // No longer a clean reference — dissolve back into plain text. Rule 1 will
  // re-link whatever part of it still qualifies.
  const replacement = $createTextNode(text);
  node.insertBefore(replacement);
  node.remove();
  replacement.select(text.length, text.length);
}

/**
 * Wire both rules into an editor. Returns a teardown function.
 */
export function registerBibleRefTransforms(editor: LexicalEditor): () => void {
  const unregisterText = editor.registerNodeTransform(TextNode, textNodeTransform);
  const unregisterRef = editor.registerNodeTransform(BibleRefNode, refNodeTransform);
  return () => {
    unregisterText();
    unregisterRef();
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
