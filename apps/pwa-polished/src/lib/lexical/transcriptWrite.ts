/**
 * Where a recording's words land in the writing: just in front of its pill
 * (RecordingNode), a piece at a time, so the text that was after the cursor
 * stays after the new words. A page with no pill (one recorded before pills,
 * or whose pill was deleted by hand) gets them at the end instead, so
 * nothing is lost.
 *
 * One set of steps for both ways in: the open editor (LexicalEditor) runs
 * them on screen, and a page or journal entry that isn't open runs them on
 * its saved text through a headless editor here (editHtml), so the two come
 * out the same.
 *
 * A block that `joins` carries on the words just before the pill, as long as
 * they still read as the transcript left them (`tail`); if they were changed
 * in between, it starts a new block rather than writing into someone's own
 * words. The first piece written at a cursor carries on that line.
 */

import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  $setSelection,
  createEditor,
  type BaseSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  type RangeSelection,
} from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $createHeadingNode, $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, ListItemNode, ListNode } from '@lexical/list';
import { BibleRefNode } from './BibleRefNode';
import { $createRecordingNode, $isRecordingNode, RecordingNode } from './RecordingNode';
import type { TranscriptBlock, TranscriptTail } from '../voice/transcriptSink';

/** The writing editors' nodes and theme, so saved text written here matches what the editor writes. */
export const EDITOR_NODES = [BibleRefNode, RecordingNode, HeadingNode, ListNode, ListItemNode];

export const EDITOR_THEME = {
  paragraph: 'editor-paragraph',
  heading: { h1: 'editor-heading', h2: 'editor-heading', h3: 'editor-heading' },
  list: { ol: 'editor-ol', ul: 'editor-ul', listitem: 'editor-li' },
  text: {
    bold: 'editor-text-bold',
    italic: 'editor-text-italic',
    underline: 'editor-text-underline',
    strikethrough: 'editor-text-strikethrough',
    superscript: 'editor-text-superscript',
    subscript: 'editor-text-subscript',
  },
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

type BlockKind = TranscriptBlock['kind'];

// ── Finding the pill ────────────────────────────────────────────────────────

function $allNodes(): LexicalNode[] {
  const out: LexicalNode[] = [];
  const stack: LexicalNode[] = [$getRoot()];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    if ($isElementNode(n)) stack.push(...n.getChildren());
  }
  return out;
}

export function $findRecording(recId: string): RecordingNode | null {
  return ($allNodes().find((n) => $isRecordingNode(n) && n.getRecId() === recId) as RecordingNode | undefined) ?? null;
}

// ── Placing it ──────────────────────────────────────────────────────────────

/** A remembered caret whose nodes are all still there. */
function pointHolds(p: PointType): boolean {
  const node = $getNodeByKey(p.key);
  if (!node) return false;
  if (p.type === 'text') return $isTextNode(node) && p.offset <= node.getTextContentSize();
  return $isElementNode(node) && p.offset <= node.getChildrenSize();
}

/**
 * Drops a recording's pill at the caret: the live one, else `remembered`
 * (where it was before a button took it away), else the end of the page.
 * Picked-out text is kept, and the pill goes at its end. Never inside a
 * reference, which would break it: just after it.
 */
export function $placeRecording(recId: string, remembered: BaseSelection | null): void {
  if ($findRecording(recId)) return;
  const pill = $createRecordingNode(recId);
  let sel = $getSelection();
  if (!$isRangeSelection(sel) && $isRangeSelection(remembered) && pointHolds(remembered.anchor) && pointHolds(remembered.focus)) {
    sel = remembered.clone();
    $setSelection(sel);
  }
  if ($isRangeSelection(sel)) {
    try {
      collapseToEnd(sel);
      const at = sel.anchor.getNode();
      let wrapper: ElementNode | null = null;
      for (let p: LexicalNode | null = $isElementNode(at) ? at : at.getParent(); $isElementNode(p) && !$isRootOrShadowRoot(p) && p.isInline(); p = p.getParent()) {
        wrapper = p;
      }
      if (wrapper) wrapper.insertAfter(pill);
      else sel.insertNodes([pill]);
      if (pill.isAttached()) return;
    } catch {
      // A caret Lexical can't insert at: the end of the page instead.
    }
  }
  const root = $getRoot();
  const last = root.getLastChild();
  if ($isParagraphNode(last) && !squash(last.getTextContent()) && !last.getChildren().some($isDecoratorNode)) last.append(pill);
  else root.append($createParagraphNode().append(pill));
}

