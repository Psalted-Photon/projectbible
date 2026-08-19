// Builds docs/features.html from docs/FEATURES.md + docs/FEATURES-REFERENCE.md.
//
// Run after editing either markdown file:
//   node scripts/build-features-page.mjs
//
// The markdown files are the source of truth; this page is generated output.
// Edit the .md, re-run this, then republish docs/features.html as the artifact.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(REPO, 'docs') + '/';
const OUT = join(REPO, 'docs', 'features.html');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline markdown -> HTML. Code spans are protected first.
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) =>
    h.startsWith('#') ? `<a href="${h}">${t}</a>` : `<a href="${h}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

// Mirrors GitHub's heading-slug algorithm: strip non-word chars, then map each
// remaining space to one hyphen WITHOUT collapsing runs. "Account & Sync" loses
// the "&" and keeps both spaces, so it slugs to "account--sync" — matching the
// links already written in the .md files.
const slug = (s) =>
  s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/ /g, '-');

function convert(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  const sections = []; // {num, title, id}
  let i = 0;
  let inSection = false;

  const closeSection = () => { if (inSection) { out.push('</div></section>'); inSection = false; } };

  while (i < lines.length) {
    const line = lines[i];

    // Table
    if (line.trim().startsWith('|') && lines[i + 1] && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push('<div class="tw"><table><thead><tr>' +
        head.map((h) => `<th>${inline(h)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    // Headings
    let m;
    if ((m = line.match(/^##\s+(.+)$/)) && !line.startsWith('###')) {
      closeSection();
      const raw = m[1].trim();
      const numMatch = raw.match(/^(\d+)\.\s+(.*)$/);
      const id = slug(raw);
      if (numMatch) {
        sections.push({ num: numMatch[1], title: numMatch[2], id });
        out.push(`<section class="sec" id="${id}" data-sec="${numMatch[1]}">` +
          `<h2 class="sec-h"><button class="sec-toggle" aria-expanded="true"><span class="sec-num">${numMatch[1]}</span>` +
          `<span class="sec-title">${inline(numMatch[2])}</span><span class="chev" aria-hidden="true"></span></button></h2><div class="sec-body">`);
      } else {
        sections.push({ num: '', title: raw, id });
        out.push(`<section class="sec appendix" id="${id}">` +
          `<h2 class="sec-h"><button class="sec-toggle" aria-expanded="true"><span class="sec-num">&#167;</span>` +
          `<span class="sec-title">${inline(raw)}</span><span class="chev" aria-hidden="true"></span></button></h2><div class="sec-body">`);
      }
      inSection = true;
      i++;
      continue;
    }
    if ((m = line.match(/^####\s+(.+)$/))) { out.push(`<h4>${inline(m[1])}</h4>`); i++; continue; }
    if ((m = line.match(/^###\s+(.+)$/))) {
      const t = m[1].trim();
      out.push(`<h3 id="${slug(t)}">${inline(t)}</h3>`);
      i++; continue;
    }
    if ((m = line.match(/^#\s+(.+)$/))) { i++; continue; } // page title handled by shell

    // Lists
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*[-*]\s+/.test(lines[i])) {
          const indent = lines[i].match(/^(\s*)/)[1].length;
          items.push({ indent, text: lines[i].replace(/^\s*[-*]\s+/, '') });
        } else {
          items[items.length - 1].text += ' ' + lines[i].trim();
        }
        i++;
      }
      // Nested rendering. A sub-list must live INSIDE the <li> above it,
      // so the parent <li> is held open until its children are emitted.
      let html = '';
      let depth = 0;
      let liOpen = false;   // an <li> at the current depth awaits its </li>
      let parentOpen = false; // the <li> wrapping the nested <ul>
      const base = Math.min(...items.map((it) => it.indent));
      for (const it of items) {
        const d = it.indent > base ? 1 : 0;
        if (d > depth) {
          html += '<ul class="nest">'; // parent <li> stays open around this
          parentOpen = liOpen; liOpen = false; depth = d;
        } else if (d < depth) {
          if (liOpen) html += '</li>';
          html += '</ul>';
          if (parentOpen) html += '</li>';
          parentOpen = false; liOpen = false; depth = d;
        } else if (liOpen) {
          html += '</li>'; liOpen = false;
        }
        html += `<li>${inline(it.text)}`;
        liOpen = true;
      }
      if (liOpen) html += '</li>';
      if (depth > 0) { html += '</ul>'; if (parentOpen) html += '</li>'; }
      out.push(`<ul>${html}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ol>');
      continue;
    }

    if (/^---+$/.test(line.trim())) { i++; continue; }
    if (/^<!--/.test(line.trim())) { i++; continue; }

    if (line.trim() === '') { i++; continue; }

    // Paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^[#>]/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) &&
           !/^\s*\d+\.\s/.test(lines[i]) && !lines[i].trim().startsWith('|') &&
           !/^---+$/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  closeSection();
  return { html: out.join('\n'), sections };
}

const userMd = readFileSync(ROOT + 'FEATURES.md', 'utf8');
const refMd = readFileSync(ROOT + 'FEATURES-REFERENCE.md', 'utf8');

// Strip the "Contents" nav block from each — the rail replaces it.
const stripToc = (md) => md.replace(/\*\*Contents\*\*[\s\S]*?\n---\n/, '\n---\n');

const user = convert(stripToc(userMd));
const ref = convert(stripToc(refMd));

// Book-category colors from src/lib/bibleData.ts — the app's own palette.
const HUES = [
  '#a67c52', '#6ca0dc', '#f0c040', '#5c1e99', '#a45be9', '#fc345c', '#ff6520',
  '#6048cc', '#f2893e', '#61f1ff', '#b8860b', '#2f6f8f', '#2f7d56', '#a64263',
  '#6c4aa6', '#b35a3a', '#2f7d78', '#3B82F6', '#16A34A', '#D97706', '#0891B2',
];

const rail = ref.sections.map((s, idx) => {
  const c = s.num ? HUES[(+s.num - 1) % HUES.length] : 'var(--fg-3)';
  return `<a class="rail-item" href="#${s.id}" data-target="${s.id}">` +
    `<span class="rail-dot" style="--dot:${c}"></span>` +
    `<span class="rail-num">${s.num || '&#167;'}</span>` +
    `<span class="rail-label">${esc(s.title)}</span></a>`;
}).join('\n');

const hueVars = HUES.map((h, i) => `.sec[data-sec="${i + 1}"]{--hue:${h}}`).join('');

const html = `<title>Hexapla — Feature Tree</title>
<style>
:root{
  --paper:#fbfaf7; --paper-2:#f3f1ec; --paper-3:#e8e5dd;
  --fg:#1a1a24; --fg-2:#4a4a5c; --fg-3:#7c7c8e;
  --line:#ddd9d0; --line-2:#c9c4b8;
  --accent:#5b3fd6; --accent-soft:#efeafd;
  --hue:var(--accent);
  --mono:ui-monospace,"Cascadia Mono","Cascadia Code",Consolas,"Liberation Mono",monospace;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --rail-w:250px;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#12121a; --paper-2:#191922; --paper-3:#22222d;
    --fg:#eceaf2; --fg-2:#b4b1c2; --fg-3:#7f7c90;
    --line:#2b2b38; --line-2:#3a3a4a;
    --accent:#a898ff; --accent-soft:#221d3d;
  }
}
:root[data-theme="dark"]{
  --paper:#12121a; --paper-2:#191922; --paper-3:#22222d;
  --fg:#eceaf2; --fg-2:#b4b1c2; --fg-3:#7f7c90;
  --line:#2b2b38; --line-2:#3a3a4a;
  --accent:#a898ff; --accent-soft:#221d3d;
}
:root[data-theme="light"]{
  --paper:#fbfaf7; --paper-2:#f3f1ec; --paper-3:#e8e5dd;
  --fg:#1a1a24; --fg-2:#4a4a5c; --fg-3:#7c7c8e;
  --line:#ddd9d0; --line-2:#c9c4b8;
  --accent:#5b3fd6; --accent-soft:#efeafd;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--fg);font-family:var(--sans);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}

/* ── Masthead ─────────────────────────────────────────── */
.top{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--paper) 88%,transparent);
  backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.top-in{max-width:1500px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.brand{display:flex;flex-direction:column;gap:1px;margin-right:auto}
.brand b{font-family:var(--serif);font-size:1.12rem;font-weight:600;letter-spacing:-.01em}
.brand span{font-size:.68rem;letter-spacing:.13em;text-transform:uppercase;color:var(--fg-3)}
.filter{position:relative}
.filter input{font:inherit;font-size:.86rem;padding:7px 12px 7px 30px;width:210px;
  border:1px solid var(--line-2);border-radius:7px;background:var(--paper-2);color:var(--fg)}
.filter input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
.filter::before{content:"";position:absolute;left:11px;top:50%;width:11px;height:11px;
  margin-top:-6px;border:1.6px solid var(--fg-3);border-radius:50%}
.filter::after{content:"";position:absolute;left:20px;top:21px;width:6px;height:1.6px;
  background:var(--fg-3);transform:rotate(45deg)}
.seg{display:flex;background:var(--paper-3);border-radius:8px;padding:3px;gap:2px}
.seg button{font:inherit;font-size:.8rem;font-weight:600;padding:6px 14px;border:0;border-radius:6px;
  background:transparent;color:var(--fg-2);cursor:pointer;white-space:nowrap}
.seg button[aria-pressed="true"]{background:var(--paper);color:var(--fg);
  box-shadow:0 1px 3px rgba(0,0,0,.14)}
.seg button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mini{font:inherit;font-size:.78rem;padding:6px 11px;border:1px solid var(--line-2);border-radius:7px;
  background:transparent;color:var(--fg-2);cursor:pointer}
.mini:hover{border-color:var(--accent);color:var(--accent)}
.mini:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

/* ── Shell ────────────────────────────────────────────── */
.shell{max-width:1500px;margin:0 auto;padding:0 24px;display:grid;
  grid-template-columns:var(--rail-w) minmax(0,1fr);gap:44px;align-items:start}
.rail{position:sticky;top:74px;max-height:calc(100vh - 92px);overflow-y:auto;
  padding:26px 0 40px;display:flex;flex-direction:column;gap:1px}
.rail-cap{font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3);
  padding:0 8px 9px}
.rail-item{display:grid;grid-template-columns:9px 20px 1fr;align-items:center;gap:9px;
  padding:5px 8px;border-radius:6px;text-decoration:none;color:var(--fg-2);font-size:.83rem;line-height:1.35}
.rail-item:hover{background:var(--paper-2);color:var(--fg)}
.rail-item.on{background:var(--accent-soft);color:var(--fg)}
.rail-item.on .rail-num{color:var(--accent)}
.rail-dot{width:8px;height:8px;border-radius:50%;background:var(--dot)}
.rail-num{font-family:var(--mono);font-size:.72rem;color:var(--fg-3);
  font-variant-numeric:tabular-nums;text-align:right}
.rail-item:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

.main{padding:26px 0 100px;min-width:0}

/* ── Intro ────────────────────────────────────────────── */
.intro{border-bottom:1px solid var(--line);padding-bottom:30px;margin-bottom:12px}
.eyebrow{font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--accent);
  font-weight:700;margin-bottom:12px}
.intro h1{font-family:var(--serif);font-size:clamp(2rem,4.3vw,2.9rem);line-height:1.08;margin:0 0 14px;
  letter-spacing:-.022em;font-weight:600;text-wrap:balance}
.lede{font-family:var(--serif);font-size:1.11rem;line-height:1.6;color:var(--fg-2);max-width:62ch;margin:0}
.stats{display:flex;gap:30px;flex-wrap:wrap;margin-top:24px}
.stat b{display:block;font-family:var(--mono);font-size:1.35rem;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.stat span{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--fg-3)}
.modenote{margin-top:26px;padding:13px 16px;border-left:2.5px solid var(--accent);
  background:var(--paper-2);border-radius:0 7px 7px 0;font-size:.87rem;color:var(--fg-2);max-width:68ch}

/* ── Sections ─────────────────────────────────────────── */
${hueVars}
.sec{border-bottom:1px solid var(--line);scroll-margin-top:80px}
.sec-h{margin:0}
.sec-toggle{width:100%;display:flex;align-items:center;gap:15px;padding:22px 0;
  background:none;border:0;cursor:pointer;color:inherit;font:inherit;text-align:left}
.sec-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.sec-num{flex:none;width:34px;height:34px;display:grid;place-items:center;border-radius:8px;
  font-family:var(--mono);font-size:.83rem;font-weight:600;font-variant-numeric:tabular-nums;
  background:color-mix(in srgb,var(--hue) 15%,transparent);color:var(--hue);
  border:1px solid color-mix(in srgb,var(--hue) 32%,transparent)}
.sec-title{font-family:var(--serif);font-size:1.42rem;font-weight:600;letter-spacing:-.016em;
  flex:1;text-wrap:balance}
.chev{flex:none;width:9px;height:9px;border-right:1.8px solid var(--fg-3);
  border-bottom:1.8px solid var(--fg-3);transform:rotate(45deg);margin-right:5px;
  transition:transform .18s ease}
.sec-toggle[aria-expanded="false"] .chev{transform:rotate(-45deg)}
.sec-body{padding:0 0 32px 49px;max-width:none}
.sec-toggle[aria-expanded="false"]+.sec-body{display:none}

h3{font-size:.76rem;letter-spacing:.11em;text-transform:uppercase;color:var(--hue);
  font-weight:700;margin:30px 0 12px;scroll-margin-top:80px}
h3:first-child{margin-top:4px}
h4{font-size:.94rem;font-weight:650;margin:20px 0 8px;color:var(--fg)}
p{margin:0 0 13px;max-width:68ch}
ul,ol{margin:0 0 14px;padding-left:20px;max-width:70ch}
li{margin-bottom:6px}
ul.nest{margin:6px 0 4px;padding-left:19px}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:2px}
strong{font-weight:650;color:var(--fg)}
code{font-family:var(--mono);font-size:.845em;background:var(--paper-3);
  padding:1.5px 5px;border-radius:4px;color:var(--fg);word-break:break-word}
a code{color:inherit}

.tw{overflow-x:auto;margin:0 0 18px;border:1px solid var(--line);border-radius:9px;background:var(--paper-2)}
table{border-collapse:collapse;width:100%;font-size:.855rem}
th{text-align:left;padding:9px 13px;border-bottom:1px solid var(--line-2);white-space:nowrap;
  font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:var(--fg-3);font-weight:700}
td{padding:8px 13px;border-bottom:1px solid var(--line);vertical-align:top;
  font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
td code{background:transparent;padding:0}

/* ── Mode registers ───────────────────────────────────── */
/* User mode reads as prose; full mode tightens into reference. */
#view-user{font-family:var(--serif);font-size:1.035rem;line-height:1.68}
#view-user .sec-body{max-width:74ch}
#view-user li{margin-bottom:8px}
#view-full{font-size:.945rem;line-height:1.62}
#view-full p,#view-full ul,#view-full ol{max-width:76ch}
[hidden]{display:none !important}

.empty{padding:60px 0;text-align:center;color:var(--fg-3);font-family:var(--sans);font-size:.9rem}
mark{background:color-mix(in srgb,var(--accent) 26%,transparent);color:inherit;
  padding:0 2px;border-radius:2px}

.foot{border-top:1px solid var(--line);margin-top:10px;padding:26px 0 0;
  font-size:.79rem;color:var(--fg-3);font-family:var(--sans);display:flex;gap:8px;flex-wrap:wrap}

@media (max-width:940px){
  .shell{grid-template-columns:1fr;gap:0;padding:0 18px}
  .rail{position:static;max-height:none;flex-direction:row;flex-wrap:wrap;gap:5px;
    padding:16px 0;border-bottom:1px solid var(--line)}
  .rail-cap{width:100%;padding-bottom:4px}
  .rail-item{grid-template-columns:8px auto;gap:6px;font-size:.78rem;
    border:1px solid var(--line);padding:4px 9px}
  .rail-label{display:none}
  .sec-body{padding-left:0}
  .top-in{padding:10px 18px;gap:12px}
  .filter input{width:150px}
  .brand span{display:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important;animation:none !important}}
</style>

<header class="top">
  <div class="top-in">
    <div class="brand"><b>Hexapla</b><span>Feature Tree</span></div>
    <div class="filter"><input id="q" type="search" placeholder="Filter features&hellip;" aria-label="Filter features"></div>
    <div class="seg" role="group" aria-label="Detail level">
      <button id="m-user" aria-pressed="true">Overview</button>
      <button id="m-full" aria-pressed="false">Full reference</button>
    </div>
    <button class="mini" id="toggle-all">Collapse all</button>
  </div>
</header>

<div class="shell">
  <nav class="rail" aria-label="Feature domains">
    <div class="rail-cap">Domains</div>
    ${rail}
  </nav>

  <main class="main">
    <div class="intro">
      <div class="eyebrow">Complete feature inventory</div>
      <h1>Every feature in Hexapla, in one tree.</h1>
      <p class="lede">A free, offline-first Bible study app. Twenty-one domains, from reading and word study
        to on-device text-to-speech and cross-device sync &mdash; documented in full, both for the people
        who use it and the people who work on it.</p>
      <div class="stats">
        <div class="stat"><b>21</b><span>Domains</span></div>
        <div class="stat"><b>124</b><span>Source files</span></div>
        <div class="stat"><b>51k</b><span>Lines of code</span></div>
        <div class="stat"><b>14</b><span>Commentaries</span></div>
      </div>
      <p class="modenote"><strong>Overview</strong> describes what each feature does in plain language.
        <strong>Full reference</strong> adds every settings key with its real default, the file each feature
        lives in, and the reasoning behind non-obvious behavior.</p>
    </div>

    <div id="view-user">${user.html}</div>
    <div id="view-full" hidden>${ref.html}</div>
    <div class="empty" id="empty" hidden>No features match that filter.</div>

    <div class="foot"><span>Hexapla</span><span>&middot;</span><span>Generated from
      <code>docs/FEATURES.md</code> and <code>docs/FEATURES-REFERENCE.md</code></span></div>
  </main>
</div>

<script>
(function(){
  var vUser=document.getElementById('view-user'),vFull=document.getElementById('view-full'),
      bUser=document.getElementById('m-user'),bFull=document.getElementById('m-full'),
      q=document.getElementById('q'),empty=document.getElementById('empty'),
      all=document.getElementById('toggle-all'),rail=document.querySelectorAll('.rail-item');
  var mode='user';

  function view(){return mode==='user'?vUser:vFull;}

  function setMode(m){
    mode=m;
    vUser.hidden=(m!=='user'); vFull.hidden=(m!=='full');
    bUser.setAttribute('aria-pressed',String(m==='user'));
    bFull.setAttribute('aria-pressed',String(m==='full'));
    if(q.value.trim())filter();
  }
  bUser.addEventListener('click',function(){setMode('user');});
  bFull.addEventListener('click',function(){setMode('full');});

  // Collapse / expand
  document.addEventListener('click',function(e){
    var t=e.target.closest('.sec-toggle'); if(!t)return;
    t.setAttribute('aria-expanded',t.getAttribute('aria-expanded')==='true'?'false':'true');
  });

  var collapsed=false;
  all.addEventListener('click',function(){
    collapsed=!collapsed;
    view().querySelectorAll('.sec-toggle').forEach(function(t){
      t.setAttribute('aria-expanded',String(!collapsed));
    });
    all.textContent=collapsed?'Expand all':'Collapse all';
  });

  // Filter
  function clearMarks(root){
    root.querySelectorAll('mark').forEach(function(m){
      var p=m.parentNode; p.replaceChild(document.createTextNode(m.textContent),m); p.normalize();
    });
  }
  function mark(root,term){
    var walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),nodes=[],n;
    while((n=walk.nextNode()))if(n.nodeValue.toLowerCase().indexOf(term)>-1&&n.parentNode.nodeName!=='SCRIPT')nodes.push(n);
    nodes.slice(0,600).forEach(function(node){
      var v=node.nodeValue,low=v.toLowerCase(),frag=document.createDocumentFragment(),i=0,j;
      while((j=low.indexOf(term,i))>-1){
        if(j>i)frag.appendChild(document.createTextNode(v.slice(i,j)));
        var m=document.createElement('mark'); m.textContent=v.slice(j,j+term.length);
        frag.appendChild(m); i=j+term.length;
      }
      if(i<v.length)frag.appendChild(document.createTextNode(v.slice(i)));
      node.parentNode.replaceChild(frag,node);
    });
  }
  function filter(){
    var term=q.value.trim().toLowerCase(),root=view();
    clearMarks(root);
    var secs=root.querySelectorAll('.sec'),hits=0;
    secs.forEach(function(s){
      var t=s.querySelector('.sec-toggle');
      if(!term){s.hidden=false;t.setAttribute('aria-expanded','true');hits++;return;}
      var on=s.textContent.toLowerCase().indexOf(term)>-1;
      s.hidden=!on;
      if(on){hits++;t.setAttribute('aria-expanded','true');mark(s.querySelector('.sec-body'),term);}
    });
    empty.hidden=hits>0;
    collapsed=false; all.textContent='Collapse all';
  }
  var timer; q.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(filter,140);});

  // Rail highlight
  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting)return;
      var id=en.target.id;
      rail.forEach(function(r){r.classList.toggle('on',r.dataset.target===id);});
    });
  },{rootMargin:'-70px 0px -75% 0px'});
  document.querySelectorAll('#view-user .sec').forEach(function(s){obs.observe(s);});

  rail.forEach(function(r){
    r.addEventListener('click',function(){
      var id=r.dataset.target,s=view().querySelector('#'+CSS.escape(id));
      if(s){var t=s.querySelector('.sec-toggle');if(t)t.setAttribute('aria-expanded','true');}
    });
  });
})();
</script>`;

writeFileSync(OUT, html, 'utf8');
console.log('sections(user):', user.sections.length, 'sections(ref):', ref.sections.length);
console.log('bytes:', html.length);
