/**
 * How a transcript's words land on a notebook page, a piece at a time.
 *
 * Each piece comes as blocks: paragraphs, headings and numbered items. A
 * block that `joins` carries on the last one written, as long as that is
 * still the last thing on the page and still reads as it was written; if
 * the page was changed in between, it starts a new one rather than writing
 * into someone's own words.
 *
 * Two ways in: through the editor when the page is open in Notes
 * (LexicalEditor's appendBlocks), so the words appear as they come and the
 * editor's own save keeps them; otherwise straight into the page's saved
 * text, here.
 */

import type { TranscriptTail } from '../recorder/recordings';

export type { TranscriptTail };

export interface TranscriptBlock {
  kind: 'p' | 'h' | 'li';
  text: string;
  /** Carries on the last block written. */
  joins?: boolean;
  /**
   * An item's number, as said ("the second point"). A list that starts
   * after a paragraph starts at it, so the numbers carry on.
   */
  n?: number;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The page's last block element of this kind: a paragraph, a heading, or the last item of a closing numbered list. */
function lastOf(body: HTMLElement, kind: TranscriptBlock['kind']): HTMLElement | null {
  const last = body.lastElementChild as HTMLElement | null;
  if (!last) return null;
  if (kind === 'p') return last.tagName === 'P' ? last : null;
  if (kind === 'h') return /^H[1-6]$/.test(last.tagName) ? last : null;
  return last.tagName === 'OL' ? (last.lastElementChild as HTMLElement | null) : null;
}

/** The page's HTML with the blocks added at the end, and what the last of them now reads. */
export function appendBlocksToHtml(
  html: string,
  blocks: TranscriptBlock[],
  tail: TranscriptTail | null,
): { html: string; tail: TranscriptTail | null } {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const body = doc.body;
  // A page with nothing written on it is one empty paragraph.
  if (!squash(body.textContent ?? '')) body.innerHTML = '';
  let last = tail;
  for (const b of blocks) {
    if (!b.text.trim()) continue;
    const el = lastOf(body, b.kind);
    if (b.joins && last && last.kind === b.kind && el && squash(el.textContent ?? '') === squash(last.text)) {
      el.append(doc.createTextNode(' ' + b.text));
      last = { kind: b.kind, text: squash(last.text + ' ' + b.text) };
      continue;
    }
    if (b.kind === 'li') {
      let list = body.lastElementChild as HTMLElement | null;
      if (!list || list.tagName !== 'OL' || !last || last.kind !== 'li') {
        list = doc.createElement('ol');
        if (b.n && b.n > 1) list.setAttribute('start', String(b.n));
        body.append(list);
      }
      const li = doc.createElement('li');
      li.textContent = b.text;
      list.append(li);
    } else {
      const el2 = doc.createElement(b.kind === 'h' ? 'h2' : 'p');
      el2.textContent = b.text;
      body.append(el2);
    }
    last = { kind: b.kind, text: squash(b.text) };
  }
  return { html: body.innerHTML, tail: last };
}
