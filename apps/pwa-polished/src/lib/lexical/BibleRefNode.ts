/**
 * BibleRefNode — a Bible reference the editor understands as one thing.
 *
 * Why a custom node at all: the editor rebuilds its HTML from its own node tree
 * on every keystroke. A plain <span> injected into stored HTML is therefore
 * stripped on the first edit, and autosave writes the stripped version back. A
 * reference has to be a node or it cannot survive being typed near.
 *
 * Collapsed, the node holds one text child — the canonical reference, editable,
 * re-checked after every keystroke by the transform in bibleRefTransforms.
 *
 * Expanded, it holds a second child with the verse text, and BOTH children are
 * switched to 'token' mode: selectable and copyable and deletable as a unit,
 * but impossible to type inside. A verse printed in a note must be the verse.
 */

import {
  ElementNode,
  $createTextNode,
  $isTextNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  type TextNode,
} from 'lexical';
import { getBookColor } from '../bibleData';

export type SerializedBibleRefNode = Spread<
  { ref: string; expanded: boolean; book: string; chapter: number; verse: number },
  SerializedElementNode
>;

export class BibleRefNode extends ElementNode {
  /** Canonical reference, e.g. "Luke 12:1" or "Luke 12". */
  __ref: string;
  __book: string;
  __chapter: number;
  __verse: number;
  __expanded: boolean;

  static getType(): string {
    return 'bible-ref';
  }

  static clone(node: BibleRefNode): BibleRefNode {
    return new BibleRefNode(
      node.__ref,
      node.__book,
      node.__chapter,
      node.__verse,
      node.__expanded,
      node.__key,
    );
  }

  constructor(
    ref: string,
    book: string,
    chapter: number,
    verse: number,
    expanded = false,
    key?: NodeKey,
  ) {
    super(key);
    this.__ref = ref;
    this.__book = book;
    this.__chapter = chapter;
    this.__verse = verse;
    this.__expanded = expanded;
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  getRef(): string {
    return this.getLatest().__ref;
  }

  getBook(): string {
    return this.getLatest().__book;
  }

  getChapter(): number {
    return this.getLatest().__chapter;
  }

  getVerse(): number {
    return this.getLatest().__verse;
  }

  isExpanded(): boolean {
    return this.getLatest().__expanded;
  }

  /** True when the reference named only a chapter — nothing single to expand. */
  isChapterOnly(): boolean {
    return !this.getLatest().__ref.includes(':');
  }

  setTarget(ref: string, book: string, chapter: number, verse: number): void {
    const self = this.getWritable();
    self.__ref = ref;
    self.__book = book;
    self.__chapter = chapter;
    self.__verse = verse;
  }

  /**
   * Mid-edit and not resolving to anything — "Acts " with the numbers deleted.
   * The link holds together so retyping brings it back, but it points nowhere,
   * so it can never navigate to where it used to go.
   */
  clearTarget(): void {
    const self = this.getWritable();
    self.__ref = '';
    self.__chapter = 0;
    self.__verse = 0;
  }

  hasTarget(): boolean {
    return this.getLatest().__ref !== '';
  }

  setExpanded(expanded: boolean): void {
    this.getWritable().__expanded = expanded;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    this.applyAttrs(span);
    return span;
  }

  updateDOM(prev: BibleRefNode, dom: HTMLElement): boolean {
    if (prev.__ref !== this.__ref || prev.__expanded !== this.__expanded) {
      this.applyAttrs(dom);
    }
    // Never true: recreating the element mid-edit would disturb the caret.
    return false;
  }

  private applyAttrs(el: HTMLElement): void {
    // `is-pending` is a link mid-edit with nothing to point at yet. It keeps the
    // reference colour so it still reads as one piece, but drops the underline
    // and is not clickable.
    const classes = ['bible-ref'];
    if (this.__expanded) classes.push('is-expanded');
    if (this.__ref === '') classes.push('is-pending');
    el.className = classes.join(' ');
    el.style.setProperty('--ref-color', getBookColor(this.__book));
    el.setAttribute('data-ref', this.__ref);
    el.setAttribute('data-book', this.__book);
    el.setAttribute('data-chapter', String(this.__chapter));
    el.setAttribute('data-verse', String(this.__verse));
    if (this.__expanded) el.setAttribute('data-expanded', 'true');
    else el.removeAttribute('data-expanded');
    el.setAttribute('role', 'link');
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement('span');
    this.applyAttrs(element);
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-ref')) return null;
        return { conversion: convertBibleRefSpan, priority: 2 };
      },
    };
  }

  // ── Serialization ────────────────────────────────────────────────────────

  static importJSON(json: SerializedBibleRefNode): BibleRefNode {
    return $createBibleRefNode(
      json.ref,
      json.book,
      json.chapter,
      json.verse,
      json.expanded,
    );
  }

  exportJSON(): SerializedBibleRefNode {
    return {
      ...super.exportJSON(),
      type: 'bible-ref',
      version: 1,
      ref: this.__ref,
      book: this.__book,
      chapter: this.__chapter,
      verse: this.__verse,
      expanded: this.__expanded,
    };
  }

  // ── Behaviour ────────────────────────────────────────────────────────────

  isInline(): boolean {
    return true;
  }

  /**
   * While collapsed the reference is ordinary editable text, so typing at
   * either end has to land INSIDE it — otherwise correcting "Romans 15" to
   * "Romans 16" drops the 6 outside the link, and the re-check transform never
   * sees the edit it is supposed to react to.
   *
   * While expanded the whole thing is locked, so both ends are closed.
   */
  canInsertTextBefore(): boolean {
    return !this.isExpanded();
  }

  canInsertTextAfter(): boolean {
    return !this.isExpanded();
  }

  /** An emptied reference is no reference — let Lexical clean it up. */
  canBeEmpty(): boolean {
    return false;
  }

  extractWithChild(): boolean {
    return true;
  }
}

function convertBibleRefSpan(domNode: HTMLElement): DOMConversionOutput {
  const ref = domNode.getAttribute('data-ref') ?? '';
  const book = domNode.getAttribute('data-book') ?? '';
  const chapter = parseInt(domNode.getAttribute('data-chapter') ?? '1', 10) || 1;
  const verse = parseInt(domNode.getAttribute('data-verse') ?? '1', 10) || 1;
  const expanded = domNode.getAttribute('data-expanded') === 'true';
  return { node: $createBibleRefNode(ref, book, chapter, verse, expanded) };
}

export function $createBibleRefNode(
  ref: string,
  book: string,
  chapter: number,
  verse: number,
  expanded = false,
): BibleRefNode {
  return new BibleRefNode(ref, book, chapter, verse, expanded);
}

export function $isBibleRefNode(node: LexicalNode | null | undefined): node is BibleRefNode {
  return node instanceof BibleRefNode;
}

/** The reference label itself — always the node's first text child. */
export function $getRefDisplayNode(node: BibleRefNode): TextNode | null {
  const first = node.getFirstChild();
  return $isTextNode(first) ? first : null;
}

/** The verse text child, present only while expanded. */
export function $getRefVerseNode(node: BibleRefNode): TextNode | null {
  const children = node.getChildren();
  const second = children[1];
  return $isTextNode(second) ? second : null;
}

/** Build the children for a collapsed reference. */
export function $fillCollapsed(node: BibleRefNode): void {
  node.clear();
  node.append($createTextNode(node.getRef()));
}
