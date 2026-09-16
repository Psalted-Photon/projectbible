/**
 * sanitizeNoteHtml — the allowlist every shared page passes through.
 *
 * A local note is HTML the editor wrote and only this device ever reads back.
 * A shared page is HTML somebody else wrote, and it gets parsed into the DOM of
 * this device. So everything that leaves and everything that arrives goes
 * through here: before upload, so this device never publishes anything odd it
 * picked up from a paste, and again after download, because neither side
 * should have to trust the other. A page that was clean when it was written
 * and a page that was tampered with in between look identical from here.
 *
 * What survives is exactly what the editor can produce:
 *
 *   - paragraphs, line breaks and the six text formats the toolbar offers
 *   - the editor's own class names
 *   - verse references, with the data attributes BibleRefNode reads back, so
 *     Go to and Expand keep working on a page a stranger wrote
 *   - a paragraph id and its pill list, which is how the gutter knows who
 *     worked on which line
 *   - four style declarations and no others
 *
 * Everything else is dropped: every link, image, script, event attribute, id,
 * and every style that could paint or position anything. Colour is the point
 * of the exercise — a shared page carries structure, and how it looks comes
 * from the reader's own settings, the same way a local note does.
 */

/** Matches the ceiling in migration 012, so a page refused here is refused there too. */
export const MAX_PAGE_CHARS = 200_000;

/**
 * Tags whose whole subtree goes, text and all. Everything else that isn't in
 * ALLOWED_TAGS is unwrapped instead — its text is kept and the element itself
 * is discarded — because a stray <div> around a paragraph is clutter, whereas
 * the text inside a <script> is the attack.
 */
const DROP_ENTIRELY = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'select', 'textarea', 'link', 'meta', 'base', 'template', 'noscript',
  'title', 'svg', 'math', 'audio', 'video', 'canvas', 'img', 'picture',
  'source', 'track', 'applet', 'frame', 'frameset', 'portal', 'dialog',
]);

/** Everything the editor can emit, and nothing else. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
  'sub', 'sup',
]);

/** The editor's own theme classes, plus the three a verse reference wears. */
const ALLOWED_CLASSES = new Set([
  'editor-paragraph',
  'editor-text-bold',
  'editor-text-italic',
  'editor-text-underline',
  'editor-text-strikethrough',
  'editor-text-superscript',
  'editor-text-subscript',
  'bible-ref',
  'is-expanded',
  'is-pending',
]);

/**
 * Style is where a shared page could otherwise repaint itself in somebody
 * else's colours, so it is narrowed to the four declarations the editor
 * actually writes. Each is checked against its own pattern, not just its name.
 */
const ALLOWED_STYLES: Record<string, RegExp> = {
  // The toolbar's font-size picker. Bounded so a page cannot be one line 900px tall.
  'font-size': /^\d{1,3}px$/,
  // The alignment buttons.
  'text-align': /^(left|center|right|justify)$/,
  // Lexical puts this on every text span; without it, runs of spaces collapse.
  'white-space': /^(pre-wrap|normal|nowrap|pre-line)$/,
  // A verse reference's book colour. Identity, not decoration — it is the same
  // colour the reader paints that book in, and BibleRefNode sets it itself.
  '--ref-color': /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
};

/** Attributes kept on any allowed element. */
const GLOBAL_ATTRS = new Set(['class', 'style', 'dir']);

/**
 * Attributes kept only on a verse reference, plus the two a paragraph carries
 * for the pill gutter. Each is validated below — an allowlist of names alone
 * would let `data-ref="…" onclick=…` through as a value.
 */
const REF_ATTRS = new Set([
  'data-ref', 'data-book', 'data-chapter', 'data-verse', 'data-expanded', 'role',
]);
const PARAGRAPH_ATTRS = new Set(['data-pid', 'data-pills']);

/** A reference or a book name: letters, digits, spaces and the punctuation in "1 Kings 4:6-8". */
const SAFE_REF_VALUE = /^[\w .,:;\-–—()[\]/]{0,120}$/;
/** A paragraph id, and the member ids stamped on it. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function filterClasses(value: string): string {
  return value
    .split(/\s+/)
    .filter((cls) => ALLOWED_CLASSES.has(cls))
    .join(' ');
}

function filterStyle(value: string): string {
  const kept: string[] = [];
  for (const declaration of value.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const raw = declaration.slice(colon + 1).trim();
    const pattern = ALLOWED_STYLES[name];
    if (!pattern) continue;
    // A value carrying url(), expression() or a comment is never one of ours,
    // and the patterns below would reject it anyway — this is belt and braces.
    if (/[(){}@\\]|\/\*|url/i.test(raw)) continue;
    if (!pattern.test(raw)) continue;
    kept.push(`${name}: ${raw}`);
  }
  return kept.join('; ');
}

/** The pill list is a comma-separated run of member ids; anything else is dropped. */
function filterPills(value: string): string {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => SAFE_ID.test(part))
    .slice(0, 16)
    .join(',');
}

