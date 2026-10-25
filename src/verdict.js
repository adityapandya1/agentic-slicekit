// The reviewer's verdict file (REQ-2.11): parsed into a record, and checked for the shape problems
// that make a hook refuse the reviewer. The head SHA is not read from the file: the state layer
// stamps a verdict with the pull request head it holds when the verdict is recorded (REQ-1.8).
import { lines, prose, headings } from './markdown.js';

const VERDICT = /^Verdict: (BLOCK|CHANGES|APPROVE)\s*$/;
const ANY_VERDICT = /^\s*Verdict:/;
// The state layer's `--independent` flag decides independence (REQ-2.8), not this field alone.
const INDEPENDENT = /^\s*Independent:\s*yes\s*$/i;
const KINDS = { B: 'blocker', H: 'should-have' };
const ID_FORM = /^([BH])-([1-9]\d*)$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;
const FENCE = /^\s*(```|~~~)/;
const NOT_VERIFIED = new Set(['', '-', 'n/a', 'none', 'tbd']);
const COLUMNS = { file: 'file:line', wrong: 'what is wrong', why: 'why it matters', verified: 'how verified' };
const NAMED = { wrong: 'What is wrong', why: 'Why it matters' };

// A row split on pipes that are neither escaped (`\|`, read as `|`) nor inside a code span. An
// unclosed backtick opens no code span. Returns null for a line with no separating pipe.
function split(line, codeSpans = true) {
  const s = line.trim();
  const parts = [];
  let cell = '';
  let inCode = false;
  let endsOnPipe = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    endsOnPipe = false;
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '`' && codeSpans) {
      inCode = !inCode;
      cell += ch;
    } else if (ch === '|' && !inCode) {
      parts.push(cell);
      cell = '';
      endsOnPipe = true;
    } else {
      cell += ch;
    }
  }
  if (inCode) return split(line, false);
  parts.push(cell);
  if (parts.length < 2) return null;
  if (s.startsWith('|')) parts.shift();
  if (endsOnPipe) parts.pop();
  return parts.map((c) => c.trim());
}

const isDivider = (cells) => cells !== null && cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

function fileLine(cell) {
  const s = cell === '-' ? '' : cell;
  if (s === '') return { file: null, line: null, lineEnd: null };
  const m = /^(.*\S):(\d+)(?:-(\d+))?$/.exec(s);
  if (!m) return { file: s, line: null, lineEnd: null };
  return { file: m[1], line: Number(m[2]), lineEnd: m[3] === undefined ? null : Number(m[3]) };
}

// Every table whose header's first cell is `ID`, in document order. A fence line ends a table and
// nothing inside a fence is read. Columns are found by name, so an extra or reordered one still reads.
function findingsTables(all) {
  const fenced = [];
  let inFence = false;
  for (const l of all) {
    if (FENCE.test(l)) {
      inFence = !inFence;
      fenced.push(true);
    } else {
      fenced.push(inFence);
    }
  }
  const out = [];
  for (let i = 0; i < all.length - 1; i++) {
    if (fenced[i] || fenced[i + 1]) continue;
    const header = split(all[i]);
    if (!header || !isDivider(split(all[i + 1]))) continue;
    const names = header.map((c) => c.toLowerCase());
    const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, names.indexOf(name)]));
    const rows = [];
    let j = i + 2;
    for (; j < all.length && !fenced[j]; j++) {
      const row = split(all[j]);
      if (!row) break;
      rows.push(row);
    }
    if (names[0] === 'id') out.push({ width: header.length, at, rows });
    i = j - 1;
  }
  return out;
}

function finding(row, t) {
  const get = (k) => (t.at[k] === -1 ? '' : (row[t.at[k]] ?? ''));
  const id = row[0];
  const m = ID_FORM.exec(id);
  const verified = get('verified');
  return {
    id,
    kind: m ? KINDS[m[1]] : null,
    ...fileLine(get('file')),
    wrong: get('wrong'),
    why: get('why'),
    verified: NOT_VERIFIED.has(verified.toLowerCase()) ? '' : verified,
  };
}

const sectionTitle = (text) => text.trim().replace(/:\s*$/, '').toLowerCase();

