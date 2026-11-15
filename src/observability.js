// REQ-3.11, D-56: the CI steps observability.md names. Intake writes them (D-20) as a table with the
// columns Step and Command under `## CI steps the monitoring setup requires`; each row renders as one
// obs-<n> job of the generated workflow, after the jobs of ci.observabilitySteps.
import { LINE_SEPARATOR, workflowTextErrors } from './config.js';
import { headings, prose, tableCells } from './markdown.js';

export const STEPS_HEADING = 'CI steps the monitoring setup requires';

const COLUMNS = ['step', 'command'];

// A cell that is one code span reads as the span's text; any other cell reads as written. A span
// opens and closes with runs of backticks of one length and holds no run of that length.
function cellText(cell) {
  const text = (cell ?? '').trim();
  const span = /^(`+)(?!`)([\s\S]*[^`])\1$/.exec(text);
  if (!span) return text;
  const inner = span[2].match(/`+/g) ?? [];
  return inner.some((run) => run.length === span[1].length) ? text : span[2].trim();
}

const opensWithBar = (line) => /^\s*\|/.test(line);
const isDivider = (line) => opensWithBar(line) && tableCells(line).every((c) => /^:?-+:?$/.test(c));

// The steps table of one observability.md: `rel` is the file's path as the messages name it.
// A section with no such table (prose, `Not yet known`, `None`) holds no steps. The section is read
// line by line, so that no line of the table is dropped without a message: a header naming Step and
// Command is the steps table's or an error, and each later line of the table that opens with a bar
// is a row or an error.
export function docSteps(text, rel) {
  const out = { steps: [], warnings: [], errors: [] };
  const all = headings(text);
  const at = all.findIndex((h) => h.level === 2 && h.text === STEPS_HEADING);
  if (at === -1) return out;
  const start = all[at].line;
  const end = all.slice(at + 1).find((h) => h.level <= 2)?.line ?? Infinity;
  const headingLines = new Set(all.map((h) => h.line));
  // The section's lines outside fenced code, each with its 1-based number.
  const body = [...prose(text)].filter(([, n]) => n > start && n < end);
  const dividerAfter = (k) => k + 1 < body.length && body[k + 1][1] === body[k][1] + 1 && isDivider(body[k + 1][0]);

  let first = -1;
  for (let k = 0; k < body.length && first === -1; k++) {
    const [line, n] = body[k];
    if (!opensWithBar(line)) continue;
    const header = tableCells(line);
    const names = header.map((c) => c.toLowerCase());
    if (!COLUMNS.every((c) => names.includes(c))) {
      // A table of other columns is not the steps table: its rows are passed over.
      if (dividerAfter(k)) while (k + 1 < body.length && body[k + 1][1] === body[k][1] + 1 && opensWithBar(body[k + 1][0])) k++;
      continue;
    }
    if (names.length !== COLUMNS.length || !names.every((c, i) => c === COLUMNS[i])) {
      out.errors.push(`${rel}:${n}: the steps table has the columns ${header.join(', ')}; it takes two, Step then Command`);
      return out;
    }
    if (!dividerAfter(k)) {
      out.errors.push(`${rel}:${n}: the header of the steps table needs a divider line under it, |---|---|`);
      return out;
    }
    first = k + 2;
  }
  if (first === -1) return out;

  const seen = new Map();
  for (let k = first; k < body.length; k++) {
    const [line, n] = body[k];
    // A blank line, a heading or a code fence ends the table.
    if (n !== body[k - 1][1] + 1 || line.trim() === '' || headingLines.has(n)) break;
    if (!opensWithBar(line)) continue;
    const where = `${rel}:${n}`;
    // A carriage return alone does not end a line here, and a step is one line.
    if (line.includes('\r')) {
      out.errors.push(`${where}: the row holds a carriage return; write a step on one line`);
      continue;
    }
    const row = tableCells(line);
    // A bare pipe in a command ends its cell: the job would run only the text before it.
    if (row.length > COLUMNS.length) {
      out.errors.push(`${where}: the row has ${row.length} cells and the table has ${COLUMNS.length}; write a pipe inside a command as \\|`);
      continue;
    }
    const name = cellText(row[0]);
    const run = cellText(row[1]);
    if (name === '') {
      out.errors.push(`${where}: a step needs a name`);
      continue;
    }
    if (run === '') {
      out.warnings.push(`${where}: step "${name}" has no command; no job rendered`);
      continue;
    }
    const problems = [...workflowTextErrors(`${where}: Step`, name, { expression: false }), ...workflowTextErrors(`${where}: Command`, run)];
    // A separator at the edge of a cell is trimmed with the spaces, so the row as written is read too.
    if (problems.length === 0 && LINE_SEPARATOR.test(line)) problems.push(`${where}: contains a line separator YAML cannot carry`);
    // Two jobs of one name: the runbook finds a failing job's step by its name.
    if (problems.length === 0 && seen.has(name)) problems.push(`${where}: step "${name}" is also at ${seen.get(name)}; name it once`);
    if (problems.length > 0) {
      out.errors.push(...problems);
      continue;
    }
    seen.set(name, where);
    out.steps.push({ name, run, at: where });
  }
  return out;
}

// Config's steps first, then the doc's. One name in both places would make one job stand in for
// another, so it is refused, naming both. `doc` is what docSteps returned, or null when there is no file.
export function allSteps(cfg, doc) {
  const configSteps = cfg.ci?.observabilitySteps ?? [];
  const errors = [...(doc?.errors ?? [])];
  for (const step of doc?.steps ?? []) {
    const i = configSteps.findIndex((s) => s.name === step.name);
    if (i !== -1) errors.push(`${step.at}: step "${step.name}" is also in ci.observabilitySteps[${i}]; name it in one place`);
  }
  return { steps: [...configSteps, ...(doc?.steps ?? [])], warnings: [...(doc?.warnings ?? [])], errors };
}
