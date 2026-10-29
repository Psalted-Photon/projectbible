/**
 * RecordingNode — a recording's place in the writing.
 *
 * Record drops one at the cursor as a small pill. When the recording is
 * written out (lib/voice/transcribe.ts), the words go in just in front of it,
 * so it rides along at the end of them, and a recording that is kept stays
 * behind as a "▶ 0:42" chip.
 *
 * Only the recording's id is saved, as an empty <span data-rec>, so the
 * page's text, search and previews never see a label. What the pill says is
 * painted from this device's own state (lib/recorder/recordingChips.ts):
 * recording, waiting its turn, writing, its length, locked, or on another
 * device.
 *
 * A decorator rather than BibleRefNode's element: the editor leaves a
 * decorator's inside alone, so the label can change without an edit, and it
 * can't be typed into. It is selected and deleted as one piece.
 */

import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { paintChip } from '../recorder/recordingChips';

export type SerializedRecordingNode = Spread<{ rec: string }, SerializedLexicalNode>;

export class RecordingNode extends DecoratorNode<null> {
  /** The recording's id in lib/recorder/recordings.ts. */
  __rec: string;

  static getType(): string {
    return 'recording';
  }

  static clone(node: RecordingNode): RecordingNode {
    return new RecordingNode(node.__rec, node.__key);
  }

  constructor(rec: string, key?: NodeKey) {
    super(key);
    this.__rec = rec;
  }

  getRecId(): string {
    return this.getLatest().__rec;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    paintChip(span, this.__rec);
    return span;
  }

  /** Never true: the label is repainted in place, and the id never changes. */
  updateDOM(): boolean {
    return false;
  }

  /** Just the id: the label belongs to this device, not to the page. */
  exportDOM(): DOMExportOutput {
    const span = document.createElement('span');
    span.setAttribute('data-rec', this.__rec);
    return { element: span };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-rec')) return null;
        return { conversion: convertRecordingSpan, priority: 3 };
      },
    };
  }

  // ── Serialization ────────────────────────────────────────────────────────

  static importJSON(json: SerializedRecordingNode): RecordingNode {
    return $createRecordingNode(json.rec);
  }

  exportJSON(): SerializedRecordingNode {
    return { ...super.exportJSON(), type: 'recording', version: 1, rec: this.__rec };
  }

  // ── Behavior ────────────────────────────────────────────────────────────

  isInline(): boolean {
    return true;
  }

  getTextContent(): string {
    return '';
  }

  decorate(): null {
    return null;
  }
}

function convertRecordingSpan(domNode: HTMLElement): DOMConversionOutput {
  return { node: $createRecordingNode(domNode.getAttribute('data-rec') ?? '') };
}

export function $createRecordingNode(rec: string): RecordingNode {
  return new RecordingNode(rec);
}

export function $isRecordingNode(node: LexicalNode | null | undefined): node is RecordingNode {
  return node instanceof RecordingNode;
}
