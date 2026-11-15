// `slicekit audit` (REQ-2.14, D-58): the claims `/slicekit audit` hands the auditor, each with the
// files it names and the commits that could have broken it, and the check of the auditor's report.
// It reads the spec, the runbook, graph.json and git's history; it changes no tracked file.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './fs.js';
import { GitError, git } from './git.js';
import { slug } from './graph/docs.js';
import { indexGraph, loadGraph, normalisePath } from './graph/load.js';
import { GraphError, cmp, keyOf } from './graph/schema.js';
import { headings, lines, prose } from './markdown.js';
import { kitPaths } from './paths.js';
import { footerProblems, lineExists, nextReport, reportSections, sectionTable } from './reports.js';
import { reqBlocks } from './stage.js';

export const STATUSES = ['holds', 'drifted', 'unverifiable'];
export const COLUMNS = ['Claim', 'Where', 'Evidence', 'Found at', 'Status', 'Commit'];

const posix = (p) => p.split(path.sep).join('/');
const CODE_SPAN = /`([^`\n]+)`/g;
const LINK = /\[[^\]]*\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

// The file paths of the graph and every directory that holds one.
function graphPaths(index) {
  const files = new Set(index.byKind('file').map((n) => keyOf(n.id)));
  const dirs = new Set();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return { files, dirs };
}

// The paths a claim's text names that are a file of the graph or a directory holding one: each code
// span and each link target, read from the root and, for a link, from the claim's own directory.
function namedFiles(text, docRel, known) {
  const out = new Set();
  const consider = (raw, relative) => {
    const token = raw.trim().replace(/[#?].*$/, '').replace(/:\d+(?:-\d+)?$/, '');
    const tries = [normalisePath(token)];
    if (relative) tries.push(posix(path.posix.normalize(path.posix.join(path.posix.dirname(docRel), token.replace(/\\/g, '/')))).replace(/\/+$/, ''));
    for (const p of tries) {
      if (p !== '' && p !== '.' && !p.startsWith('..') && (known.files.has(p) || known.dirs.has(p))) {
        out.add(p);
        return;
      }
    }
  };
  for (const [line] of prose(text)) {
    for (const m of line.matchAll(CODE_SPAN)) consider(m[1], false);
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(LINK)) consider(m[1], true);
  }
  return [...out].sort(cmp);
}

// Every claim, before its history is read: the REQ blocks of the spec in spec order, then the `##`
// sections of the runbook in runbook order. -> [{id, where, title, files, file, line, kind}]
function allClaims(root, cfg, index) {
  const known = graphPaths(index);
  const p = kitPaths(root, cfg);
  const out = [];
  const texts = new Map();
  for (const b of reqBlocks(root, cfg)) {
    if (!texts.has(b.file)) texts.set(b.file, lines(readText(path.join(root, b.file))));
    const heading = texts.get(b.file)[b.line - 1] ?? '';
    const title = heading.replace(/^#+\s*/, '').replace(/\s*#*\s*$/, '').slice(b.id.length).trim();
    out.push({ kind: 'spec', id: b.id, where: `${b.file}:${b.line}`, title, files: namedFiles(`${heading}\n${b.block}`, b.file, known), file: b.file, line: b.line });
  }
  if (fs.existsSync(p.runbook)) {
    const rel = posix(path.relative(root, p.runbook));
    const text = readText(p.runbook);
    const all = lines(text);
    const hs = headings(text).filter((h) => h.level <= 2);
    hs.forEach((h, i) => {
      if (h.level !== 2) return;
      const end = hs[i + 1] ? hs[i + 1].line - 1 : all.length;
      const body = all.slice(h.line - 1, end).join('\n');
      out.push({ kind: 'runbook', id: `runbook#${slug(h.text)}`, where: `${rel}:${h.line}`, title: h.text, files: namedFiles(body, rel, known), file: rel, line: h.line });
    });
  }
  return out;
}

// The claims an area names (D-58): none for all; `runbook`; a REQ prefix such as `REQ-2`, or one REQ
// ID; a spec file's stem or path; else a path, naming the claims one of whose files is it, is under
// it or holds it.
function inArea(claims, area) {
  if (area === undefined || area === null || String(area).trim() === '') return claims;
  const a = String(area).trim();
  if (a.toLowerCase() === 'runbook') return claims.filter((c) => c.kind === 'runbook');
  if (/^REQ-\d+$/i.test(a)) return claims.filter((c) => c.kind === 'spec' && c.id.toUpperCase().startsWith(`${a.toUpperCase()}.`));
  if (/^REQ-\d+\.\d+$/i.test(a)) return claims.filter((c) => c.kind === 'spec' && c.id.toUpperCase() === a.toUpperCase());
  const p = normalisePath(a);
  const ofDoc = claims.filter((c) => c.file === p || (c.kind === 'spec' && path.posix.basename(c.file, '.md') === p));
  if (ofDoc.length > 0) return ofDoc;
  return claims.filter((c) => c.files.some((f) => f === p || f.startsWith(`${p}/`) || p.startsWith(`${f}/`)));
}

// The commit that last changed each line of a file, read with one `git blame --porcelain`:
// line number -> {sha, date}; a line not yet committed has no entry.
function blame(root, file) {
  const out = new Map();
  let text;
  try {
    text = git(root, ['blame', '--porcelain', '--', file]);
  } catch (e) {
    if (e instanceof GitError) return out;
    throw e;
  }
  const dates = new Map();
  let sha = null;
  for (const l of text.split('\n')) {
    const head = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(l);
    if (head) {
      sha = head[1];
      if (!/^0+$/.test(sha)) out.set(Number(head[2]), { sha, date: null });
      continue;
    }
    const time = /^committer-time (\d+)$/.exec(l);
    if (time && sha) dates.set(sha, new Date(Number(time[1]) * 1000).toISOString());
  }
  for (const entry of out.values()) entry.date = dates.get(entry.sha) ?? null;
  return out;
}

// The commits that touched one of `files` and are not reachable from `since`, newest first by
// ancestry (`git log --topo-order`): a commit's dates are printed and never compared.
function candidates(root, since, files) {
  if (!since || files.length === 0) return [];
  const text = git(root, ['log', '--topo-order', '--format=%H%x09%cI%x09%s', `${since}..HEAD`, '--', ...files]);
  return text === ''
    ? []
    : text.split('\n').map((l) => {
        const [sha, date, ...subject] = l.split('\t');
        return { sha, date, subject: subject.join('\t') };
      });
}

// The claims of `area` (D-58), in spec order then runbook order:
// [{id, where, title, files, since: {sha, date} | null, candidates: [{sha, date, subject}]}].
// `since` is the commit that last changed the claim's heading line; a candidate touched one of the
// claim's files and descends from it. An area that names no claim is a usage error.
export function auditClaims(root, cfg, index, area) {
  const picked = inArea(allClaims(root, cfg, index), area);
  if (picked.length === 0) {
    throw new GraphError(2, area === undefined || area === null || String(area).trim() === '' ? 'the spec and the runbook hold no claim' : `${area} names no claim`);
  }
  const blames = new Map();
  const logs = new Map();
  return picked.map((c) => {
    if (!blames.has(c.file)) blames.set(c.file, blame(root, c.file));
    const since = blames.get(c.file).get(c.line) ?? null;
    const key = `${since?.sha ?? ''}\n${c.files.join('\n')}`;
    if (!logs.has(key)) logs.set(key, candidates(root, since?.sha, c.files));
    return { id: c.id, where: c.where, title: c.title, files: c.files, since, candidates: logs.get(key) };
  });
}

// What `/slicekit audit` hands the auditor. The report path is reserved after the claims are read,
// so an area that names no claim leaves no empty report behind. With `report` false no report is
// reserved and `report` is null: the context alone, for a second look at an area (issue #157).
export function auditContext(root, cfg, area, { report = true } = {}) {
  const index = indexGraph(loadGraph(root, cfg));
  const claims = auditClaims(root, cfg, index, area);
  return { report: report ? nextReport(root, cfg, 'audit') : null, claims };
}

const bare = (cell) => cell.trim().replace(/^`+|`+$/g, '').trim();

// What is wrong with an audit report, one `<rel>:<line> <message>` per problem (REQ-2.14): a table
// under `## Claims` with the six columns; each row a claim of the area, written where the claim is,
// with a status of the three; a drifted row naming one of its claim's candidate commits; an
// unverifiable row saying why; a holds or drifted row naming where the evidence was found; no claim
// with two rows; the two closing lines. With `everyClaim`, each of `claims` has a row: `claims` are
// the claims of the area, as `auditClaims` reads them from the spec and the runbook.
export function auditReportProblems(root, rel, text, claims, { everyClaim = false } = {}) {
  const out = [];
  const section = reportSections(text).get('claims');
  const table = sectionTable(text, 'Claims');
  if (!section) out.push(`${rel}:1 no "## Claims" section`);
  else if (!table) out.push(`${rel}:${section.line} the "## Claims" section holds no table`);
  else if (table.header.cells.length !== COLUMNS.length || table.header.cells.some((c, i) => c.toLowerCase() !== COLUMNS[i].toLowerCase())) {
    out.push(`${rel}:${table.header.line} the Claims table's columns are not ${COLUMNS.join(', ')}`);
  } else if (table.rows.length === 0) out.push(`${rel}:${table.header.line} the Claims table holds no row`);
  else {
    const byId = new Map(claims.map((c) => [c.id, c]));
    const rowOf = new Map();
    for (const { cells, line } of table.rows) {
      const at = `${rel}:${line}`;
      if (cells.length !== COLUMNS.length) {
        out.push(`${at} the row holds ${cells.length} cells, not ${COLUMNS.length}`);
        continue;
      }
      const [id, where, status, commit] = [cells[0], cells[1], cells[4], cells[5]].map(bare);
      const evidence = cells[2].trim();
      const foundAt = cells[3].trim();
      const claim = byId.get(id);
      if (!claim) {
        out.push(`${at} ${id === '' ? 'the row names no claim' : `${id} is not a claim of this audit`}`);
        continue;
      }
      if (rowOf.has(id)) {
        out.push(`${at} ${id} has a second row; its first is on line ${rowOf.get(id)}`);
        continue;
      }
      rowOf.set(id, line);
      if (where !== claim.where) out.push(`${at} ${id} is written at ${claim.where}, not ${where === '' ? 'nowhere' : where}`);
      if (!STATUSES.includes(status)) {
        out.push(`${at} the status of ${id} is "${status}", not ${STATUSES.slice(0, 2).join(', ')} or ${STATUSES[2]}`);
        continue;
      }
      if (status === 'drifted') {
        const lower = commit.toLowerCase();
        const named = /^[0-9a-f]{7,64}$/.test(lower) && claim.candidates.some((c) => c.sha.toLowerCase().startsWith(lower));
        if (commit === '') out.push(`${at} drifted ${id} names no commit; name one that touched its files after it was written`);
        else if (!named) out.push(`${at} drifted ${id} names ${commit}, which is not a commit that touched its files after it was written`);
      }
      if (status === 'unverifiable') {
        if (evidence === '') out.push(`${at} unverifiable ${id} does not say why in Evidence`);
        continue;
      }
      const cited = /^([^\s`]+):(\d+)$/.exec(bare(foundAt));
      if (cited) {
        if (!lineExists(root, normalisePath(cited[1]), Number(cited[2]))) out.push(`${at} ${cited[1]}:${cited[2]} is not a line of a file in the repository`);
      } else if (!/`[^`]+`/.test(foundAt)) {
        out.push(`${at} Found at of ${id} is neither a <file>:<line> nor a command in backticks`);
      }
    }
    if (everyClaim) {
      for (const c of claims) if (!rowOf.has(c.id)) out.push(`${rel}:${table.header.line} no row for ${c.id}`);
    }
  }
  return [...out, ...footerProblems(rel, text)];
}
