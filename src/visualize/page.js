// The visualize page (REQ-4.7, D-04): one self-contained HTML file. The graph is inlined as an
// escaped application/json block, the page script (client.js) and the CSS are inline, and the
// Content-Security-Policy forbids loading anything, so the file works opened from disk offline.
import fs from 'node:fs';

export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

const CLIENT = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');

const VIEWS = [
  ['requirements', 'Requirements'],
  ['board', 'Board'],
  ['timeline', 'Timeline'],
  ['heat', 'File heat'],
  ['contracts', 'Contracts'],
  ['releases', 'Releases'],
];

// JSON that cannot end the script block it sits in: <, >, & and the two JavaScript line separators
// are written as \u escapes, which JSON.parse reads back unchanged.
export function inlineJson(graph) {
  return JSON.stringify(graph).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --panel: #ffffff; --ink: #1c1c1a; --muted: #5f5f5a; --line: #deded8;
  --accent: #1f5fbf; --accent-ink: #ffffff; --chip: #f0f0ec; --bar: #1f5fbf; --focus: #b35c00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141413; --panel: #1d1d1b; --ink: #ecebe6; --muted: #a3a29b; --line: #34332f;
    --accent: #7fb0ff; --accent-ink: #0d1626; --chip: #272724; --bar: #7fb0ff; --focus: #ffb35c;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 16px 16px 8px; }
h1 { margin: 0; font-size: 1.25rem; }
.meta { margin: 4px 0 0; color: var(--muted); font-size: 0.85rem; overflow-wrap: anywhere; }
nav { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--line); }
nav button { font: inherit; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); cursor: pointer; }
nav button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
button:focus-visible, a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 34%); gap: 16px; padding: 16px; }
@media (max-width: 760px) { .layout { grid-template-columns: minmax(0, 1fr); } }
main, aside { min-width: 0; }
section[hidden] { display: none; }
h2 { font-size: 1rem; margin: 0 0 8px; }
h3 { font-size: 0.9rem; margin: 12px 0 4px; color: var(--muted); }
ul { margin: 0; padding-left: 18px; }
li { margin: 2px 0; }
.node { font: inherit; text-align: left; padding: 1px 6px; border: 1px solid transparent; border-radius: 4px; background: var(--chip); color: var(--ink); cursor: pointer; overflow-wrap: anywhere; }
.node:hover { border-color: var(--accent); }
.kind { color: var(--muted); font-size: 0.8rem; margin-right: 4px; }
.empty { color: var(--muted); }
.board { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
.column { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
.column ul { list-style: none; padding: 0; }
.count { color: var(--muted); font-weight: normal; }
.rows { list-style: none; padding: 0; }
.rows li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--line); }
.track { grid-column: 1 / -1; height: 6px; background: var(--chip); border-radius: 3px; }
.bar { height: 6px; min-width: 4px; background: var(--bar); border-radius: 3px; }
.dates, .n { color: var(--muted); font-size: 0.85rem; white-space: nowrap; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; margin: 0 0 8px; }
aside { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; align-self: start; }
aside a { color: var(--accent); }
code { font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: 0.85em; }
`;

export function renderPage(graph) {
  const nav = VIEWS.map(([id, label], i) => `<button type="button" data-show="${id}" aria-pressed="${i === 0}">${label}</button>`).join('');
  const sections = VIEWS.map(([id, label], i) => `<section data-view="${id}" aria-label="${label}"${i === 0 ? '' : ' hidden'}></section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>slicekit graph</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>slicekit graph</h1><p class="meta" id="meta"></p></header>
<nav aria-label="Views">${nav}</nav>
<div class="layout">
<main>
${sections}
</main>
<aside id="detail" aria-live="polite"><p class="empty">Choose a node to see its files, commits and pull requests.</p></aside>
</div>
<script type="application/json" id="graph">${inlineJson(graph)}</script>
<script>${CLIENT}</script>
</body>
</html>
`;
}
