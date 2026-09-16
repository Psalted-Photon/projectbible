/**
 * Who worked on which paragraph.
 *
 * A shared page carries, on each of its paragraphs, a short id of its own and
 * the list of people who have written in it. The reader draws that list as
 * pills in a gutter beside the line, so a page several people have worked on
 * reads like a page several people have worked on rather than like a group
 * chat with no names on it.
 *
 * ── How the stamping works ───────────────────────────────────────────────────
 *
 * On every save the stored version of the page is compared with the one being
 * saved, paragraph by paragraph:
 *
 *   - a paragraph whose text is unchanged keeps its id and its pills exactly;
 *   - a paragraph that was rewritten keeps its id and gains the saver, if the
 *     saver is not already on it;
 *   - a brand-new paragraph gets a new id and starts with just the saver;
 *   - a paragraph that has gone, goes.
 *
 * None of that is a diff of anybody's prose. It works precisely *because*
 * only one person can be editing a page at a time (phase 5's lock), so two
 * people's edits never interleave inside one paragraph.
 *
 * ── Why the ids are not carried through the editor ───────────────────────────
 *
 * The obvious design is to keep `data-pid` on the paragraph all the way round
 * the loop and match on it. Lexical will not do that: its ParagraphNode has a
 * fixed set of attributes and every other one is dropped the moment the HTML
 * is parsed into the editor, so the ids would come back missing and every
 * paragraph would look brand-new. Teaching Lexical to keep them means a node
 * replacement inside an editor four other surfaces share, to hold data only
 * this one uses.
 *
 * So the ids never go near the editor. The stored page is the only place they
 * live, and the paragraphs of the saved version are lined up against it here:
 * first the ones whose text still matches, in order, which anchors everything
 * that was not touched; then the gaps between those anchors, paired off in
 * order, which is where the rewritten paragraphs are. Editing one line in the
 * middle of a page leaves every other line anchored, so exactly one paragraph
 * is touched — which is the answer matching on an id would have given.
 *
 * ── Its honest limit ─────────────────────────────────────────────────────────
 *
 * All of this happens on the writer's device, so it is a record of who worked
 * on a line rather than proof of it. Which account created a page and which
 * account saved it last come from the server and can be trusted. Within a
 * study group that is the right trade, and it is worth knowing before it is
 * relied on for anything weightier.
 */

import { paragraphId } from './ids';

/** Matches the sanitiser's cap, so a list built here is never trimmed there. */
const MAX_PILLS = 16;

/** The same shape the sanitiser accepts for an id in `data-pills`. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One top-level block of a page, ready to be drawn with its gutter. */
export interface PageBlock {
  /** The block's own markup, exactly as it was in the page. */
  html: string;
  /** The people who have written in it, first author first. Often empty. */
  pills: string[];
}

function normalizeText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function readPills(el: Element): string[] {
  const raw = el.getAttribute('data-pills') ?? '';
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!id || seen.has(id) || !SAFE_ID.test(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, MAX_PILLS);
}

/**
 * Add the saver to a paragraph's list, keeping the first author first.
 *
 * Past the cap the earliest names are the ones worth keeping — the first
 * author most of all — but the person who just typed has to appear or the
 * gutter is lying about the line in front of them, so they take the last
 * place. Sixteen people on one paragraph is not a situation anybody is
 * actually in; this is here so it degrades sensibly rather than silently.
 */
function withSaver(pills: string[], saverId: string): string[] {
  if (pills.includes(saverId)) return pills;
  if (pills.length < MAX_PILLS) return [...pills, saverId];
  return [...pills.slice(0, MAX_PILLS - 1), saverId];
}

/** The top-level paragraphs of a page, in order. Nothing else is stamped. */
function paragraphsOf(root: Element): HTMLElement[] {
  return Array.from(root.children).filter(
    (el) => el.tagName.toLowerCase() === 'p',
  ) as HTMLElement[];
}

/**
 * Stamp the version being saved against the version already stored.
 *
 * `previousHtml` is what the server last had — the only place the ids live.
 * `nextHtml` is what the editor produced, which never carries them. The
 * `saverId` is a plain account id; anything else and the text comes back
 * untouched, because a pill nobody can be looked up by is worse than none.
 */
