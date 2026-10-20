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

function applyRules(_ctx: Ctx): void {
  // Rules arrive in later phases.
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
