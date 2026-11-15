#!/usr/bin/env node
// The user guide as one web page (P6/S-54, REQ-5.8, D-97): docs/guide/slicekit-guide.html, written
// from docs/guide/README.md and the pages that index links under commands/, slash/ and rules/.
//
// Usage: node scripts/guide-html.js [--check] [--guide <dir>]
//   no option     writes <guide>/slicekit-guide.html
//   --check       writes nothing; exit 1 with one line when the page on disk differs (CRLF read as LF)
//   --guide <dir> another guide folder than the repository's docs/guide
//
// What the page holds: the index's title and introduction, each `##` section of the index except
// Contents and Pages, then one section per group of `## Pages`, each holding one section per page
// in the order of the group's table. The section of `<folder>/<name>.md` has the id
// `<folder>-<name>`. A link to a page, or to a heading of a page, becomes a link inside the page.
// Left out of the index: its Contents list, its tables of pages (the contents list of the web page
// replaces both) and a paragraph that links a file beside the index that is no Markdown page.
//
// The bytes depend only on the files read and on this script: no version, date, user name or path of
// this machine, and every line ends in LF. `node:fs` and `node:path` only.
//
// Exit 1, naming the file and line, and nothing written: an image, a block quote, raw HTML, an
// indented code block, a rule line, a link definition, a footnote, a task item, a table row with the
// wrong number of cells, an open code block, a link that leads nowhere in the guide. Also exit 1: a
// page file the index does not list, or a listed page that is missing. Exit 2: bad usage.
import fs from 'node:fs';
import path from 'node:path';

const PAGE = 'slicekit-guide.html';
const FOLDERS = ['commands', 'slash', 'rules'];
const REGENERATE = 'node scripts/guide-html.js';

const readText = (file) => fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fail = (message) => { throw new Error(message); };

// ---------------------------------------------------------------- Markdown: blocks
// Blocks, each with the line it starts on: {t:'h',level,text} {t:'p',text} {t:'code',lang,text}
// {t:'list',ordered,items:[{text,lists}]} {t:'table',head:[],rows:[[]]}.
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const noComment = (line) => line.replace(/\s*<!--.*?-->/g, '');

// The HTML elements a line of Markdown could carry. A placeholder such as <id> is text, not HTML.
const HTML_TAG = /<\/?(?:a|abbr|b|blockquote|br|code|dd|del|details|div|dl|dt|em|h[1-6]|hr|i|iframe|img|ins|kbd|li|mark|ol|p|pre|s|script|small|span|strong|style|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul)(?:\s[^<>]*)?\/?>/i;

// What the script does not convert, judged on one line outside a code block; null when the line holds
// none. Code spans are text, so they are taken out first.
function refused(line) {
  if (/^\s{0,3}>/.test(line)) return 'a block quote';
  if (/^\s{0,3}(?:-{3,}|={3,}|\*{3,}|_{3,}|(?:[-*_]\s+){2,}[-*_])\s*$/.test(line)) return 'a rule line or an underlined heading';
  if (/^\s{0,3}\[[^\]]+\]:\s/.test(line)) return 'a link definition';
  if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s/.test(line)) return 'a task item';
  const text = line.replace(/(`+)[^]*?\1(?!`)/g, '');
  if (/!\[[^\]]*\][([]/.test(text)) return 'an image';
  if (/\[\^[^\]]+\]/.test(text)) return 'a footnote';
  if (/<[a-z][a-z0-9+.-]*:\/\/[^>\s]*>/i.test(text)) return 'a link in angle brackets';
  if (/<!--|-->/.test(text)) return 'an HTML comment that does not end on its line';
  if (HTML_TAG.test(text)) return 'raw HTML';
  return null;
}

