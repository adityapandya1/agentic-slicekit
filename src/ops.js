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
import { footerProblems, lineExists, nextReport, reportSections } from './reports.js';

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

// The list items of a section: each marker line with the lines that continue it, as {first, text},
// `first` the item's first line number and `text` its lines joined.
function listItems(ls) {
  const out = [];
  let open = null;
  for (const { text, line } of ls) {
    if (ITEM.test(text)) {
      open = { first: line, text: text.trimEnd() };
      out.push(open);
    } else if (open && /^\s+\S/.test(text)) {
      open.text += ` ${text.trim()}`;
    } else {
      open = null;
    }
  }
  return out;
}

// What is wrong with an ops report, one `<rel>:<line> <message>` per problem (REQ-2.13): each of the
// three sections present and holding a line; every slice and pull request named in the first one in
// the graph; every `<file>:<line>` cited in First checks a line that exists; every proposed action
// marked by who may take it; the two closing lines.
export function opsReportProblems(root, index, rel, text) {
  const out = [];
  const sections = reportSections(text);
  const content = (name) => {
    const section = sections.get(name.toLowerCase());
    if (!section) {
      out.push(`${rel}:1 no "## ${name}" section`);
      return [];
    }
    const held = section.lines.filter((l) => l.text.trim() !== '' && !FOOTER.test(l.text));
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
      // A token that is no path in the repository, such as `host.example:8080`, is not a citation.
      if (!file.includes('/') && !fs.existsSync(path.join(root, file))) continue;
      if (!lineExists(root, file, Number(m[2]))) out.push(`${rel}:${line} ${m[1]}:${m[2]} is not a line of a file in the repository`);
    }
  }

  for (const item of listItems(content(OPS_SECTIONS[2]))) {
    if (!MARKED.test(item.text)) out.push(`${rel}:${item.first} the action does not end with who may take it: (anyone), (on-call) or (owner: <name>)`);
  }

  return [...out, ...footerProblems(rel, text)];
}
