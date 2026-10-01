/**
 * Spurgeon's readings as numbered blocks, shared by the modern-English export
 * (export-devotionals-for-modernizing.mjs) and the pack build that checks the
 * modern text against the original.
 *
 * A reading's body_html is a run of top-level <p> (prose) and <blockquote>
 * (a poem or hymn verse). Each one is a block, numbered from 1 in order.
 *
 * Marked text is the same words with the HTML swapped for something easy to
 * read and write by hand:
 *   *words*          emphasis (<em>)
 *   ^words^          small caps (<span class="sc">), Spurgeon's way of stressing the text's words
 *   [[Osis|label]]   a Scripture link (<a class="devo-ref" data-osis>)
 *   a line break     a poem's line break (<br>)
 */

export function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

/** body_html -> [{ kind: 'p' | 'poem', html }] */
export function splitBlocks(bodyHtml) {
  const blocks = [];
  const html = bodyHtml.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/<(p|blockquote)>([\s\S]*?)<\/\1>/g)) {
    blocks.push({ kind: m[1] === 'p' ? 'p' : 'poem', html: m[2] });
  }
  return blocks;
}

/** A block's inner HTML -> marked text. */
export function htmlToMarked(html) {
  return decodeEntities(
    html
      .replace(/<a class="devo-ref" data-osis="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, osis, label) => `[[${osis}|${label}]]`)
      .replace(/<\/?em>/g, '*')
      .replace(/<span class="sc">([\s\S]*?)<\/span>/g, '^$1^')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<\/?strong>/g, '')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

/** Every Scripture link in a piece of marked text, as its OSIS ref. */
export function linksIn(marked) {
  return [...marked.matchAll(/\[\[([^|\]]+)\|[^\]]*\]\]/g)].map((m) => m[1]);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Why a piece of marked text can't be turned into HTML, or null if it can:
 * an unpaired * or ^, or a [[ that never closes.
 */
export function markupProblem(marked) {
  const bare = marked.replace(/\[\[[^|\]]+\|[^\]]*\]\]/g, '');
  if (/\[\[|\]\]/.test(bare)) return 'a [[link]] that is not [[Osis|label]]';
  if ((bare.match(/\*/g) || []).length % 2) return 'an unpaired *';
  if ((bare.match(/\^/g) || []).length % 2) return 'an unpaired ^';
  return null;
}

/** Marked text -> HTML, the reverse of htmlToMarked. A line break becomes <br>. */
export function markedToHtml(marked) {
  return escapeHtml(marked.trim())
    .replace(/\[\[([^|\]]+)\|([^\]]*)\]\]/g, (_, osis, label) => `<a class="devo-ref" data-osis="${osis}">${label}</a>`)
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\^([^^]+)\^/g, '<span class="sc">$1</span>')
    .replace(/\n/g, '<br>');
}