function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parse(md, file) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  // The line as the blocks read it: its comments taken out, and refused when it holds a construct
  // the script does not convert.
  const at = (k) => {
    const line = noComment(lines[k]);
    const what = refused(line);
    if (what) fail(`${file}:${k + 1}: ${what} is a Markdown construct this script does not convert`);
    return line;
  };
  const startsBlock = (k) => FENCE.test(lines[k]) || HEADING.test(lines[k]) || ITEM.test(lines[k])
    || (lines[k].trim().startsWith('|') && k + 1 < lines.length && DELIM.test(lines[k + 1]));

  function list(indent) {
    const first = ITEM.exec(lines[i]);
    const node = { t: 'list', line: i + 1, ordered: /\d/.test(first[2]), items: [] };
    while (i < lines.length) {
      if (FENCE.test(lines[i])) {
        if (/^\s/.test(lines[i])) fail(`${file}:${i + 1}: a code block inside a list item is a Markdown construct this script does not convert`);
        break;
      }
      const line = at(i);
      if (!line.trim()) {
        const next = lines[i + 1] === undefined ? null : ITEM.exec(lines[i + 1]);
        if (next && next[1].length >= indent) { i++; continue; }
        break;
      }
      const m = ITEM.exec(line);
      if (m && m[1].length > indent) { node.items.at(-1).lists.push(list(m[1].length)); continue; }
      if (m && m[1].length < indent) break;
      if (m) node.items.push({ text: m[3], lists: [], line: i + 1 });
      else if (HEADING.test(line)) break;
      else node.items.at(-1).text += ` ${line.trim()}`;
      i++;
    }
    return node;
  }

  while (i < lines.length) {
    const fence = FENCE.exec(lines[i]);
    if (fence) {
      const start = i + 1;
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && FENCE.test(lines[i]))) body.push(lines[i++]);
      if (i >= lines.length) fail(`${file}:${start}: a code block is not closed`);
      i++;
      out.push({ t: 'code', line: start, lang: fence[2], text: body.join('\n') });
      continue;
    }
    const line = at(i);
    if (!line.trim()) { i++; continue; }
    const h = HEADING.exec(line);
    if (h) { out.push({ t: 'h', line: i + 1, level: h[1].length, text: h[2] }); i++; continue; }
    if (/^#{1,6}\S/.test(line) || /^#{7,}/.test(line)) fail(`${file}:${i + 1}: a heading needs one to six # and a space; this script does not convert the line`);
    if (line.trim().startsWith('|') && i + 1 < lines.length && DELIM.test(lines[i + 1])) {
      const head = cells(line);
      const start = i + 1;
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = cells(at(i));
        if (row.length !== head.length) fail(`${file}:${i + 1}: a table row has ${row.length} cells, its header has ${head.length}`);
        rows.push(row);
        i++;
      }
      out.push({ t: 'table', line: start, head, rows });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) { out.push(list(item[1].length)); continue; }
    if (/^(?: {4}|\t)/.test(line)) fail(`${file}:${i + 1}: an indented code block is a Markdown construct this script does not convert`);
    const start = i + 1;
    const para = [line.trim()];
    i++;
    while (i < lines.length && noComment(lines[i]).trim() && !startsBlock(i)) para.push(at(i++).trim());
    out.push({ t: 'p', line: start, text: para.join(' ') });
  }
  return out;
}

