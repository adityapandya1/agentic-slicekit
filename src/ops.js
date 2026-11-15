// `slicekit ops` (REQ-2.13, D-57): what `/slicekit ops` hands the ops agent for a symptom, and the
// check of the report the agent replies with. Both read graph.json and files; neither runs git, calls
// the host or takes an action.
import fs from 'node:fs';
import path from 'node:path';
import { history } from './graph/history.js';
import { indexGraph, loadGraph, normalisePath } from './graph/load.js';
import { GraphError, cmp, keyOf } from './graph/schema.js';
import { re } from './ids.js';
import { kitPaths } from './paths.js';
import { cellsOf, footerProblems, isDivider, isRow, lineExists, nextReport, reportSections } from './reports.js';

// A word naming more files than this is too broad to expand.
export const BROAD = 50;

const posix = (p) => p.split(path.sep).join('/');
const segmentsOf = (file) => file.toLowerCase().split(/[/._-]/).filter((s) => s !== '');

// The files a symptom names (D-57). Words are the runs of letters and digits of three or more
// characters, lower-cased, unique, in order; a word names each file one of whose path segments
// (split on `/`, `.`, `-`, `_`) equals it. A word naming more than BROAD files names none and is
// reported; so is a word naming no file. Each of `paths` names the files `slicekit history` would
// match for it. -> {files, words: [{word, files}], broad: [{word, count}], unmatched}
export function symptomFiles(index, symptom, paths = []) {
  const all = index.byKind('file').map((n) => keyOf(n.id));
  const bySegment = new Map();
  for (const file of all) {
    for (const s of new Set(segmentsOf(file))) {
      if (!bySegment.has(s)) bySegment.set(s, []);
      bySegment.get(s).push(file);
    }
  }
  const found = new Set();
  const words = [];
  const broad = [];
  const unmatched = [];
  for (const word of new Set((String(symptom ?? '').match(/[A-Za-z0-9]{3,}/g) ?? []).map((w) => w.toLowerCase()))) {
    const named = bySegment.get(word) ?? [];
    if (named.length === 0) unmatched.push(word);
    else if (named.length > BROAD) broad.push({ word, count: named.length });
    else {
      words.push({ word, files: [...named].sort(cmp) });
      for (const f of named) found.add(f);
    }
  }
  for (const p of paths) {
    const want = normalisePath(p);
    const dir = `${want}/`;
    const named = want === '' || want === '.' ? all : all.filter((f) => f === want || f.startsWith(dir));
    if (named.length === 0) throw new GraphError(2, `${p} is not in the graph`);
    for (const f of named) found.add(f);
  }
  return { files: [...found].sort(cmp), words, broad, unmatched };
}

// The release record of the highest phase, as its repository-relative path; null when there is none.
function lastRelease(index) {
  const phaseOf = (n) => Number(/^P(\d+)$/.exec(keyOf(n.id))?.[1] ?? -1);
  const newest = [...index.byKind('release')].sort((a, b) => phaseOf(b) - phaseOf(a) || cmp(a.id, b.id))[0];
  return newest ? String(newest.from ?? '').replace(/:\d+$/, '') || null : null;
}

// Everything the ops agent is handed for `symptom`. The report path is reserved last, so a symptom
// that names no file leaves no empty report behind. Paths are repository-relative.
export function opsContext(root, cfg, symptom, { paths = [] } = {}) {
  const index = indexGraph(loadGraph(root, cfg));
  const { files, broad, unmatched } = symptomFiles(index, symptom, paths);
  if (files.length === 0) throw new GraphError(1, 'the symptom names no file in the graph; name one with --path <path>');
  const p = kitPaths(root, cfg);
  const rel = (file) => posix(path.relative(root, file));
  const entries = history(index, files);
  return {
    report: nextReport(root, cfg, 'ops'),
    symptom,
    files,
    broad,
    unmatched,
    history: entries,
    runbook: rel(p.runbook),
    observability: rel(p.observability),
    missing: [p.runbook, p.observability].filter((f) => !fs.existsSync(f)).map(rel),
    lastRelease: lastRelease(index),
  };
}

export const OPS_SECTIONS = ['Likely slices and pull requests', 'First checks', 'Proposed actions'];

