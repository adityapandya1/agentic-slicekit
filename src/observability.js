// REQ-3.11, D-56: the CI steps observability.md names. Intake writes them (D-20) as a table with the
// columns Step and Command under `## CI steps the monitoring setup requires`; each row renders as one
// obs-<n> job of the generated workflow, after the jobs of ci.observabilitySteps.
import { LINE_SEPARATOR, workflowTextErrors } from './config.js';
import { lines, tableCells } from './markdown.js';

export const STEPS_HEADING = 'CI steps the monitoring setup requires';

const COLUMNS = ['Step', 'Command'];
const FORM =
  'the steps table is a header line | Step | Command | in plain text, a divider line |---|---|, then one row per step, and each of its lines opens with a bar';

// A Step cell that is one code span reads as the span's text; any other reads as written. A span
// opens and closes with runs of backticks of one length and holds no run of that length.
function cellText(cell) {
  const text = (cell ?? '').trim();
  const span = /^(`+)(?!`)([\s\S]*[^`])\1$/.exec(text);
  if (!span) return text;
  const inner = span[2].match(/`+/g) ?? [];
  return inner.some((run) => run.length === span[1].length) ? text : span[2].trim();
}

// A Command cell is text with no backtick, or one code span as CommonMark reads it: the run of
// backticks that opens the cell is closed by the next run of that length, and that run ends the
// cell. Any other cell holding a backtick returns null: its backticks would reach the job's shell.
function commandText(cell) {
  const text = (cell ?? '').trim();
  if (!text.includes('`')) return text;
  const open = /^`+/.exec(text);
  if (!open) return null;
  const rest = text.slice(open[0].length);
  for (const run of rest.matchAll(/`+/g)) {
    if (run[0].length !== open[0].length) continue;
    return run.index + run[0].length === rest.length ? rest.slice(0, run.index).trim() : null;
  }
  return null;
}

