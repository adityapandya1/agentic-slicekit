// The reviewer's verdict file (REQ-2.11): parsed into a record, and checked for the shape problems
// that make a hook refuse the reviewer. The head SHA is not read from the file: the state layer
// stamps a verdict with the pull request head it holds when the verdict is recorded (REQ-1.8).
import { lines, prose, headings } from './markdown.js';

const VERDICT = /^Verdict: (BLOCK|CHANGES|APPROVE)\s*$/;
const INDEPENDENT = /^\s*Independent:\s*yes\s*$/i;
const KINDS = { B: 'blocker', H: 'should-have' };
const ID_FORM = /^([BH])-(\d+)$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;
const COLUMNS = { file: 'file:line', wrong: 'what is wrong', why: 'why it matters', verified: 'how verified' };

const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isDivider = (row) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(row);
const isRow = (row) => row.includes('|');
const blankable = (s) => (s === undefined || s === '-' ? '' : s);

function fileLine(cell) {
  const s = blankable(cell ?? '');
  if (s === '') return { file: null, line: null };
  const m = /^(.*\S):(\d+)$/.exec(s);
  return m ? { file: m[1], line: Number(m[2]) } : { file: s, line: null };
}

// The findings table: the first table whose header's first column is `ID`. Columns are found by
// name, so an extra column or a reordered one still reads.
function findings(text) {
  const all = [...prose(text)].map(([l]) => l);
  for (let i = 0; i < all.length - 1; i++) {
    if (!isRow(all[i]) || !isDivider(all[i + 1])) continue;
    const header = cells(all[i]).map((c) => c.toLowerCase());
    if (header[0] !== 'id') continue;
    const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, header.indexOf(name)]));
    const out = [];
    for (let j = i + 2; j < all.length && isRow(all[j]); j++) {
      const row = cells(all[j]);
      const id = row[0];
      const m = ID_FORM.exec(id);
      const get = (k) => (at[k] === -1 ? '' : row[at[k]] ?? '');
      out.push({
        id,
        kind: m ? KINDS[m[1]] : null,
        ...fileLine(get('file')),
        wrong: get('wrong'),
        why: get('why'),
        verified: blankable(get('verified')),
      });
    }
    return out;
  }
  return [];
}

// The list items under a level-2 heading, or null when the heading is absent.
function section(text, title) {
  const h = headings(text).find((x) => x.level === 2 && x.text.toLowerCase() === title.toLowerCase());
  if (!h) return null;
  const items = [];
  for (const [line, n] of prose(text)) {
    if (n <= h.line) continue;
    if (/^#{1,2}\s/.test(line)) break;
    const m = ITEM.exec(line);
    if (m) items.push(m[1]);
  }
  return items;
}

export function parseVerdict(text, path) {
  const all = lines(text);
  const first = all.find((l) => l.trim() !== '');
  const m = first === undefined ? null : VERDICT.exec(first);
  const notChecked = section(text, 'Not checked');
  return {
    path,
    verdict: m ? m[1] : null,
    findings: findings(text),
    checklists: section(text, 'Checklists run') ?? [],
    notChecked: notChecked ?? [],
    hasNotChecked: notChecked !== null,
    independent: [...prose(text)].some(([l]) => INDEPENDENT.test(l)),
  };
}

// Every shape problem, in a stable order: the verdict line, each finding in table order, the
// verdict against its blockers, then the two lists. An empty array means the file is well formed.
export function verdictProblems(v) {
  const out = [];
  if (!v.verdict) out.push('no verdict line');
  const seen = new Set();
  for (const f of v.findings) {
    const name = f.id === '' ? '(no id)' : f.id;
    if (!f.kind) out.push(`finding ${name} has an unknown id form`);
    else if (seen.has(f.id)) out.push(`finding ${name} is listed twice`);
    seen.add(f.id);
    if (f.verified.trim() === '') out.push(`finding ${name} has no "how verified"`);
  }
  const blockers = [...new Set(v.findings.filter((f) => f.kind === 'blocker').map((f) => f.id))];
  if (v.verdict === 'BLOCK' && blockers.length === 0) out.push('verdict BLOCK with no open blocker');
  if (v.verdict === 'APPROVE' && blockers.length > 0) out.push(`verdict APPROVE with open blocker ${blockers.join(', ')}`);
  if (v.checklists.length === 0) out.push('no checklists listed');
  if (!v.hasNotChecked) out.push('no "Not checked" section');
  return out;
}
