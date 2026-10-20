/**
 * isbeFormat — dresses up an ISBE article for reading without changing a word.
 *
 * The source is a flat run of <p> elements with almost no formatting of its
 * own, so the reader gets walls of same-size text. This adds structure the
 * eye can use — a pronunciation line, a word-origins panel, heading sizes,
 * bold and italic lead-ins, a byline — purely by wrapping text in spans and
 * putting classes on paragraphs. No letter, space or punctuation mark is
 * added, removed or moved: formatArticle checks that, and hands back the
 * article untouched if anything got through.
 *
 * It works on strings only, with no page access, so the same code runs in the
 * app and in a Node check script over the whole pack.
 */

// --- Article structure, shared with IsbeContent ---------------------------

export const P_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
// Same heading shape buildOutline uses in scripts/build-isbe-pack.mjs, minus
// its 120-item cap (which left Jerusalem's last three sections unreachable).
export const HEAD_RE = /^((?:[IVXLC]+|\d+)\.)\s+(.{1,70}?)(?:[.:]|$)/;

export function paraText(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function headingOf(text: string): { level: 1 | 2; title: string } | null {
  // Headings occupy a paragraph of their own, so anything long is prose that
  // merely happens to open with a number.
  if (text.length > 100) return null;
  const m = text.match(HEAD_RE);
  if (!m || !/[A-Za-z]/.test(m[2]) || m[2] !== m[2].replace(/\s{2,}/g, " ")) return null;
  // A byline is not a section: "C. H. Thomson" and "I. M. Price" open with
  // what look like roman numerals. No article runs to section C or L, and a
  // title is never a lone initial.
  if (/^[IVXLC]/.test(m[1]) && (!/^X{0,3}(?:IX|IV|V?I{0,3})\.$/.test(m[1]) || /^[A-Z]$/.test(m[2]))) {
    return null;
  }
  return { level: /^\d/.test(m[1]) ? 2 : 1, title: `${m[1]} ${m[2].trim()}` };
}

// Titles differ in case and trailing punctuation between the contents block
// ("I. THE NAME") and the body ("I. The Name."), so compare them loosely.
export function normTitle(t: string): string {
  return t.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

// --- Paragraph model ------------------------------------------------------
// A paragraph is read into its text, with the HTML offset of every character
// and the element each character sits in. Formatting is a list of marks over
// that text; rendering walks the original HTML and slips the marks' tags in
// between characters, so the text itself can only come out as it went in.

type Mark = {
  start: number;
  /** Exclusive. */
  end: number;
  open: string;
  close: string;
  /** A line or panel: never split, and never inside an inline mark. */
  block: boolean;
  rank: number;
};

type Para = {
  /** The <p ...> tag as written. */
  tag: string;
  inner: string;
  text: string;
  /** HTML offset of each text character. */
  pos: number[];
  /** Which element each character sits in; 0 is the paragraph itself. */
  box: number[];
  classes: string[];
  marks: Mark[];
};

const VOID_RE = /^<(?:br|hr|img|wbr)\b/i;

function readPara(tag: string, inner: string): Para {
  let text = "";
  const pos: number[] = [];
  const box: number[] = [];
  const stack = [0];
  let nextBox = 1;
  for (let i = 0; i < inner.length; ) {
    if (inner[i] === "<") {
      const j = inner.indexOf(">", i);
      if (j > i) {
        const t = inner.slice(i, j + 1);
        if (t[1] === "/") {
          if (stack.length > 1) stack.pop();
        } else if (!VOID_RE.test(t) && !t.endsWith("/>")) {
          stack.push(nextBox++);
        }
        i = j + 1;
        continue;
      }
    }
    pos.push(i);
    box.push(stack[stack.length - 1]);
    text += inner[i];
    i++;
  }
  return { tag, inner, text, pos, box, classes: [], marks: [] };
}

/** Would a tag at text offset k land inside an entity such as &amp;? */
function splitsEntity(text: string, k: number): boolean {
  const amp = text.lastIndexOf("&", k - 1);
  return amp >= 0 && k - amp <= 8 && /^&#?[a-zA-Z0-9]*$/.test(text.slice(amp, k));
}

function crosses(a: Mark, b: { start: number; end: number }): boolean {
  return (a.start < b.start && b.start < a.end && a.end < b.end)
    || (b.start < a.start && a.start < b.end && b.end < a.end);
}

function tryMark(p: Para, m: Mark): boolean {
  if (m.end <= m.start || splitsEntity(p.text, m.start) || splitsEntity(p.text, m.end)) return false;
  for (const o of p.marks) {
    if (crosses(o, m)) return false;
    // A line can't sit inside an inline mark.
    if (o.block && !m.block && m.start <= o.start && o.end <= m.end
      && !(m.start === o.start && m.end === o.end)) return false;
  }
  p.marks.push(m);
  return true;
}

/**
 * Wrap text [start, end) in a span. A wrap that would cross an element's edge
 * — starting outside a link and ending inside it — is invalid HTML, so an
 * inline one is applied piece by piece instead, and a block one not at all.
 */
function mark(p: Para, start: number, end: number, cls: string, block = false): boolean {
  while (start < end && /\s/.test(p.text[start])) start++;
  while (end > start && /\s/.test(p.text[end - 1])) end--;
  if (end <= start) return false;
  const make = (s: number, e: number): Mark => ({
    start: s, end: e, open: `<span class="${cls}">`, close: "</span>", block, rank: p.marks.length,
  });
  if (p.box[start] === p.box[end - 1] && sameBoxThrough(p, start, end)) {
    return tryMark(p, make(start, end));
  }
  if (block) return false;
  let any = false;
  let s = start;
  for (let k = start + 1; k <= end; k++) {
    if (k === end || p.box[k] !== p.box[s] || p.pos[k] !== p.pos[k - 1] + 1) {
      if (p.text.slice(s, k).trim()) any = tryMark(p, make(s, k)) || any;
      s = k;
    }
  }
  return any;
}

/**
 * Same element at both ends isn't quite enough: the range must not leave that
 * element and come back. Box ids are handed out in order, so leaving shows up
 * as a character in a lower-numbered box than the start's.
 */
function sameBoxThrough(p: Para, start: number, end: number): boolean {
  const b = p.box[start];
  for (let k = start; k < end; k++) if (p.box[k] < b) return false;
  return true;
}

function renderPara(p: Para): string {
  let tag = p.tag;
  if (p.classes.length) {
    const cls = p.classes.join(" ");
    tag = /\bclass="/.test(tag)
      ? tag.replace(/\bclass="([^"]*)"/, (_, c) => `class="${c} ${cls}"`)
      : tag.replace(/^<p\b/, `<p class="${cls}"`);
  }
  if (!p.marks.length) return tag + p.inner + "</p>";

  const opens = new Map<number, Mark[]>();
  const closes = new Map<number, Mark[]>();
  for (const m of p.marks) {
    (opens.get(m.start) ?? opens.set(m.start, []).get(m.start)!).push(m);
    (closes.get(m.end) ?? closes.set(m.end, []).get(m.end)!).push(m);
  }
  // Outer marks open first and close last; for an identical range, the one
  // added first is the outer one.
  for (const list of opens.values()) list.sort((a, b) => b.end - a.end || a.rank - b.rank);
  for (const list of closes.values()) list.sort((a, b) => b.start - a.start || b.rank - a.rank);

  let out = "";
  let k = 0;
  const shut = () => {
    const list = closes.get(k);
    if (list) {
      for (const m of list) out += m.close;
      closes.delete(k);
    }
  };
  for (let i = 0; i < p.inner.length; ) {
    if (k < p.pos.length && i === p.pos[k]) {
      shut();
      for (const m of opens.get(k) ?? []) out += m.open;
      out += p.inner[i];
      i++;
      k++;
    } else {
      // A run of tags. Marks ending here close before it, marks starting at
      // the next character open after it.
      shut();
      const to = k < p.pos.length ? p.pos[k] : p.inner.length;
      out += p.inner.slice(i, to);
      i = to;
    }
  }
  shut();
  return tag + out + "</p>";
}

// --- Rules ----------------------------------------------------------------

/** Called once per rule that fired, with a short sample of what it touched. */
export type FormatReport = (rule: string, sample: string) => void;

type Ctx = { paras: Para[]; report?: FormatReport };

function applyRules(ctx: Ctx): void {
  formatOpening(ctx);
  formatStructure(ctx);
}

/** The text of [start, end), shortened for a report line. */
function clip(p: Para, start: number, end: number, max = 160): string {
  const t = p.text.slice(start, end).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// --- The opening ----------------------------------------------------------
// Most articles open "de-fil', de-fil'-ment (where the word comes from): the
// definition…". The respelled pronunciation gets a line of its own, and the
// parenthesis after it — the word origins — a panel.

// Respelled words are lowercase and carry stress marks and hyphens:
// "beth'-el", "klo'-di-us lis'-i-as", "vur'-jin; vur-jin'-i-ti".
const PRON_WORD = "[a-z][a-z'`\\-]*";
const PRON_GROUP = `${PRON_WORD}(?: ${PRON_WORD})*`;
// It ends at punctuation followed by a space, runs into the parenthesis, or —
// when its last word is visibly respelled — just stops ("mi'-ter In the King
// James Version…"). It is tried longest first, so "e'-so-ra, the King James
// Version…" settles on "e'-so-ra," once "the King" fails to fit.
const PRON_RE = new RegExp(
  `^(${PRON_GROUP}(?:[,;] ${PRON_GROUP})*)`
    + "(?:([:.,;])(?=\\s|$)|(?=\\s*\\(|$)|(?<=['`\\-][a-z]*)(?=\\s))",
);
/** Past this, a panel is broken onto a line per root. */
const LONG_PANEL = 200;

function formatOpening({ paras, report }: Ctx): void {
  const p = paras.find((x) => x.text.trim());
  if (!p) return;
  let at = p.text.search(/\S/);

  const rest = p.text.slice(at);
  const pron = PRON_RE.exec(rest);
  // Plain words with no stress marks ("grasp:", "strat stret.", "oil tre (")
  // count only when they end the way a respelling does: on a colon or stop,
  // or at the parenthesis. A lowercase phrase trailing off into a comma is
  // prose.
  const firm = !!pron
    && (pron[2] ? /[:.]/.test(pron[2]) : /^\s*\(|^$/.test(rest.slice(pron[0].length)));
  if (pron && (/['`-]/.test(pron[1]) || firm || !/[ ,;]/.test(pron[1]))) {
    const end = at + pron[0].length;
    if (mark(p, at, end, "isbe-pron", true)) {
      report?.("pronunciation", clip(p, at, end));
      at = end;
    }
  }

  // The parenthesis straight after the pronunciation (or opening the article).
  const open = at + (p.text.slice(at).search(/\S/) >>> 0);
  let panelEnd = -1;
  if (p.text[open] === "(") {
    let depth = 0;
    for (let k = open; k < p.text.length; k++) {
      if (p.box[k] !== p.box[open]) continue;
      if (p.text[k] === "(") depth++;
      else if (p.text[k] === ")" && --depth === 0) {
        panelEnd = k + 1;
        break;
      }
    }
  }
  if (panelEnd > 0) {
    // The colon after it ends the panel's line, rather than starting the
    // definition's.
    const tail = /^ ?[:.]/.exec(p.text.slice(panelEnd));
    if (tail) panelEnd += tail[0].length;
    const long = panelEnd - open > LONG_PANEL;
    if (mark(p, open, panelEnd, long ? "isbe-origin isbe-roots" : "isbe-origin", true)) {
      report?.(long ? "origins panel (long)" : "origins panel (short)", clip(p, open, panelEnd));
      if (long) splitRoots(p, open, panelEnd, report);
      at = panelEnd;
    }
  }

  if (at > 0) {
    p.classes.push("isbe-open");
    // Nothing but pronunciation and word origins: the Overview shows the first
    // real paragraph with it.
    if (!p.text.slice(at).trim()) {
      p.classes.push("isbe-bare");
      report?.("opening is bare", clip(p, 0, at));
    }
  }
}

/**
 * DEFILE's panel lists nine Hebrew roots and six Greek ones in a single run.
 * It is broken after its "…9 Hebrew roots (…six):" line, then at each
 * semicolon between roots — only the panel's own, never one inside a nested
 * parenthesis — and each root's transliterated word is set bold italic.
 */
function splitRoots(p: Para, start: number, end: number, report?: FormatReport): void {
  const breaks: { at: number; root: boolean }[] = [];
  let depth = 0;
  let colonSeen = false;
  // Only the panel's own text counts: "Isa 51:6" inside a link is no colon.
  const own = (k: number) => p.box[k] === p.box[start];
  for (let k = start + 1; k < end - 1; k++) {
    if (!own(k)) continue;
    const c = p.text[k];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (depth !== 0) continue;
    const before = p.text.slice(start + 1, k).trimEnd();
    // "1 Macc 10:46" is a reference, not the end of a line.
    if (c === ":" && /^(?:\s|$)/.test(p.text.slice(k + 1, k + 2)) && (!colonSeen || before.endsWith(")"))) {
      // The first colon ends the intro line; a later "…Greek roots (…, 4):"
      // starts a new list.
      colonSeen = true;
      breaks.push({ at: k + 1, root: true });
    } else if (c === ";" && colonSeen) {
      breaks.push({ at: k + 1, root: true });
    } else if (c === "." && /^ [A-Z][a-z]/.test(p.text.slice(k + 1, k + 4)) && /[)"]$/.test(before)) {
      // "…margin "consecrated"). They also render 6 (…) Greek roots": a new
      // sentence is a new intro line.
      breaks.push({ at: k + 1, root: false });
    }
  }
  // No colon to introduce the list: the semicolons alone separate the roots.
  if (!colonSeen) {
    depth = 0;
    for (let k = start + 1; k < end - 1; k++) {
      if (!own(k)) continue;
      const c = p.text[k];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === ";" && depth === 0) breaks.push({ at: k + 1, root: true });
    }
    breaks.sort((a, b) => a.at - b.at);
  }
  if (!breaks.length) return;

  const lines: string[] = [];
  let from = start;
  // With no intro line, the panel opens straight on its first root.
  let root = !colonSeen;
  for (const b of [...breaks, { at: end, root: false }]) {
    if (mark(p, from, b.at, "isbe-line", true)) {
      lines.push(clip(p, from, b.at, 70));
      if (root) markRootWord(p, from, b.at, report);
    }
    from = b.at;
    root = b.root;
  }
  report?.("origins split into lines", lines.join(" ⏎ "));
}

// Transliterations are lowercase, or open with ISBE's capital T for teth
// ("Tame'", "Tanaph"): "ga`al, \"defile\"", "miaino, miasma, miasmos, \"stain\"".
const ROOT_WORD = "(?:[a-z`']|T[a-z])[A-Za-z`'\-]*";
const ROOT_WORDS_RE = new RegExp(`^(${ROOT_WORD}(?:, ${ROOT_WORD})*)(?=[,:])`);
/** English that can head a line in place of a root. */
const NOT_ROOTS = new Set([
  "etc", "literally", "also", "compare", "or", "and", "the", "from", "verb", "noun",
  "see", "so", "in", "of", "to", "with", "used", "but", "as", "for", "is", "was",
]);

function markRootWord(p: Para, start: number, end: number, report?: FormatReport): void {
  const lead = p.text.slice(start, end).search(/[^\s(]/);
  if (lead < 0) return;
  const line = p.text.slice(start + lead, end);
  const m = ROOT_WORDS_RE.exec(line);
  if (!m) return;
  // "koinos, etc., …" — the list stops at the first English word.
  const words = m[1].split(", ");
  const stop = words.findIndex((w) => NOT_ROOTS.has(w.toLowerCase()));
  const text = (stop < 0 ? words : words.slice(0, stop)).join(", ");
  if (!text) return;
  // A root comes with its meaning in quotes ("ga`al, \"defile\""), or looks
  // transliterated itself ("Tame', the principal root").
  const rest = line.slice(text.length);
  if (!/^(?:, etc\.)?[,:] "/.test(rest) && !/[`']/.test(text)) return;
  const s = start + lead;
  if (mark(p, s, s + text.length, "isbe-tw")) report?.("root word", text);
}

// --- Headings and lead-ins -----------------------------------------------

/**
 * The paragraph's heading level, if it is a heading. Besides the "I." and
 * "1." shapes, a short paragraph underlined whole in the source ("Regard for
 * Old Age:", "B. IN WORSHIP") is a heading too.
 */
export function paraHeading(inner: string): 1 | 2 | null {
  const text = paraText(inner).replace(/^\|+\s*/, "");
  const head = headingOf(text);
  if (head) return head.level;
  if (/^\s*<u>[\s\S]*<\/u>[\s:.]*$/.test(inner) && text.length <= 100 && !/^LITERATURE\b/i.test(text)) {
    return /^[IVXLC]+\.|^[A-Z]\.\s/.test(text) ? 1 : 2;
  }
  return null;
}

// "(1) Physical:" — a label is short, capitalized, and ends on a colon with a
// space after it ("(6) In Eze 27:24" is a reference, not a label). One ending
// on a stop counts only when it is the whole paragraph: "(1) The Commission."
const LABEL_RE = /^\s+[A-Z][^.:;()"]{0,50}?(?::(?=\s|$)|\.\s*$)/;

function formatStructure({ paras, report }: Ctx): void {
  let numberedAbove = false;
  for (const p of paras) {
    const level = paraHeading(p.inner);
    if (level) {
      p.classes.push(level === 1 ? "isbe-h1" : "isbe-h2");
      report?.(level === 1 ? "heading I." : "heading 1.", clip(p, 0, p.text.length, 80));
      numberedAbove = false;
      continue;
    }
    const at = p.text.search(/\S/);
    if (at < 0) continue;
    const lead = /^\((\d+|[a-z])\)/.exec(p.text.slice(at));
    if (!lead) continue;
    const label = LABEL_RE.exec(p.text.slice(at + lead[0].length));
    const end = at + lead[0].length + (label ? label[0].length : 0);
    if (/\d/.test(lead[1])) {
      // A (1) paragraph is never indented: in BETHEL the "1." headings sit
      // under it.
      numberedAbove = true;
      if (mark(p, at, end, "isbe-n")) report?.(label ? "(1) with label" : "(1) bare", clip(p, at, end + 40));
    } else {
      if (mark(p, at, end, "isbe-l")) report?.(label ? "(a) with label" : "(a) bare", clip(p, at, end + 40));
      // Indented under a (1) above it in the same section; an orphan (a),
      // like GRACE's, stays at the margin.
      if (numberedAbove) {
        p.classes.push("isbe-ind");
        report?.("(a) indented", clip(p, at, at + 60));
      }
    }
  }
}

// --- Entry point ----------------------------------------------------------

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * The article with its formatting added. If the text that comes out differs
 * from the text that went in by so much as a space, the article is returned
 * as it was and a warning is logged.
 */
export function formatArticle(html: string, report?: FormatReport): string {
  if (!html) return html;
  const pieces: (string | Para)[] = [];
  let last = 0;
  for (const m of html.matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p>/g)) {
    pieces.push(html.slice(last, m.index), readPara(m[1], m[2]));
    last = m.index! + m[0].length;
  }
  pieces.push(html.slice(last));
  const paras = pieces.filter((x): x is Para => typeof x !== "string");

  let out: string;
  try {
    applyRules({ paras, report });
    out = pieces.map((x) => (typeof x === "string" ? x : renderPara(x))).join("");
  } catch (err) {
    console.warn("[isbeFormat] formatting failed; showing the article as written", err);
    return html;
  }
  if (plainText(out) !== plainText(html)) {
    console.warn("[isbeFormat] formatting changed the article's text; showing it as written");
    return html;
  }
  return out;
}