const opensWithBar = (line) => /^\s*\|/.test(line);
const isDivider = (line) => opensWithBar(line) && tableCells(line).every((c) => /^:?-+:?$/.test(c));
// A code fence opens on a run of three or more backticks or tildes; the text after a backtick run
// holds no backtick.
const FENCE_OPEN = /^\s*(?:(`{3,})[^`]*|(~{3,}).*)$/;
const INDENTED = /^(?: {4}| {0,3}\t)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// Every line of the file, each {line, n, hidden, heading}. The block state runs from the first line
// of the file, so a block that opens above the steps section is followed into it. A line is hidden
// when GitHub shows no table and no heading for it: a code fence and the lines inside it, a line
// indented as code (four spaces or a tab), and an HTML comment that opens its line, up to and
// including the line that closes it. A fence closes as CommonMark has it: on a line that is a run of
// the opening character, at least as long as the opening run, with only spaces after it. `heading`
// is {level, text} for a heading line that is not hidden, and null for any other line.
function fileLines(text) {
  const out = [];
  // The opening run of the fence the line is inside, or null.
  let fence = null;
  let inComment = false;
  lines(text).forEach((line, i) => {
    let hidden = false;
    if (fence !== null) {
      hidden = true;
      const run = /^\s*(`+|~+)[ \t]*$/.exec(line)?.[1];
      if (run && run[0] === fence[0] && run.length >= fence.length) fence = null;
    } else if (inComment) {
      hidden = true;
      inComment = !line.includes('-->');
    } else if (FENCE_OPEN.test(line)) {
      hidden = true;
      const open = FENCE_OPEN.exec(line);
      fence = open[1] ?? open[2];
    } else if (/^ {0,3}<!--/.test(line)) {
      hidden = true;
      inComment = !line.slice(line.indexOf('<!--') + 4).includes('-->');
    } else if (INDENTED.test(line) && line.trim() !== '') {
      hidden = true;
    }
    const m = hidden ? null : HEADING.exec(line);
    out.push({ line, n: i + 1, hidden, heading: m ? { level: m[1].length, text: m[2] } : null });
  });
  return out;
}

// The steps table of one observability.md: `rel` is the file's path as the messages name it.
// The file takes one steps heading that is not hidden; a second is an error naming its line. The
// section is read whole and fails closed. A hidden line is not read. Of the other lines, one
// that holds no vertical bar is no part of a table (prose, `Not yet known`, `None`), and one that
// holds a bar is a line of the one steps table in its exact form or an error naming its line: no
// line that could read as a step to a person is passed over without a message.
export function docSteps(text, rel) {
  const out = { steps: [], warnings: [], errors: [] };
  const all = fileLines(text);
  const refuse = (n, message) => {
    out.errors.push(`${rel}:${n}: ${message}`);
    return out;
  };
  const sections = all.filter((l) => l.heading?.level === 2 && l.heading.text === STEPS_HEADING);
  if (sections.length === 0) return out;
  // Only one section is read, so a table under a second would be passed over.
  if (sections.length > 1) {
    return refuse(sections[1].n, `a second heading "## ${STEPS_HEADING}"; the first is at line ${sections[0].n}, and the file takes one steps section`);
  }
  const start = sections[0].n;
  const end = all.find((l) => l.n > start && l.heading && l.heading.level <= 2)?.n ?? Infinity;
  const headingLines = new Set(all.filter((l) => l.heading).map((l) => l.n));
  const body = all.filter((l) => l.n > start && l.n < end);

  const seen = new Map();
  // 'before' the header, in the 'rows', or 'after' the table's end.
  let state = 'before';
  for (let k = 0; k < body.length; k++) {
    const { line, n, hidden } = body[k];
    const where = `${rel}:${n}`;
    if (state === 'rows') {
      // A row indented as code may still show as a row of the table it follows, so it is not passed over.
      if (hidden && INDENTED.test(line) && line.includes('|')) {
        out.errors.push(`${where}: a row of the steps table is indented as code; write it from the start of the line, opening with a bar`);
        continue;
      }
      // A blank line, a heading, a code fence or an HTML comment ends the table.
      if (hidden || line.trim() === '' || headingLines.has(n)) state = 'after';
    }
    if (hidden || !line.includes('|')) continue;

    if (state === 'after') {
      return refuse(n, `a line holding a vertical bar after the steps table has ended; the section takes one steps table and no other line holding a bar: ${FORM}`);
    }

    if (state === 'before') {
      if (!opensWithBar(line)) return refuse(n, `a line holding a vertical bar that is not the header of the steps table; ${FORM}`);
      const header = tableCells(line);
      if (header.length !== COLUMNS.length || !header.every((c, i) => c === COLUMNS[i])) {
        return refuse(n, `the steps table has the columns ${header.join(', ')}; it takes two, Step then Command, in plain text and these capitals: ${FORM}`);
      }
      const next = body[k + 1];
      if (!next || next.hidden || !isDivider(next.line)) return refuse(n, 'the header of the steps table needs a divider line under it, |---|---|');
      const cells = tableCells(next.line).length;
      if (cells !== COLUMNS.length) return refuse(next.n, `the divider line has ${cells} ${cells === 1 ? 'cell' : 'cells'} and the header has ${COLUMNS.length}; ${FORM}`);
      state = 'rows';
      k++;
      continue;
    }

    if (!opensWithBar(line)) {
      out.errors.push(`${where}: a line of the steps table holds a vertical bar and does not open with one; a row opens with a bar, | Step | Command |`);
      continue;
    }
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
    const run = commandText(row[1]);
    if (run === null) {
      out.errors.push(`${where}: the Command cell mixes a code span with other text; write the whole command as one code span, or with no backtick`);
      continue;
    }
    // GitHub shows no comment, and the job would run its text.
    if (name.includes('<!--') || (run.includes('<!--') && !(row[1] ?? '').includes('`'))) {
      out.errors.push(`${where}: the row holds an HTML comment; write a command that holds <!-- as one code span`);
      continue;
    }
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