// ---------------------------------------------------------------- Markdown: inline
// Code spans, links, strong and emphasis. `link` turns a link target into an href, or null for none.
const INLINE = /(`+)([^]*?[^`])\1(?!`)|\[((?:`[^`]*`|[^\]`])*)\]\(([^)\s]*)\)|\*\*([^]+?)\*\*|\*([^\s*](?:[^*]*[^\s*])?)\*/g;
const plain = (s) => esc(s.replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, '$1'));

function inline(text, link, line) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += plain(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) out += `<code>${esc(m[2].trim())}</code>`;
    else if (m[4] !== undefined) {
      const href = link(m[4], line);
      const body = inline(m[3], link, line);
      out += href === null ? body : `<a href="${esc(href)}">${body}</a>`;
    } else if (m[5] !== undefined) out += `<b>${inline(m[5], link, line)}</b>`;
    else out += `<em>${inline(m[6], link, line)}</em>`;
  }
  return out + plain(text.slice(last));
}

const linksOf = (text) => [...text.matchAll(INLINE)].filter((m) => m[4] !== undefined).map((m) => m[4]);
const bare = (text) => text.replace(/`/g, '').trim();

// GitHub's anchor for a heading: lower case, punctuation dropped, spaces to dashes.
const slug = (text) => bare(text).toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
function slugger() {
  const seen = new Map();
  return (text) => {
    const s = slug(text);
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
}

// ---------------------------------------------------------------- HTML of blocks
// Alternatives of one long usage line, split at each " | " outside brackets, so each reads on its own line.
function alternatives(line) {
  if (line.length <= 100) return [line];
  const out = [];
  let cur = '';
  let depth = 0;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if ('[(<'.includes(ch)) depth++;
    if (')]>'.includes(ch)) depth--;
    if (depth === 0 && line.startsWith(' | ', k)) { out.push(cur); cur = '  | '; k += 2; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function codeBlock(b, usage) {
  if (b.lang === 'console') {
    const lines = b.text.split('\n').map((l) => (l.startsWith('$ ')
      ? `<span class="p">$ </span>${esc(l.slice(2))}` : l ? `<span class="o">${esc(l)}</span>` : ''));
    return `<pre class="ex">${lines.join('\n')}</pre>`;
  }
  if (b.lang === 'text') {
    const lines = b.text.split('\n').flatMap((l) => (usage ? alternatives(l) : [l]));
    return `<pre class="syn">${lines.map((l) => `<span class="l">${esc(l) || ' '}</span>`).join('')}</pre>`;
  }
  return `<pre class="ex">${esc(b.text)}</pre>`;
}

function listHtml(b, link, ind) {
  const tag = b.ordered ? 'ol' : 'ul';
  const items = b.items.map((it) => `${ind}  <li>${inline(it.text, link, it.line)}${it.lists.map((l) => `\n${listHtml(l, link, `${ind}    `)}\n${ind}  `).join('')}</li>`);
  return `${ind}<${tag}>\n${items.join('\n')}\n${ind}</${tag}>`;
}

function tableHtml(b, link, ind) {
  if (b.head.length === 2 && b.head[0] === 'Exit') {
    return `${ind}<ul class="exits">\n${b.rows.map((r, k) => `${ind}  <li><b>${inline(r[0], link, b.line + 2 + k)}</b><span>${inline(r[1], link, b.line + 2 + k)}</span></li>`).join('\n')}\n${ind}</ul>`;
  }
  const row = (r, c, line) => `<tr>${r.map((x) => `<${c}>${inline(x, link, line)}</${c}>`).join('')}</tr>`;
  return [`${ind}<div class="tw"><table class="cols-${b.head.length}">`, `${ind}  <thead>${row(b.head, 'th', b.line)}</thead>`, `${ind}  <tbody>`,
    ...b.rows.map((r, k) => `${ind}    ${row(r, 'td', b.line + 2 + k)}`), `${ind}  </tbody>`, `${ind}</table></div>`].join('\n');
}

// headings: maps a Markdown heading level to the HTML element name.
function blocksHtml(blocks, { link, ind, headings, firstClass }) {
  const out = [];
  let usage = false;
  let first = firstClass;
  for (const b of blocks) {
    if (b.t === 'h') {
      usage = bare(b.text) === 'Usage';
      out.push(`${ind}<${headings[b.level]}${b.id ? ` id="${b.id}"` : ''}>${inline(b.text, link, b.line)}</${headings[b.level]}>`);
    } else if (b.t === 'p') {
      const back = /^\[[^\]]*\]\([^)]*\)$/.test(b.text) && link(linksOf(b.text)[0], b.line) === '#toc';
      out.push(`${ind}<p${back ? ' class="back"' : first ? ` class="${first}"` : ''}>${inline(b.text, link, b.line)}</p>`);
      first = null;
    } else if (b.t === 'code') out.push(`${ind}${codeBlock(b, usage)}`);
    else if (b.t === 'list') out.push(listHtml(b, link, ind));
    else out.push(tableHtml(b, link, ind));
  }
  return out;
}

// ---------------------------------------------------------------- the look
// The styles and the theme script the web page had before it was generated here, then the rules the
// Markdown pages need.
const STYLE = String.raw`/* One palette and type, with a dark theme. */
:root{
  --paper:#F1F3EF; --sheet:#FFFFFF; --ink:#16201B; --muted:#56635C; --rule:#D5DBD4;
  --accent:#2B59C3; --accent-soft:#E3EAFA; --term:#101814; --term-fg:#DCE6DF; --term-dim:#7F9188; --term-p:#7FD3A2;
  --ok:#2E8B57; --warn:#B7791F; --err:#C2513B;
  --ok-soft:#E2F1E8; --warn-soft:#F7EDDC; --err-soft:#F7E4DF;
  --display:"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif;
  --body:"IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --mono:"JetBrains Mono", Consolas, monospace;
  color-scheme:light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#0F1512; --sheet:#172019; --ink:#E3EBE5; --muted:#A3B1A9; --rule:#2B3832;
    --accent:#8DAAF2; --accent-soft:#1D2944; --term:#0A0F0C; --term-fg:#DCE6DF; --term-dim:#7F9188;
    --ok:#62C48F; --warn:#E2AC52; --err:#E8836D;
    --ok-soft:#173022; --warn-soft:#332713; --err-soft:#371C16;
    color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --paper:#0F1512; --sheet:#172019; --ink:#E3EBE5; --muted:#A3B1A9; --rule:#2B3832;
  --accent:#8DAAF2; --accent-soft:#1D2944; --term:#0A0F0C; --term-fg:#DCE6DF; --term-dim:#7F9188;
  --ok:#62C48F; --warn:#E2AC52; --err:#E8836D;
  --ok-soft:#173022; --warn-soft:#332713; --err-soft:#371C16;
  color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.6 var(--body);-webkit-text-size-adjust:100%}
a{color:var(--accent)}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

/* page frame */
.top{max-width:1240px;margin:0 auto;padding:28px 24px 0;display:flex;justify-content:space-between;align-items:center;gap:12px}
.brand{font:800 20px var(--display);color:var(--ink);text-decoration:none}
.brand i{font-style:normal;color:var(--accent)}
.eyebrow{font:600 12px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);padding:6px 11px;border-radius:7px}
.theme{font:600 13px var(--body);color:var(--ink);background:var(--sheet);border:1.5px solid var(--rule);border-radius:9px;padding:7px 12px;cursor:pointer}
.theme:hover{border-color:var(--accent)}
.right{display:flex;gap:10px;align-items:center}
.layout{max-width:1240px;margin:0 auto;padding:0 24px 80px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:48px}
main{min-width:0;max-width:880px}

/* table of contents */
.toc{position:sticky;top:0;align-self:start;max-height:100vh;overflow-y:auto;padding:28px 4px 28px 0;font-size:13.5px}
.toc summary{display:none}
.toc h2{font:700 12px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.toc ol{list-style:none;margin:0;padding:0}
.toc li{margin:0}
.toc a{display:block;padding:3px 8px;border-radius:6px;color:var(--muted);text-decoration:none}
.toc a:hover{background:var(--accent-soft);color:var(--accent)}
.toc > nav > ol > li > a{color:var(--ink);font-weight:600;margin-top:8px}
.toc ol ol a{padding-left:18px}
.toc ol ol a code{font-size:12px;background:none;padding:0;color:inherit}

/* type */
.kicker{font:600 12.5px var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{font:800 48px/1.04 var(--display);letter-spacing:-.02em;margin:14px 0 0}
h2{font:800 32px/1.1 var(--display);letter-spacing:-.015em;margin:8px 0 0}
h3{font:700 19px/1.3 var(--display);margin:0}
h4{font:700 15px/1.3 var(--display);margin:22px 0 0}
p{margin:12px 0 0;color:var(--muted)}
p b, li b, td b, dd b{color:var(--ink);font-weight:600}
.lead{font-size:17px;line-height:1.55;margin-top:16px;max-width:720px}
section.part{padding-top:56px}
section.part > .intro{max-width:760px}
code{font:600 .86em var(--mono);color:var(--accent);background:var(--accent-soft);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
ul,ol{color:var(--muted)}
li{margin:4px 0}

/* tags */
.tag{display:inline-block;font:600 11.5px/1.2 var(--body);letter-spacing:.02em;padding:4px 9px;border-radius:7px;vertical-align:middle;white-space:nowrap}
.t-rare{background:var(--paper);color:var(--muted);border:1px solid var(--rule)}

/* command entries */
.group{margin-top:34px}
.group > h3{font:800 23px/1.2 var(--display);letter-spacing:-.01em}
.group > p{max-width:760px}
section.cmd{background:var(--sheet);border:1.5px solid var(--rule);border-radius:12px;padding:18px 20px;margin-top:14px;min-width:0}
section.cmd > header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
section.cmd > header h4{margin:0;font:700 18px var(--display)}
section.cmd > header h4 code{font-size:16px;background:none;padding:0;color:var(--ink)}
pre{margin:12px 0 0;padding:12px 14px;border-radius:10px;overflow-x:auto;font:400 13px/1.65 var(--mono);white-space:pre}
pre.syn{background:var(--accent-soft);color:var(--ink);border:1px solid var(--rule)}
pre.ex{background:var(--term);color:var(--term-fg)}
pre.ex .p{color:var(--term-p);user-select:none}
pre.ex .o{color:var(--term-dim)}
.exits{list-style:none;margin:0;padding:0}
.exits li{margin:2px 0;color:var(--ink)}
.exits b{display:inline-block;min-width:18px;font:700 14px var(--display);color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}
th{text-align:left;font:600 11.5px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:7px 10px;border-bottom:1.5px solid var(--rule)}
td{padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top;color:var(--ink)}
td:first-child{width:34%}
td code{white-space:normal}
.foot{margin-top:64px;padding-top:14px;border-top:1px solid var(--rule);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted)}

/* the pages written in Markdown: section labels, wrapped usage lines, exit lists, wide tables */
section.part > h2 + section.cmd, section.part > .group + section.cmd{margin-top:26px}
section.cmd h5{font:600 12px/1.5 var(--body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:20px 0 0}
section.cmd h6{font:700 14.5px/1.3 var(--display);color:var(--ink);margin:16px 0 0}
section.cmd p, section.cmd li{color:var(--ink);font-size:14.5px}
section.cmd h5 + p, section.cmd h5 + pre, section.cmd h5 + ul, section.cmd h5 + ol, section.cmd h5 + .tw > table{margin-top:6px}
section.cmd ul:not(.exits), section.cmd ol{margin:10px 0 0;padding-left:22px}
section.cmd p.back{font-size:13px;margin-top:16px}
pre.syn{white-space:pre-wrap;overflow-wrap:anywhere}
pre.syn .l{display:block;padding-left:4ch;text-indent:-4ch}
.exits li{display:grid;grid-template-columns:minmax(18px,max-content) minmax(0,1fr);gap:0 10px}
.tw{overflow-x:auto}
table.cols-3 td:first-child, table.cols-4 td:first-child, table.cols-5 td:first-child{width:auto}
section.part > ul, section.part > ol, .group > ul, .group > ol{margin:12px 0 0;padding-left:22px}

/* phone */
@media (max-width: 900px){
  .top{padding:18px 16px 0}
  .layout{display:block;padding:0 16px 60px}
  .toc{position:sticky;top:0;z-index:5;max-height:none;overflow:visible;padding:10px 0;background:var(--paper);border-bottom:1px solid var(--rule)}
  .toc summary{display:flex;justify-content:space-between;align-items:center;cursor:pointer;font:600 14px var(--body);color:var(--ink);list-style:none;padding:8px 12px;background:var(--sheet);border:1.5px solid var(--rule);border-radius:9px}
  .toc summary::-webkit-details-marker{display:none}
  .toc summary::after{content:"+";font:700 18px var(--display);color:var(--accent)}
  .toc[open] summary::after{content:"\2212"}
  .toc > nav{display:block;max-height:65vh;overflow-y:auto;margin-top:8px;background:var(--sheet);border:1.5px solid var(--rule);border-radius:9px;padding:10px}
  .toc h2{display:none}
  h1{font-size:36px}
  h2{font-size:27px}
  .lead{font-size:16px}
  section.cmd{padding:16px}
  td:first-child{width:auto}
  table{min-width:520px}
  table.cols-2{min-width:0}
  .eyebrow{display:none}
  section.part{padding-top:40px}
}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}`;

const SCRIPT = String.raw`(function(){
  var root = document.documentElement;
  var btn = document.getElementById('theme');
  var toc = document.getElementById('toc');
  var narrow = window.matchMedia('(max-width: 900px)');
  function current(){
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function label(){ btn.textContent = current() === 'dark' ? 'Light theme' : 'Dark theme'; }
  try { var saved = localStorage.getItem('slicekit-theme'); if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved); } catch (e) {}
  label();
  btn.addEventListener('click', function(){
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('slicekit-theme', next); } catch (e) {}
    label();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  function fitToc(){ toc.open = !narrow.matches; }
  fitToc();
  narrow.addEventListener('change', fitToc);
  toc.addEventListener('click', function(e){ if (narrow.matches && e.target.closest('a')) toc.open = false; });
})();`;

// ---------------------------------------------------------------- the page
// The text of the web page for a guide folder. Throws an Error whose message names the file, and the
// line where there is one, when a file holds what the script does not convert.
export function guidePage(guideDir) {
  const GUIDE = path.resolve(guideDir);

  // The pages: 'commands/check.md' -> {rel, dir, id, blocks, anchors, label}.
  const pages = new Map();
  for (const dir of FOLDERS) {
    const folder = path.join(GUIDE, dir);
    const names = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.md')).sort() : [];
    for (const f of names) {
      const rel = `${dir}/${f}`;
      const blocks = parse(readText(path.join(folder, f)), rel);
      if (!blocks.length || blocks[0].t !== 'h' || blocks[0].level !== 1) fail(`${rel}:1: the page does not begin with a # heading`);
      const id = `${dir}-${f.slice(0, -3)}`;
      const next = slugger();
      const anchors = new Map();
      for (const b of blocks.slice(1)) {
        if (b.t !== 'h') continue;
        if (b.level === 1) fail(`${rel}:${b.line}: a second # heading; a page has one`);
        b.id = `${id}--${next(b.text)}`;
        anchors.set(b.id.slice(id.length + 2), b.id);
      }
      pages.set(rel, { rel, dir, id, blocks, anchors, label: bare(blocks[0].text) });
    }
  }

  // The index.
  const INDEX = 'README.md';
  const readme = parse(readText(path.join(GUIDE, INDEX)), INDEX);
  if (readme[0]?.t !== 'h' || readme[0].level !== 1) fail(`${INDEX}:1: the index does not begin with a # heading`);

  // Walk the index once: decide what stays, give each heading its id, and note where each of
  // GitHub's anchors now leads.
  const readmeAnchor = new Map(); // GitHub anchor -> id in this page
  const groups = []; // from "## Pages": {title, id, pages:[{page,label}]}
  const intro = []; // blocks before the first ## heading
  const parts = []; // {title, id, blocks, group}
  {
    const github = slugger();
    const mine = slugger();
    let skip = false; // inside "## Contents"
    let inPages = false;
    let part = null;
    for (const b of readme.slice(1)) {
      if (b.t === 'h') {
        if (b.level === 1) fail(`${INDEX}:${b.line}: a second # heading; the index has one`);
        const anchor = github(b.text);
        if (b.level > 2 && skip) { readmeAnchor.set(anchor, 'toc'); continue; }
        if (b.level > 2 && inPages) { groups.push({ title: b.text, anchor, line: b.line, pages: [] }); continue; }
        skip = false;
        inPages = false;
        const title = bare(b.text);
        if (b.level === 2 && title === 'Contents') { skip = true; readmeAnchor.set(anchor, 'toc'); continue; }
        if (b.level === 2 && title === 'Pages') { inPages = true; readmeAnchor.set(anchor, 'toc'); continue; }
        b.id = mine(b.text);
        readmeAnchor.set(anchor, b.id);
        if (b.level === 2) { part = { title: b.text, id: b.id, line: b.line, blocks: [] }; parts.push(part); continue; }
      } else if (skip) continue;
      if (inPages) {
        if (b.t === 'table') {
          if (!groups.length) fail(`${INDEX}:${b.line}: a table of pages comes before the first ### heading of "## Pages"`);
          b.rows.forEach((row, k) => {
            const at = b.line + 2 + k;
            const m = [...row[0].matchAll(INLINE)].find((x) => x[4] !== undefined);
            const page = m && pages.get(path.posix.normalize(m[4]));
            if (!page) fail(`${INDEX}:${at}: the Pages row "${row[0]}" links no page file of the guide`);
            if (page.listed) fail(`${INDEX}:${at}: ${page.rel} is listed twice under "## Pages"`);
            page.listed = true;
            groups.at(-1).pages.push({ page, label: bare(m[3]) });
          });
        }
        continue;
      }
      // A paragraph that links a file beside the index that is no Markdown page (the web page
      // itself) says where this page comes from; the page does not repeat it.
      if (b.t === 'p' && linksOf(b.text).some((u) => !/^(#|[a-z][a-z0-9+.-]*:)/i.test(u) && !/\.md(#.*)?$/.test(u))) continue;
      (part ? part.blocks : intro).push(b);
    }
  }
  if (!groups.length) fail(`${INDEX}: no "## Pages" section with a ### heading and a table of pages`);
  for (const page of pages.values()) if (!page.listed) fail(`${page.rel}: the page is not listed under "## Pages" of ${INDEX}, so the web page would have no section for it`);

  // Each group of pages is a section of its own, after the index's sections, in the index's order.
  {
    const taken = new Set(['top', 'toc', 'theme', ...parts.map((p) => p.id), ...[...pages.values()].map((p) => p.id)]);
    for (const b of readme) if (b.id) taken.add(b.id);
    for (const g of groups) {
      let id = slug(g.title);
      while (taken.has(id)) id += '-pages';
      taken.add(id);
      readmeAnchor.set(g.anchor, id);
      parts.push({ title: g.title, id, line: g.line, blocks: [], group: g });
    }
  }

  // A link target as an href of this page; null for a link to the section it stands in.
  function linker(fromRel, own) {
    return (url, line) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
      const [file, hash = ''] = url.split('#');
      const rel = file ? path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), file)) : fromRel;
      let to;
      if (rel === INDEX) to = hash ? readmeAnchor.get(hash) : 'top';
      else if (pages.has(rel)) to = hash ? pages.get(rel).anchors.get(hash) : pages.get(rel).id;
      if (!to) fail(`${fromRel}:${line}: the link "${url}" leads to nothing in the guide`);
      return to === own ? null : `#${to}`;
    };
  }

  function pageSection(page) {
    const link = linker(page.rel, page.id);
    const rule = /^Check rule: (.+)$/.exec(page.label);
    const head = rule
      ? `<h4><code>${esc(rule[1])}</code></h4><span class="tag t-rare">Check rule</span>`
      : `<h4><code>${esc(page.label)}</code></h4>`;
    return [`  <section id="${page.id}" class="cmd" data-page="${page.rel}">`, `    <header>${head}</header>`,
      ...blocksHtml(page.blocks.slice(1), { link, ind: '    ', headings: { 2: 'h5', 3: 'h6', 4: 'h6', 5: 'h6', 6: 'h6' }, firstClass: 'sum' }),
      '  </section>', ''];
  }

  const readmeLink = linker(INDEX, null);
  const H = [];
  const p = (...x) => H.push(...x);
  const title = bare(readme[0].text);

  p('<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>SliceKit Guide</title>',
    '<meta name="description" content="The slicekit user guide: the stages, the conventions, and a section for every command, slash command and check rule.">',
    '<!-- Generated by scripts/guide-html.js from docs/guide/README.md and the pages under commands/, slash/ and rules/. Edit those, then run the script; do not edit this file. -->',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">',
    '<style>', STYLE, '</style>', '</head>', '<body>', '',
    '<div class="top">', '  <a class="brand" href="#top" id="top">Slice<i>Kit</i></a>', '  <div class="right">',
    '    <span class="eyebrow">User guide</span>',
    '    <button class="theme" id="theme" type="button" aria-label="Switch colour theme">Dark theme</button>',
    '  </div>', '</div>', '', '<div class="layout">', '');

  // contents
  p('<details class="toc" id="toc" open>', '  <summary>Contents</summary>', '  <nav aria-label="Contents">', '  <h2>Contents</h2>', '  <ol>');
  for (const part of parts) {
    const head = `    <li><a href="#${part.id}">${inline(part.title, readmeLink, part.line)}</a>`;
    if (!part.group) { p(`${head}</li>`); continue; }
    p(head, '      <ol>', ...part.group.pages.map((e) => `        <li><a href="#${e.page.id}"><code>${esc(e.label)}</code></a></li>`), '      </ol></li>');
  }
  p('  </ol>', '  </nav>', '</details>', '', '<main>', '');

  // header: the index's title and what stands before its first section
  p('<header style="padding-top:36px">', '  <div class="kicker">User guide</div>', `  <h1>${esc(title)}</h1>`,
    ...blocksHtml(intro, { link: readmeLink, ind: '  ', headings: {}, firstClass: 'lead' }), '</header>', '');

  // sections: the index's text, then the pages of the group the section holds
  const INDEX_HEADINGS = { 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' };
  for (const part of parts) {
    p(`<section class="part" id="${part.id}">`, `  <h2>${inline(part.title, readmeLink, part.line)}</h2>`);
    let open = false;
    let run = [];
    const flush = () => { p(...blocksHtml(run, { link: readmeLink, ind: open ? '    ' : '  ', headings: INDEX_HEADINGS })); run = []; };
    for (const b of part.blocks) {
      if (b.t === 'h' && b.level === 3) {
        flush();
        if (open) p('  </div>');
        p(`  <div class="group" id="${b.id}">`, `    <h3>${inline(b.text, readmeLink, b.line)}</h3>`);
        open = true;
      } else run.push(b);
    }
    flush();
    if (open) p('  </div>');
    p('');
    if (part.group) for (const e of part.group.pages) p(...pageSection(e.page));
    if (part === parts.at(-1)) p('  <div class="foot"><span>SliceKit · user guide</span><span><a href="#top">Back to top</a></span></div>');
    p('</section>', '');
  }

  p('</main>', '</div>', '', '<script>', SCRIPT, '</script>', '</body>', '</html>', '');
  return H.join('\n').replace(/\r\n?/g, '\n');
}

// ---------------------------------------------------------------- the command line
function main(argv) {
  const USAGE = 'usage: node scripts/guide-html.js [--check] [--guide <dir>]';
  let check = false;
  let guideArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--guide' && argv[i + 1] !== undefined) guideArg = argv[++i];
    else if (argv[i].startsWith('--guide=') && argv[i].length > 8) guideArg = argv[i].slice(8);
    else if (argv[i] === '--help' || argv[i] === '-h') { process.stdout.write(`${USAGE}\n`); return 0; }
    else { process.stderr.write(`${USAGE}\n`); return 2; }
  }
  const guide = guideArg === null ? path.join(import.meta.dirname, '..', 'docs', 'guide') : path.resolve(guideArg);
  const file = path.join(guide, PAGE);
  // The page and the command as a person at the repository root reads them.
  const shown = guideArg === null ? `docs/guide/${PAGE}` : file.split(path.sep).join('/');
  const command = guideArg === null ? REGENERATE : `${REGENERATE} --guide ${guideArg.split(path.sep).join('/')}`;

  let html;
  try {
    html = guidePage(guide);
  } catch (err) {
    process.stderr.write(`guide-html: ${err.message}\n`);
    return 1;
  }
  if (check) {
    const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (onDisk === html) return 0;
    const what = onDisk === null ? 'is missing' : 'differs from what the pages under the guide give';
    process.stderr.write(`guide-html: ${shown} ${what}; run \`${command}\` to regenerate it\n`);
    return 1;
  }
  fs.writeFileSync(file, html);
  process.stdout.write(`wrote ${shown}\n`);
  return 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const same = process.platform === 'win32' ? invoked.toLowerCase() === import.meta.filename.toLowerCase() : invoked === import.meta.filename;
if (same) process.exitCode = main(process.argv.slice(2));