// The list items under a heading of level 2 or deeper with this title, up to the next heading of
// the same or a higher level, or a "Not checked" heading; null when there is no such heading.
function section(text, title) {
  const hs = headings(text);
  const h = hs.find((x) => x.level >= 2 && sectionTitle(x.text) === title);
  if (!h) return null;
  const end = hs.find((x) => x.line > h.line && (x.level <= h.level || sectionTitle(x.text) === 'not checked'));
  const items = [];
  for (const [line, n] of prose(text)) {
    if (n <= h.line) continue;
    if (end && n >= end.line) break;
    const m = ITEM.exec(line);
    if (m) items.push(m[1]);
  }
  return items;
}

const unreadable = (path) => ({
  path,
  verdict: null,
  verdictLines: 0,
  columns: [],
  widths: [],
  findings: [],
  checklists: [],
  notChecked: [],
  hasNotChecked: false,
  independent: false,
  unreadable: true,
});

// Never throws: a Buffer is read as UTF-8, any other non-string gives a record whose only problem
// is "no verdict line".
export function parseVerdict(input, path) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  if (typeof text !== 'string') return unreadable(path);
  const all = lines(text);
  const first = all.find((l) => l.trim() !== '');
  const m = first === undefined ? null : VERDICT.exec(first);
  const tables = findingsTables(all);
  const columns = [];
  for (const t of tables) {
    for (const k of ['wrong', 'why']) if (t.at[k] === -1 && !columns.includes(NAMED[k])) columns.push(NAMED[k]);
  }
  const notChecked = section(text, 'not checked');
  const proseLines = [...prose(text)].map(([l]) => l);
  return {
    path,
    verdict: m ? m[1] : null,
    verdictLines: proseLines.filter((l) => ANY_VERDICT.test(l)).length,
    columns,
    // Cells in each finding's row against its header, in finding order.
    widths: tables.flatMap((t) => t.rows.map((r) => ({ cells: r.length, header: t.width }))),
    findings: tables.flatMap((t) => t.rows.map((r) => finding(r, t))),
    checklists: section(text, 'checklists run') ?? [],
    notChecked: notChecked ?? [],
    hasNotChecked: notChecked !== null,
    independent: proseLines.some((l) => INDEPENDENT.test(l)),
  };
}

// Every shape problem, in a stable order: the verdict line, the findings tables' columns, each
// finding in document order, the verdict against its findings, then the two lists. An empty array
// means the file is well formed.
export function verdictProblems(v) {
  if (v.unreadable) return ['no verdict line'];
  const out = [];
  if (!v.verdict) out.push('no verdict line');
  if (v.verdictLines > 1) out.push('more than one verdict line');
  for (const c of v.columns) out.push(`findings table has no "${c}" column`);
  const seen = new Set();
  v.findings.forEach((f, i) => {
    const name = f.id === '' ? '(no id)' : f.id;
    if (!f.kind) out.push(`finding ${name} has an unknown id form`);
    else if (seen.has(f.id)) out.push(`finding ${name} is listed twice`);
    seen.add(f.id);
    const w = v.widths[i];
    if (w && w.cells > w.header) out.push(`finding ${name} has ${w.cells} cells, the header has ${w.header}`);
    for (const k of ['wrong', 'why']) {
      if (!v.columns.includes(NAMED[k]) && (f[k] === '' || f[k] === '-')) out.push(`finding ${name} has no "${NAMED[k]}"`);
    }
    if (f.verified.trim() === '') out.push(`finding ${name} has no "how verified"`);
  });
  const ids = (kind) => [...new Set(v.findings.filter((f) => f.kind === kind).map((f) => f.id))];
  const blockers = ids('blocker');
  if (v.verdict === 'BLOCK' && blockers.length === 0) out.push('verdict BLOCK with no open blocker');
  if (v.verdict === 'APPROVE' && blockers.length > 0) out.push(`verdict APPROVE with open blocker ${blockers.join(', ')}`);
  if (v.verdict === 'CHANGES' && blockers.length > 0) out.push(`verdict CHANGES with open blocker ${blockers.join(', ')}; use BLOCK`);
  if (v.verdict === 'CHANGES' && ids('should-have').length === 0) out.push('verdict CHANGES with no should-have');
  if (v.checklists.length === 0) out.push('no checklists listed');
  if (!v.hasNotChecked) out.push('no "Not checked" section');
  return out;
}
