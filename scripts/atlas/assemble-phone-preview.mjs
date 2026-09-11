/**
 * Inline the data and Leaflet's stylesheet into the preview template.
 * A published page can't fetch either one, so both have to ship inside it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..'
);
const SCRATCH = process.argv[2];
if (!SCRATCH) throw new Error('pass the scratchpad directory');

const template = fs.readFileSync(path.join(SCRATCH, 'atlas-template.html'), 'utf8');
const leafletCss = fs.readFileSync(path.join(ROOT, 'node_modules/leaflet/dist/leaflet.css'), 'utf8');
const leafletJs = fs.readFileSync(path.join(ROOT, 'node_modules/leaflet/dist/leaflet.js'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'scripts/atlas/phone-preview-data.json'), 'utf8');

/**
 * Anything inside a <script> element is still read by the HTML parser first, so
 * a stray "</script" or "<!--" would end the block early and silently drop the
 * rest of the page. Escaping "<" outright makes the payload inert to the parser
 * while staying valid JSON.
 */
const safeData = data.replace(/</g, '\\u003c');

const html = template
  .replace('/* __LEAFLET_CSS__ */', () => leafletCss)
  .replace('/* __LEAFLET_JS__ */', () => leafletJs)
  .replace('__DATA__', () => safeData);

for (const marker of ['__DATA__', '__LEAFLET_CSS__', '__LEAFLET_JS__']) {
  if (html.includes(marker)) throw new Error(`placeholder ${marker} was left unreplaced`);
}

const dest = path.join(SCRATCH, 'atlas-preview.html');
fs.writeFileSync(dest, html);
console.log(`${(html.length / 1e6).toFixed(2)} MB -> ${dest}`);