function collapseToEnd(sel: RangeSelection): void {
  if (sel.isCollapsed()) return;
  const end = sel.isBackward() ? sel.anchor : sel.focus;
  const { key, offset, type } = end;
  sel.anchor.set(key, offset, type);
  sel.focus.set(key, offset, type);
}

/** Takes a recording's pill out, keeping a space between the words either side of it. */
export function $removeRecording(recId: string): boolean {
  const pill = $findRecording(recId);
  if (!pill) return false;
  const block = pill.getParent();
  const prev = pill.getPreviousSibling();
  const next = pill.getNextSibling();
  pill.remove();
  if ($isTextNode(prev) && $isTextNode(next) && /\S$/.test(prev.getTextContent()) && /^[\p{L}\p{N}]/u.test(next.getTextContent())) {
    prev.setTextContent(prev.getTextContent() + ' ');
  }
  // A line that held only the pill goes with it, unless it's all there is.
  if ($isElementNode(block) && !$isRootOrShadowRoot(block) && block.getChildrenSize() === 0 && $getRoot().getChildrenSize() > 1) {
    const list = block.getParent();
    block.remove();
    if ($isListNode(list) && list.getChildrenSize() === 0) list.remove();
  }
  return true;
}

// ── Writing in front of it ──────────────────────────────────────────────────

function kindOf(node: ElementNode): BlockKind {
  if ($isHeadingNode(node)) return 'h';
  if ($isListItemNode(node)) return 'li';
  return 'p';
}

function newBlock(kind: BlockKind): ElementNode {
  return kind === 'h' ? $createHeadingNode('h2') : kind === 'li' ? $createListItemNode() : $createParagraphNode();
}

/** The block the pill sits in, once it's brought out of any reference around it. */
function $blockOf(pill: RecordingNode): ElementNode {
  let parent = pill.getParent();
  while (parent && !$isRootOrShadowRoot(parent) && parent.isInline()) {
    parent.insertAfter(pill);
    parent = pill.getParent();
  }
  if (!parent || $isRootOrShadowRoot(parent)) {
    const p = $createParagraphNode();
    pill.replace(p);
    p.append(pill);
    return p;
  }
  return parent;
}

/** The list an item belongs to, at the top level when lists are nested. */
function topList(item: ListItemNode): ListNode | null {
  let list = item.getParent();
  while ($isListNode(list) && $isListItemNode(list.getParent())) list = list.getParent()!.getParent();
  return $isListNode(list) ? list : null;
}

/**
 * Puts a new block straight after `block` in reading order. An item goes in
 * the same list, or a new numbered one; a paragraph or heading after an item
 * splits its list in two around it.
 */
function placeAfter(block: ElementNode, next: ElementNode, n?: number): void {
  if ($isListItemNode(next)) {
    if ($isListItemNode(block)) block.insertAfter(next);
    else block.insertAfter($createListNode('number', n && n > 1 ? n : 1).append(next));
    return;
  }
  if ($isListItemNode(block)) {
    const list = topList(block);
    if (list) {
      const top = block.getParent() === list ? block : null;
      const after = top ? top.getNextSiblings() : [];
      list.insertAfter(next);
      if (after.length) {
        const first = after[0];
        const start = $isListItemNode(first) ? first.getValue() : 1;
        next.insertAfter($createListNode(list.getListType(), start).append(...after));
      }
      return;
    }
  }
  block.insertAfter(next);
}

