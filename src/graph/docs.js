// Nodes and edges from one markdown file under the docs root (REQ-4.1, REQ-4.2): which kind of file
// it is follows from where it sits. Only IDs and the kit's own shapes are read; nothing is inferred.
import path from 'node:path';
import { citedRefs } from '../check/rules/citations.js';
import { readDecisions } from '../decisions.js';
import { readGaps } from '../gaps.js';
import { re } from '../ids.js';
import { headings, prose } from '../markdown.js';
import { SliceFileError, parsePhaseFile, parseSliceFile, phaseOfDir } from '../slicefile.js';
import { nodeId } from './schema.js';

const empty = () => ({ nodes: [], edges: [] });
const all = (name, text) => [...String(text).matchAll(re(name, 'g'))].map((m) => m[0]);
const uniq = (list) => [...new Set(list)];

// GitHub's heading anchor: lower case, punctuation dropped, spaces to dashes.
export const slug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

// The docs root as a POSIX prefix: '' for '.', else '<docsRoot>/'.
export function docsPrefix(cfg) {
  const d = path.posix.normalize(String(cfg.docsRoot).replace(/\\/g, '/')).replace(/\/$/, '');
  return d === '.' || d === '' ? '' : `${d}/`;
}

// Where rel sits under the docs root -> {kind, ...} or null.
function classify(cfg, rel) {
  const prefix = docsPrefix(cfg);
  if (!rel.startsWith(prefix)) return null;
  const sub = rel.slice(prefix.length);
  if (/^intake\//.test(sub)) return { kind: 'intake' };
  if (!rel.endsWith('.md')) return null;
  if (sub === 'decisions.md') return { kind: 'decisions' };
  if (sub === 'runbook.md') return { kind: 'runbook' };
  if (sub === 'spec/gaps.md') return { kind: 'gaps' };
  let m = /^spec\/contracts\/C-(\d+)-[^/]*\.md$/.exec(sub);
  if (m) return { kind: 'contract', id: `C-${Number(m[1])}` };
  if (/^spec\/[^/]+\.md$/.test(sub)) return { kind: 'spec' };
  m = /^phases\/([^/]+)\/([^/]+)$/.exec(sub);
  if (m) {
    const phase = phaseOfDir(m[1]);
    if (!phase) return null;
    if (/^S-\d+.*\.md$/.test(m[2])) return { kind: 'slice' };
    if (new RegExp(`^P0*${phase.n}\\.md$`).test(m[2])) return { kind: 'phase', phase };
    return null;
  }
  m = /^releases\/P(\d+)\.md$/.exec(sub);
  if (m) return { kind: 'release', id: `P${Number(m[1])}` };
  return null;
}

// The intake key of a file under the intake folder, or null for a sidecar or a placeholder.
export function intakeKey(cfg, rel) {
  const prefix = `${docsPrefix(cfg)}intake/`;
  if (!rel.startsWith(prefix)) return null;
  const name = rel.slice(prefix.length);
  if (name === '' || name.endsWith('.meta.json') || path.posix.basename(name) === '.keep') return null;
  return name;
}

// An intake file is named, never opened: its node comes from its path alone.
export function intakeFragment(cfg, rel) {
  const name = intakeKey(cfg, rel);
  if (name === null) return empty();
  return { nodes: [{ id: nodeId('intake', name), kind: 'intake', label: name, from: `${rel}:1` }], edges: [] };
}

function decisions(rel, text) {
  const out = empty();
  for (const r of readDecisions(text).rows) {
    const id = nodeId('decision', r.id);
    const at = `${rel}:${r.line}`;
    out.nodes.push({ id, kind: 'decision', label: r.question, from: at, type: r.type, open: r.table === 'open' });
    const cells = [r.type, r.question, r.answer, r.who, r.why, r.recommendation].filter((c) => c != null).join(' ');
    for (const d of uniq(all('decision', cells))) if (d !== r.id) out.edges.push({ kind: 'cites', from: id, to: nodeId('decision', d), at });
  }
  return out;
}

const citeTarget = (ref) => (ref.kind === 'decision' ? nodeId('decision', ref.name) : nodeId('intake', ref.name));
const REQ_HEADING = new RegExp(`^(${re('req').source})\\b\\s*(.*)$`);

function spec(rel, text) {
  const out = empty();
  const hs = headings(text);
  const body = [...prose(text)];
  hs.forEach((h, i) => {
    if (h.level < 2 || h.level > 3) return;
    const m = REQ_HEADING.exec(h.text);
    if (!m) return;
    const next = hs.slice(i + 1).find((x) => x.level <= h.level || (x.level <= 3 && REQ_HEADING.test(x.text)));
    const end = next ? next.line : Infinity;
    const id = nodeId('requirement', m[1]);
    out.nodes.push({ id, kind: 'requirement', label: m[2].trim(), from: `${rel}:${h.line}` });
    const lines = body.filter(([, n]) => n > h.line && n < end);
    for (const ref of citedRefs(lines)) out.edges.push({ kind: 'cites', from: id, to: citeTarget(ref), at: `${rel}:${ref.line}` });
  });
  return out;
}

function gaps(rel, text) {
  const out = empty();
  for (const r of readGaps(text).rows) {
    const id = nodeId('gap', r.id);
    const at = `${rel}:${r.line}`;
    out.nodes.push({ id, kind: 'gap', label: r.what, from: at, class: r.cls, closedBy: r.closedBy });
    const cells = [r.cls, r.where, r.what, r.closedBy].join(' ');
    for (const d of uniq(all('decision', cells))) out.edges.push({ kind: 'cites', from: id, to: nodeId('decision', d), at });
    for (const q of uniq(all('req', cells))) out.edges.push({ kind: 'cites', from: id, to: nodeId('requirement', q), at });
  }
  return out;
}

const KEY = /\*\*([A-Z][A-Za-z ]*):\*\*/g;
const PARTY = { Producer: 'produces', Producers: 'produces', Consumer: 'consumes', Consumers: 'consumes' };

// The text under each **Key:** of a contract's prose, as [{key, text, line}] in file order: a key's
// text runs to the next key or a blank line, over as many lines as it takes (S-17, S-20).
export function keyedText(text) {
  const out = [];
  let open = null;
  for (const [line, n] of prose(text)) {
    if (line.trim() === '') {
      open = null;
      continue;
    }
    let cursor = 0;
    for (const m of line.matchAll(KEY)) {
      if (open !== null) out.push({ key: open, text: line.slice(cursor, m.index), line: n });
      open = m[1].trim();
      cursor = m.index + m[0].length;
    }
    if (open !== null) out.push({ key: open, text: line.slice(cursor), line: n });
  }
  return out;
}

// 'produces' for a Producer or Producers key, 'consumes' for a Consumer or Consumers key, else null.
export const partyOf = (key) => PARTY[key] ?? null;

function contract(rel, text, contractId) {
  const id = nodeId('contract', contractId);
  const first = headings(text)[0];
  const label = first ? first.text.replace(new RegExp(`^${contractId}\\b[\\s:—-]*`), '').trim() : contractId;
  const out = { nodes: [{ id, kind: 'contract', label, from: `${rel}:${first?.line ?? 1}` }], edges: [] };
  for (const seg of keyedText(text)) {
    const kind = partyOf(seg.key);
    if (!kind) continue;
    for (const s of uniq(all('sliceAddr', seg.text))) out.edges.push({ kind, from: nodeId('slice', s), to: id, at: `${rel}:${seg.line}` });
  }
  return out;
}

function phase(rel, text, ph) {
  const parsed = parsePhaseFile(text);
  const h = headings(text).find((x) => x.level === 1);
  return { nodes: [{ id: nodeId('phase', ph.id), kind: 'phase', label: parsed?.name ?? ph.name, from: `${rel}:${h?.line ?? 1}` }], edges: [] };
}

// The 1-based line of each front-matter key.
function keyLines(text) {
  const out = {};
  const ls = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (ls[0] !== '---') return out;
  for (let i = 1; i < ls.length && ls[i] !== '---'; i++) {
    const m = /^([^:\s][^:]*):/.exec(ls[i]);
    if (m && !(m[1] in out)) out[m[1]] = i + 1;
  }
  return out;
}

function slice(rel, text) {
  let s;
  try {
    s = parseSliceFile(text, rel);
  } catch (e) {
    if (e instanceof SliceFileError) return { nodes: [], edges: [], warnings: [`graph: ${e.message}`] };
    throw e;
  }
  const lines = keyLines(text);
  const at = (key) => `${rel}:${lines[key] ?? 1}`;
  const id = nodeId('slice', s.id);
  const phaseN = Number(s.id.split('/')[0].slice(1));
  const out = { nodes: [{ id, kind: 'slice', label: s.name, from: at('slice'), name: s.name, group: s.group, repo: s.repo }], edges: [] };
  out.edges.push({ kind: 'in', from: id, to: nodeId('phase', `P${phaseN}`), at: at('slice') });
  for (const r of uniq(s.requirements)) out.edges.push({ kind: 'implements', from: id, to: nodeId('requirement', r), at: at('requirements') });
  for (const d of uniq(s.decisions)) out.edges.push({ kind: 'cites', from: id, to: nodeId('decision', d), at: at('decisions') });
  return out;
}

function release(rel, text, releaseId) {
  const id = nodeId('release', releaseId);
  const out = { nodes: [{ id, kind: 'release', label: releaseId, from: `${rel}:1` }], edges: [], prRefs: [] };
  for (const [line, n] of prose(text)) {
    for (const m of line.matchAll(/(?<![\w&/#])#(\d+)\b/g)) out.prRefs.push({ number: Number(m[1]), at: `${rel}:${n}`, release: id });
  }
  return out;
}

function runbook(rel, text) {
  const out = empty();
  const hs = headings(text).filter((h) => h.level === 2);
  const body = [...prose(text)];
  hs.forEach((h, i) => {
    const id = nodeId('runbook-section', `${rel}#${slug(h.text)}`);
    out.nodes.push({ id, kind: 'runbook-section', label: h.text, from: `${rel}:${h.line}` });
    const end = hs[i + 1]?.line ?? Infinity;
    for (const [line, n] of body) {
      if (n <= h.line || n >= end) continue;
      const at = `${rel}:${n}`;
      for (const s of uniq(all('sliceAddr', line))) out.edges.push({ kind: 'cites', from: id, to: nodeId('slice', s), at });
      for (const q of uniq(all('req', line))) out.edges.push({ kind: 'cites', from: id, to: nodeId('requirement', q), at });
      for (const d of uniq(all('decision', line))) out.edges.push({ kind: 'cites', from: id, to: nodeId('decision', d), at });
    }
  });
  return out;
}

// True for a markdown file docFragment reads (an intake file is named, not read).
export const readsDoc = (cfg, rel) => {
  const c = classify(cfg, rel);
  return c !== null && c.kind !== 'intake';
};

// One file under the docs root -> {nodes, edges[, prRefs][, warnings]}. `root` is the repository;
// the shapes read here need only the text.
export function docFragment(root, cfg, rel, text) {
  const c = classify(cfg, rel);
  if (!c) return empty();
  switch (c.kind) {
    case 'decisions': return decisions(rel, text);
    case 'spec': return spec(rel, text);
    case 'gaps': return gaps(rel, text);
    case 'contract': return contract(rel, text, c.id);
    case 'phase': return phase(rel, text, c.phase);
    case 'slice': return slice(rel, text);
    case 'release': return release(rel, text, c.id);
    case 'runbook': return runbook(rel, text);
    case 'intake': return intakeFragment(cfg, rel);
    default: return empty();
  }
}
