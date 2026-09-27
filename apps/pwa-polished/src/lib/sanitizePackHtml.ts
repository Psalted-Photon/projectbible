/**
 * sanitizePackHtml — the last step before pack text is put on screen.
 *
 * Commentary, ISBE articles and book intros arrive from a pack as HTML and are
 * shown with {@html}. The packs this app publishes are trusted, but a pack can
 * also be installed "From URL" or "From file", and anything in one of those
 * would run inside the app, with the reader's notes, journal and sign-in right
 * there.
 *
 * This is not the shared-page allowlist (lib/shared/sanitizeNoteHtml.ts). Pack
 * text is real formatting — headings, lists, tables, links, the app's own
 * coloured reference spans — and all of that has to survive. So it keeps every
 * element and attribute except the ones that can run code, load a page into
 * the app, or restyle the app around the text:
 *
 *   - elements that run, embed or submit something are removed with their
 *     contents, and so are the ones whose contents the browser reads as raw
 *     text, since those read differently the second time they are parsed and
 *     are the usual way to smuggle markup past a cleaner like this one
 *   - every on… attribute, and srcdoc
 *   - a link or source that is javascript:, vbscript: or file:, and a data:
 *     one anywhere but an image
 *   - an inline style that loads anything or reaches outside the element
 *
 * Run it on the finished HTML, after the app has added its own links, so
 * nothing the linkifiers pass through untouched gets out unchecked.
 */

const DROP_ENTIRELY = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'base', 'link', 'meta', 'form', 'input', 'button', 'select', 'textarea',
  'option', 'template', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext',
  'title', 'svg', 'math', 'portal', 'dialog', 'slot',
]);

/** Attributes whose value is fetched or followed. */
const URL_ATTRS = new Set([
  'href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background',
  'cite', 'data', 'lowsrc', 'ping', 'longdesc', 'srcset', 'manifest', 'codebase',
]);

/** Browsers ignore whitespace and control characters inside a scheme. */
function schemeOf(value: string): string {
  // eslint-disable-next-line no-control-regex
  const squashed = value.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(squashed);
  return m ? m[1] : '';
}

function isSafeUrl(tag: string, name: string, value: string): boolean {
  const scheme = schemeOf(value);
  if (!scheme) return true; // relative, #anchor, or plain text
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') return true;
  // Inline images are ordinary in reference works; nothing else gets data:.
  if (scheme === 'data' && tag === 'img' && name === 'src') {
    return /^data:image\/(png|jpe?g|gif|webp|bmp)[;,]/i.test(value.trim());
  }
  return false;
}

function cleanElement(el: Element): void {
  const tag = el.tagName.toLowerCase();
  // Copy the list first: removing while iterating a live NamedNodeMap skips entries.
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on') || name === 'srcdoc' || name === 'is') {
      el.removeAttribute(attr.name);
    } else if (URL_ATTRS.has(name)) {
      // srcset is a list; any bad entry spoils the lot.
      const values = name === 'srcset' ? attr.value.split(',') : [attr.value];
      if (!values.every((v) => isSafeUrl(tag, name, v))) el.removeAttribute(attr.name);
    } else if (name === 'style') {
      // url() loads, expression()/behavior run in old engines, and a fixed or
      // absolute box can paint itself over the rest of the app.
      if (/url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|@import|position\s*:\s*(fixed|absolute|sticky)/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function walk(root: Element): void {
  for (const child of Array.from(root.children)) {
    if (DROP_ENTIRELY.has(child.tagName.toLowerCase())) {
      child.remove();
      continue;
    }
    walk(child);
    cleanElement(child);
  }
}

// A chapter's commentary re-renders often and the text doesn't change, so the
// last few hundred results are kept rather than parsed again. Long articles
// are left out: they render once per open, and keeping them would hold
// megabytes of text for nothing.
const MEMO_LIMIT = 300;
const MEMO_MAX_CHARS = 20_000;
const memo = new Map<string, string>();

export function sanitizePackHtml(html: string | null | undefined): string {
  if (!html) return '';
  const hit = memo.get(html);
  if (hit !== undefined) return hit;

  // DOMParser builds an inert document: no script runs and nothing loads,
  // whatever the markup asks for.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  let clean = '';
  if (body) {
    // Comments can carry markup that a later innerHTML round-trip revives.
    const comments = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
    const stale: Comment[] = [];
    while (comments.nextNode()) stale.push(comments.currentNode as Comment);
    for (const comment of stale) comment.remove();

    walk(body);
    clean = body.innerHTML;
  }

  if (html.length <= MEMO_MAX_CHARS) {
    if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
    memo.set(html, clean);
  }
  return clean;
}