export function stampParagraphs(
  previousHtml: string,
  nextHtml: string,
  saverId: string,
): string {
  if (typeof nextHtml !== 'string' || nextHtml === '') return nextHtml ?? '';
  if (!saverId || !SAFE_ID.test(saverId)) return nextHtml;
  if (typeof DOMParser === 'undefined') return nextHtml;

  const parser = new DOMParser();
  const nextBody = parser.parseFromString(nextHtml, 'text/html').body;
  if (!nextBody) return nextHtml;

  const next = paragraphsOf(nextBody);
  if (next.length === 0) return nextHtml;

  const prevBody = parser.parseFromString(previousHtml || '', 'text/html').body;
  const prev = (prevBody ? paragraphsOf(prevBody) : []).map((el) => ({
    pid: el.getAttribute('data-pid') ?? '',
    pills: readPills(el),
    text: normalizeText(el),
  }));

  // Pass one: the paragraphs nobody touched. Matched in order and each stored
  // paragraph used once, so a page with two identical lines still lines up.
  const matchedTo: (number | null)[] = next.map(() => null);
  let cursor = 0;
  for (let i = 0; i < next.length; i++) {
    const text = normalizeText(next[i]);
    for (let j = cursor; j < prev.length; j++) {
      if (prev[j].text === text) {
        matchedTo[i] = j;
        cursor = j + 1;
        break;
      }
    }
  }

  // Pass two: what lies between the anchors. A run of unmatched new paragraphs
  // sitting between the same two anchors as a run of unclaimed stored ones is
  // those same lines rewritten, so they pair off in order; anything left over
  // on the new side is a line that was added, and on the stored side, removed.
  const claimed = new Set(matchedTo.filter((j): j is number => j !== null));
  const spare: number[] = [];
  for (let j = 0; j < prev.length; j++) if (!claimed.has(j)) spare.push(j);

  const stamped: { pid: string; pills: string[] }[] = [];
  /** The stored index of the anchor before the run being filled. */
  let lowerBound = -1;
  let runStart = 0;

  function fillRun(end: number, upperBound: number) {
    // The stored paragraphs that sat between these two anchors, in order.
    const between = spare.filter((j) => j > lowerBound && j < upperBound);
    for (let k = runStart; k < end; k++) {
      const partner = between[k - runStart];
      const isEmpty = normalizeText(next[k]) === '';
      if (partner !== undefined) {
        // Rewritten: the line kept its place, so it keeps its history and
        // gains whoever rewrote it.
        stamped[k] = {
          pid: prev[partner].pid || paragraphId(),
          pills: isEmpty ? prev[partner].pills : withSaver(prev[partner].pills, saverId),
        };
      } else {
        // Added. A blank line gets an id but no pill — a pill floating beside
        // nothing claims somebody wrote an emptiness.
        stamped[k] = { pid: paragraphId(), pills: isEmpty ? [] : [saverId] };
      }
    }
  }

  for (let i = 0; i < next.length; i++) {
    const j = matchedTo[i];
    if (j === null) continue;
    fillRun(i, j);
    stamped[i] = { pid: prev[j].pid || paragraphId(), pills: prev[j].pills };
    lowerBound = j;
    runStart = i + 1;
  }
  fillRun(next.length, prev.length);

  for (let i = 0; i < next.length; i++) {
    const el = next[i];
    const mark = stamped[i];
    el.setAttribute('data-pid', mark.pid);
    if (mark.pills.length) el.setAttribute('data-pills', mark.pills.join(','));
    else el.removeAttribute('data-pills');
  }

  return nextBody.innerHTML;
}

/**
 * Split a page into the blocks the reader draws, each with its pills.
 *
 * Top-level elements only, and whatever is not a paragraph — the editor emits
 * very little else — comes through with no pills rather than being dropped.
 * Stray text directly under the body is wrapped so it cannot vanish.
 */
export function splitPageBlocks(html: string): PageBlock[] {
  if (typeof html !== 'string' || html === '') return [];
  if (typeof DOMParser === 'undefined') return [{ html, pills: [] }];

  const body = new DOMParser().parseFromString(html, 'text/html').body;
  if (!body) return [];

  const blocks: PageBlock[] = [];
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      blocks.push({ html: el.outerHTML, pills: readPills(el) });
    } else if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) {
      const p = document.createElement('p');
      p.className = 'editor-paragraph';
      p.textContent = node.textContent ?? '';
      blocks.push({ html: p.outerHTML, pills: [] });
    }
  }
  return blocks;
}
