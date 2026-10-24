import fs from 'node:fs';
import path from 'node:path';
import { frontMatter, headings, lines, tables } from './markdown.js';
import { parseSliceAddr } from './ids.js';
import { kitPaths } from './paths.js';

export class SliceFileError extends Error {
  constructor(message, { path: file, field } = {}) {
    super(`${file ?? '<slice>'}: ${message}`);
    this.name = 'SliceFileError';
    this.path = file;
    this.field = field;
  }
}

const KINDS = ['happy', 'negative', 'e2e'];
const SCALARS = ['slice', 'name', 'repo', 'group', 'runbook'];
const LISTS = ['requirements', 'decisions'];

// The text under the first `## <title>` heading, up to the next level-2 heading.
function section(body, title) {
  const hs = headings(body).filter((h) => h.level === 2);
  const i = hs.findIndex((h) => h.text.toLowerCase() === title.toLowerCase());
  if (i === -1) return null;
  const all = lines(body);
  const end = i + 1 < hs.length ? hs[i + 1].line - 1 : all.length;
  return all.slice(hs[i].line, end).join('\n');
}

const asList = (v) => (Array.isArray(v) ? v : v === '' || v == null ? [] : [String(v)]);

export function parseSliceFile(text, file) {
  const fail = (message, field) => {
    throw new SliceFileError(message, { path: file, field });
  };
  const { data, body } = frontMatter(text);
  for (const key of [...SCALARS, ...LISTS]) {
    if (!(key in data)) fail(`missing front-matter field "${key}"`, key);
  }
  const id = String(data.slice);
  if (!parseSliceAddr(id)) fail(`front-matter field "slice" is not a slice address: ${id}`, 'slice');
  const rb = String(data.runbook).toLowerCase();
  if (!['yes', 'true', 'no', 'false'].includes(rb)) {
    fail(`front-matter field "runbook" must be yes or no, got "${data.runbook}"`, 'runbook');
  }

  const done = section(body, 'Done when');
  if (done === null) fail('missing section "## Done when"', 'Done when');
  const doneWhen = lines(done)
    .map((l) => /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => m[1].trim());

  const evalText = section(body, 'Evaluation set');
  if (evalText === null) fail('missing section "## Evaluation set"', 'Evaluation set');
  const table = tables(evalText)[0];
  const header = table ? table.header.map((h) => h.toLowerCase()) : [];
  if (!table || header[0] !== 'test' || header[1] !== 'kind' || header[2] !== 'covers') {
    fail('"## Evaluation set" has no table with the columns Test, Kind, Covers', 'Evaluation set');
  }
  if (table.rows.length === 0) fail('"## Evaluation set" table has no rows', 'Evaluation set');
  const evaluation = table.rows.map((row) => {
    const [test = '', kind = '', covers = ''] = row;
    if (!KINDS.includes(kind)) {
      fail(`evaluation row "${test}" has kind "${kind}", expected happy, negative or e2e`, 'Evaluation set');
    }
    return {
      test,
      kind,
      covers: covers.split(',').map((c) => c.trim()).filter((c) => c !== ''),
    };
  });

  const changes = section(body, 'Expected changes') ?? '';
  const expectedChanges = [...changes.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());

  return {
    id,
    name: String(data.name),
    repo: String(data.repo),
    group: String(data.group),
    runbook: rb === 'yes' || rb === 'true',
    requirements: asList(data.requirements),
    decisions: asList(data.decisions),
    doneWhen,
    evaluation,
    expectedChanges,
    path: file,
  };
}

export function findSliceFiles(root, cfg) {
  const phases = kitPaths(root, cfg).phases;
  if (!fs.existsSync(phases)) return [];
  const out = [];
  for (const dir of fs.readdirSync(phases, { withFileTypes: true })) {
    const pm = /^P(\d+)(?:\b|[-_])/.exec(dir.name);
    if (!dir.isDirectory() || !pm) continue;
    const phaseDir = path.join(phases, dir.name);
    for (const f of fs.readdirSync(phaseDir)) {
      const sm = /^S-(\d+).*\.md$/.exec(f);
      if (sm) {
        out.push({
          path: path.join(phaseDir, f),
          phaseDir,
          phaseId: `P${pm[1]}`,
          key: [Number(pm[1]), Number(sm[1])],
        });
      }
    }
  }
  out.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  return out.map(({ path: p, phaseDir, phaseId }) => ({ path: p, phaseDir, phaseId }));
}

export function parsePhaseFile(text) {
  for (const h of headings(text)) {
    if (h.level !== 1) continue;
    const m = /^Phase\s+(\d+)\s*(?:—|-|:)\s*(.+)$/.exec(h.text);
    if (m) return { id: `P${m[1]}`, name: m[2].replace(/\s*:\s*implementation plan\s*$/i, '').trim() };
  }
  return null;
}