function cleanAttributes(el: Element): void {
  const tag = el.tagName.toLowerCase();
  const isRef = tag === 'span' && el.classList.contains('bible-ref');
  const isParagraph = tag === 'p';

  // Copy the list first: removing while iterating a live NamedNodeMap skips entries.
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    // Nothing that can run code, whatever else it claims to be.
    if (name.startsWith('on') || name === 'srcdoc' || name === 'href' || name === 'src') {
      el.removeAttribute(attr.name);
      continue;
    }

    if (GLOBAL_ATTRS.has(name)) {
      if (name === 'class') {
        const kept = filterClasses(value);
        if (kept) el.setAttribute('class', kept);
        else el.removeAttribute('class');
      } else if (name === 'style') {
        const kept = filterStyle(value);
        if (kept) el.setAttribute('style', kept);
        else el.removeAttribute('style');
      } else if (name === 'dir') {
        if (value !== 'ltr' && value !== 'rtl') el.removeAttribute('dir');
      }
      continue;
    }

    if (isRef && REF_ATTRS.has(name)) {
      if (name === 'data-chapter' || name === 'data-verse') {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 1 || n > 1000) el.removeAttribute(attr.name);
        else el.setAttribute(name, String(n));
      } else if (name === 'data-expanded') {
        if (value !== 'true') el.removeAttribute(attr.name);
      } else if (name === 'role') {
        if (value !== 'link') el.removeAttribute(attr.name);
      } else if (!SAFE_REF_VALUE.test(value)) {
        el.removeAttribute(attr.name);
      }
      continue;
    }

    if (isParagraph && PARAGRAPH_ATTRS.has(name)) {
      if (name === 'data-pid') {
        if (!SAFE_ID.test(value)) el.removeAttribute(attr.name);
      } else {
        const kept = filterPills(value);
        if (kept) el.setAttribute('data-pills', kept);
        else el.removeAttribute('data-pills');
      }
      continue;
    }

    el.removeAttribute(attr.name);
  }
}

/** Replace an element with its own children, keeping the text but losing the tag. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) {
    el.remove();
    return;
  }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function walk(root: Element): void {
  // Depth-first over a static list: unwrapping moves children up into the
  // parent, which would make a live walk revisit or skip nodes.
  for (const child of Array.from(root.children)) walk(child);

  const tag = root.tagName.toLowerCase();
  if (DROP_ENTIRELY.has(tag)) {
    root.remove();
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    unwrap(root);
    return;
  }
  cleanAttributes(root);
}

/**
 * Clean a page's HTML. Safe to run on text that is already clean — it is
 * meant to be run twice, once at each end.
 *
 * Returns '' for anything that isn't a string, so a malformed row from the
 * server renders as an empty page rather than throwing on the way in.
 */
export function sanitizeNoteHtml(html: unknown): string {
  if (typeof html !== 'string' || html === '') return '';

  // Truncating markup mid-tag would be worse than useless, so an over-long
  // page is refused whole. The caller shows the message; the same ceiling is
  // enforced again by the database.
  const input = html.length > MAX_PAGE_CHARS ? html.slice(0, MAX_PAGE_CHARS) : html;

  // DOMParser builds an inert document: no script runs, no image is fetched,
  // and nothing is loaded from anywhere, whatever the markup asks for.
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const body = doc.body;
  if (!body) return '';

  // Comments can carry markup that a later innerHTML round-trip revives.
  const comments = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const stale: Comment[] = [];
  while (comments.nextNode()) stale.push(comments.currentNode as Comment);
  for (const comment of stale) comment.remove();

  for (const child of Array.from(body.children)) walk(child);

  return body.innerHTML;
}

/**
 * The readable text of a page, for previews, counts and emptiness checks.
 * Sanitises first, so it never parses raw markup from anybody else.
 */
export function sharedPagePreviewText(html: unknown): string {
  const clean = sanitizeNoteHtml(html);
  if (!clean) return '';
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Is this page small enough to save? Checked before upload so the writer is
 * told plainly, rather than meeting the database's refusal as a sync failure.
 */
export function isPageWithinSizeLimit(html: string): boolean {
  return typeof html === 'string' && html.length <= MAX_PAGE_CHARS;
}