const FOOTER = /^(?:Skipped|Not checked):/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const MARKED = /\((?:anyone|on-call|owner: [^()]*[^()\s][^()]*)\)[.\s]*$/;
const PR_REF = /(?<![\w&/#.-])([A-Za-z0-9._-]+)?#(\d+)\b/g;
const CITATION = /(?<![\w./-])([A-Za-z0-9_.][\w./-]*):(\d+)\b/g;

// The file extensions a path can end in without naming a file of the graph: the cited file may be
// missing, and its extension still says it was meant as a file.
const EXTENSIONS = new Set(
  'c cc cfg cjs conf cpp cs css csv env go gradle h hpp html ini java js json jsx kt lock log lua md mjs php properties proto ps1 py rb rs scss sh sql svelte swift tf toml ts tsx txt vue xml yaml yml'.split(' '),
);
const extensionOf = (file) => /\.([A-Za-z0-9]+)$/.exec(file.split('/').at(-1))?.[1].toLowerCase() ?? null;

// Whether the text before the colon of a `<path>:<line>` token in First checks makes it a citation
// (P5/S-23 review H-6), with a slash in it or without. It is one when the path is a file in the
// repository or a file of the graph, and when its last segment ends in a file extension: one of
// EXTENSIONS, or the extension of a file of the graph. A token that names no file and ends in no file
// extension, such as `localhost:8080`, `svc.internal/health:8080` or `registry/app:2`, is none.
function isCitation(root, index, file) {
  if (file === '' || file === '.') return false;
  if (index.node(`file:${file}`)) return true;
  try {
    if (fs.statSync(path.join(root, file)).isFile()) return true;
  } catch {
    // Not a file on disk: the extension decides.
  }
  const ext = extensionOf(file);
  return ext !== null && (EXTENSIONS.has(ext) || index.byKind('file').some((n) => extensionOf(keyOf(n.id)) === ext));
}

const FENCE = /^\s*(```|~~~)/;
const SUBHEADING = /^\s{0,3}#{3,6}\s/;
const NO_MARK = 'who may take it: (anyone), (on-call) or (owner: <name>)';

// The actions of the Proposed actions section, in each form the section can hold one, as
// {first, marked, message}: `first` the action's first line number. A list item, with the lines that
// continue it (indented, or right under it), and a paragraph of plain lines are each one action,
// marked when the joined text ends with the mark. A table row is one action, marked when one of its
// cells ends with the mark; the header row and the divider are none. A sub-heading and a fenced
// block are no action. `ls` holds the section's lines that are not blank.
function actions(ls) {
  const out = [];
  let open = null;
  let last = 0;
  let fenced = false;
  const start = (first, t) => {
    open = { first, text: t.trimEnd(), item: ITEM.test(t) };
    out.push(open);
  };
  ls.forEach(({ text: t, line }, i) => {
    const adjacent = line === last + 1;
    last = line;
    if (FENCE.test(t)) {
      fenced = !fenced;
      open = null;
    } else if (fenced || SUBHEADING.test(t)) {
      open = null;
    } else if (isRow(t)) {
      open = null;
      const header = ls[i + 1] && ls[i + 1].line === line + 1 && isDivider(ls[i + 1].text);
      if (!header && !isDivider(t)) out.push({ first: line, row: cellsOf(t) });
    } else if (ITEM.test(t)) {
      start(line, t);
    } else if (open && (adjacent || (open.item && /^\s+\S/.test(t)))) {
      open.text += ` ${t.trim()}`;
    } else {
      start(line, t);
    }
  });
  return out.map((a) =>
    a.row
      ? { first: a.first, marked: a.row.some((cell) => MARKED.test(cell)), message: `the action names in no cell ${NO_MARK}` }
      : { first: a.first, marked: MARKED.test(a.text), message: `the action does not end with ${NO_MARK}` },
  );
}

// A Proposed actions section that proposes no action is this one line.
const NONE = 'None.';

// The lines of a section above its first closing line, `Skipped:` or `Not checked:`, outside a fenced
// block. The closing lines end the section: a closing line that wraps, or a list under it, is no action.
function beforeFooter(ls) {
  let fenced = false;
  for (let i = 0; i < ls.length; i++) {
    if (FENCE.test(ls[i].text)) fenced = !fenced;
    else if (!fenced && FOOTER.test(ls[i].text)) return ls.slice(0, i);
  }
  return ls;
}

// What is wrong with an ops report, one `<rel>:<line> <message>` per problem (REQ-2.13): each of the
// three sections present and holding a line; every slice and pull request named in the first one in
// the graph; every `<file>:<line>` cited in First checks a line that exists; every proposed action,
// whether a list item, a plain line or a table row, marked by who may take it, up to the first closing
// line, or the one line `None.` for no action; the two closing lines.
export function opsReportProblems(root, index, rel, text) {
  const out = [];
  const sections = reportSections(text);
  const content = (name, closed = false) => {
    const section = sections.get(name.toLowerCase());
    if (!section) {
      out.push(`${rel}:1 no "## ${name}" section`);
      return [];
    }
    const upTo = closed ? beforeFooter(section.lines) : section.lines;
    const held = upTo.filter((l) => l.text.trim() !== '' && !FOOTER.test(l.text));
    if (held.length === 0) out.push(`${rel}:${section.line} the "## ${name}" section is empty`);
    return held;
  };

  for (const { text: l, line } of content(OPS_SECTIONS[0])) {
    for (const addr of new Set(l.match(new RegExp(`\\b${re('sliceAddr').source}\\b`, 'g')) ?? [])) {
      if (!index.node(`slice:${addr}`)) out.push(`${rel}:${line} ${addr} is not a slice in the graph`);
    }
    for (const ref of new Set([...l.matchAll(PR_REF)].map((m) => `${m[1] ?? ''}#${m[2]}`))) {
      if (!index.find(ref)) out.push(`${rel}:${line} ${ref} is not a pull request in the graph`);
    }
  }

  for (const { text: l, line } of content(OPS_SECTIONS[1])) {
    for (const m of l.matchAll(CITATION)) {
      const file = normalisePath(m[1]);
      if (!isCitation(root, index, file)) continue;
      if (!lineExists(root, file, Number(m[2]))) out.push(`${rel}:${line} ${m[1]}:${m[2]} is not a line of a file in the repository`);
    }
  }

  const proposed = content(OPS_SECTIONS[2], true);
  if (!(proposed.length === 1 && proposed[0].text.trim() === NONE)) {
    for (const action of actions(proposed)) {
      if (!action.marked) out.push(`${rel}:${action.first} ${action.message}`);
    }
  }

  return [...out, ...footerProblems(rel, text)];
}