function $writeBefore(pill: RecordingNode, blocks: TranscriptBlock[], tail: TranscriptTail | null): TranscriptTail | null {
  let last = tail;
  for (const b of blocks) {
    if (!b.text.trim()) continue;
    const block = $blockOf(pill);
    const rawBefore = pill.getPreviousSiblings().map((n) => n.getTextContent()).join('');
    const before = squash(rawBefore);
    const carries = !!(b.joins && last && last.kind === b.kind && before && before.endsWith(squash(last.text)));
    // On the pill's own line: carrying on, a line with nothing before the
    // pill yet, or the first words said at a cursor.
    if (kindOf(block) === b.kind && (carries || !before || (last === null && b.kind === 'p'))) {
      const space = before && !/\s$/.test(rawBefore) ? ' ' : '';
      pill.insertBefore($createTextNode(space + b.text));
      last = { kind: b.kind, text: carries ? squash(last!.text + ' ' + b.text) : squash(b.text) };
      continue;
    }
    // A block of its own after the pill's. The pill goes along with the
    // words, and so does what followed it on its line, except under a
    // heading, where that keeps a line of its own.
    const post = pill.getNextSiblings();
    const next = newBlock(b.kind).append($createTextNode(b.text), pill);
    let rest: ElementNode | null = null;
    if (b.kind !== 'h') next.append(...post);
    else if (post.some((n) => !$isTextNode(n) || n.getTextContent().trim())) rest = $createParagraphNode().append(...post);
    placeAfter(block, next, b.n);
    if (rest) next.insertAfter(rest);
    if (block.isAttached() && block.getChildrenSize() === 0) {
      const list = block.getParent();
      block.remove();
      if ($isListNode(list) && list.getChildrenSize() === 0) list.remove();
    }
    last = { kind: b.kind, text: squash(b.text) };
  }
  return last;
}

/** At the end of the page: no pill to go in front of. */
function $appendBlocks(blocks: TranscriptBlock[], tail: TranscriptTail | null): TranscriptTail | null {
  const root = $getRoot();
  // A page with nothing on it but an empty line starts clean. Another
  // recording's pill counts as something.
  if (!squash(root.getTextContent()) && !$allNodes().some($isDecoratorNode)) root.clear();
  let last = tail;
  for (const b of blocks) {
    if (!b.text.trim()) continue;
    const end = root.getLastChild();
    // The block this one would carry on: the last paragraph, or the last item of a closing list.
    const prev =
      b.kind === 'p' && $isParagraphNode(end) ? end
      : b.kind === 'li' && $isListNode(end) ? end.getLastChild()
      : null;
    if (b.joins && last && last.kind === b.kind && $isElementNode(prev) && squash(prev.getTextContent()) === squash(last.text)) {
      prev.append($createTextNode(' ' + b.text));
      last = { kind: b.kind, text: squash(last.text + ' ' + b.text) };
      continue;
    }
    const text = $createTextNode(b.text);
    if (b.kind === 'h') {
      root.append($createHeadingNode('h2').append(text));
    } else if (b.kind === 'li') {
      const item = $createListItemNode().append(text);
      if ($isListNode(end) && end.getListType() === 'number' && last?.kind === 'li') end.append(item);
      else root.append($createListNode('number', b.n && b.n > 1 ? b.n : 1).append(item));
    } else {
      root.append($createParagraphNode().append(text));
    }
    last = { kind: b.kind, text: squash(b.text) };
  }
  return last;
}

/**
 * A transcript's next piece: in front of the recording's pill when it is
 * here, else at the end. Says what the last block now reads, and whether the
 * pill was found.
 */
export function $writeTranscript(
  recId: string | null,
  blocks: TranscriptBlock[],
  tail: TranscriptTail | null,
): { tail: TranscriptTail | null; found: boolean } {
  const pill = recId ? $findRecording(recId) : null;
  if (pill) return { tail: $writeBefore(pill, blocks, tail), found: true };
  return { tail: $appendBlocks(blocks, tail), found: false };
}

// ── Saved text ──────────────────────────────────────────────────────────────

let headless: LexicalEditor | null = null;

/**
 * Runs `fn` on saved text the way the editor would, and hands back the text
 * it leaves. Done in one go, with no screen.
 */
export function editHtml<T>(html: string, fn: () => T): { html: string; result: T } {
  headless ??= createEditor({
    namespace: 'JournalEditor',
    nodes: EDITOR_NODES,
    theme: EDITOR_THEME,
    onError: (err: Error) => console.error('[transcriptWrite]', err),
  });
  const editor = headless;
  let result!: T;
  let out = '';
  let failed: unknown = null;
  editor.update(
    () => {
      try {
        const dom = new DOMParser().parseFromString(html || '', 'text/html');
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        root.selectEnd();
        $insertNodes(nodes);
        $setSelection(null);
        result = fn();
        out = $generateHtmlFromNodes(editor, null);
      } catch (err) {
        failed = err;
      }
    },
    { discrete: true },
  );
  if (failed) throw failed;
  return { html: out, result };
}

/** Whether saved text holds a recording's pill, without loading an editor. */
export function htmlHasRecording(html: string, recId: string): boolean {
  if (!html || !html.includes('data-rec')) return false;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('span[data-rec]')].some((el) => el.getAttribute('data-rec') === recId);
}
