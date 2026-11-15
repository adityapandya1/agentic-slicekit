// REQ-3.11, D-56: the CI steps observability.md names. Intake writes them (D-20) as a table with the
// columns Step and Command under `## CI steps the monitoring setup requires`; each row renders as one
// obs-<n> job of the generated workflow, after the jobs of ci.observabilitySteps.
import { LINE_SEPARATOR, workflowTextErrors } from './config.js';
import { headings, lines, tables } from './markdown.js';

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

// The steps table of one observability.md: `rel` is the file's path as the messages name it.
// A section with no such table (prose, `Not yet known`, `None`) holds no steps.
export function docSteps(text, rel) {
  const out = { steps: [], warnings: [], errors: [] };
  const all = headings(text);
  const at = all.findIndex((h) => h.level === 2 && h.text === STEPS_HEADING);
  if (at === -1) return out;
  const start = all[at].line;
  const end = all.slice(at + 1).find((h) => h.level <= 2)?.line ?? lines(text).length + 1;
  const table = tables(text).find(
    (t) => t.line > start && t.line < end && t.header.length === COLUMNS.length && t.header.every((c, i) => c.toLowerCase() === COLUMNS[i]),
  );
  if (!table) return out;
  const source = lines(text);
  const seen = new Map();
  table.rows.forEach((row, i) => {
    // The header is at table.line and the divider on the next line; the rows follow one per line.
    const where = `${rel}:${table.line + 2 + i}`;
    // A bare pipe in a command ends its cell: the job would run only the text before it.
    if (row.length > COLUMNS.length) {
      out.errors.push(`${where}: the row has ${row.length} cells and the table has ${COLUMNS.length}; write a pipe inside a command as \\|`);
      return;
    }
    const name = cellText(row[0]);
    const run = cellText(row[1]);
    if (name === '') {
      out.errors.push(`${where}: a step needs a name`);
      return;
    }
    if (run === '') {
      out.warnings.push(`${where}: step "${name}" has no command; no job rendered`);
      return;
    }
    const problems = [...workflowTextErrors(`${where}: Step`, name, { expression: false }), ...workflowTextErrors(`${where}: Command`, run)];
    // A separator at the edge of a cell is trimmed with the spaces, so the row as written is read too.
    if (problems.length === 0 && LINE_SEPARATOR.test(source[table.line + 1 + i])) problems.push(`${where}: contains a line separator YAML cannot carry`);
    // Two jobs of one name: the runbook finds a failing job's step by its name.
    if (problems.length === 0 && seen.has(name)) problems.push(`${where}: step "${name}" is also at ${seen.get(name)}; name it once`);
    if (problems.length > 0) {
      out.errors.push(...problems);
      return;
    }
    seen.set(name, where);
    out.steps.push({ name, run, at: where });
  });
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
