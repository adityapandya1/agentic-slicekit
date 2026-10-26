import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../../redact.js';
import { TrackerError, assertFinding, assertIssueId, assertIssueTitle, assertLabels, assertSlice, pickFinding } from './errors.js';

// The test seam for C-2: a directory holding the tracker's issues.
//   issues.json              [{number, url, title, body, labels, comments}]; missing reads as []
//   issue-create-error.txt   the tracker refusing `open`
//   issue-calls.jsonl        written: `{op, ...input}` per write (open, comment), in order
// `open` appends an issue numbered one above the highest there, at https://example.test/issues/<n>.
// Nothing here closes an issue.
const issuesFile = (dir) => path.join(dir, 'issues.json');

function readIssues(dir) {
  try {
    const list = JSON.parse(fs.readFileSync(issuesFile(dir), 'utf8'));
    if (!Array.isArray(list)) throw new Error('not a list');
    return list;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new TrackerError(`tracker fixture ${issuesFile(dir)}: ${e.message}`);
  }
}

const writeIssues = (dir, list) => fs.writeFileSync(issuesFile(dir), `${JSON.stringify(list, null, 2)}\n`);
const record = (dir, call) => fs.appendFileSync(path.join(dir, 'issue-calls.jsonl'), `${JSON.stringify(call)}\n`);

function refuse(dir, file, call) {
  let refusal;
  try {
    refusal = fs.readFileSync(path.join(dir, file), 'utf8').trim();
  } catch (e) {
    if (e.code !== 'ENOENT') throw new TrackerError(`tracker fixture ${dir}: ${e.message}`);
  }
  if (refusal !== undefined) throw new TrackerError(`${call} failed: ${redact(refusal)}`, { stderr: refusal });
}

export function fixtureTracker(dir) {
  return {
    kind: 'fixture',
    open({ title, body, labels = [], slice }) {
      assertIssueTitle(title);
      assertLabels(labels);
      assertSlice(slice);
      refuse(dir, 'issue-create-error.txt', 'gh issue create');
      const list = readIssues(dir);
      const number = list.reduce((n, i) => Math.max(n, Number.isInteger(i?.number) ? i.number : 0), 0) + 1;
      const url = `https://example.test/issues/${number}`;
      const text = String(body ?? '');
      writeIssues(dir, [...list, { number, url, title, body: text, labels: [...labels], comments: [] }]);
      record(dir, { op: 'open', title, body: text, labels: [...labels], slice });
      return { id: number, url };
    },
    comment(id, body) {
      assertIssueId(id);
      const list = readIssues(dir);
      const issue = list.find((i) => i?.number === id);
      if (!issue) throw new TrackerError(`issue ${id} not found`);
      const text = String(body ?? '');
      issue.comments = [...(issue.comments ?? []), { body: text }];
      writeIssues(dir, list);
      record(dir, { op: 'comment', id, body: text });
    },
    find(slice, finding) {
      assertSlice(slice);
      assertFinding(finding);
      return pickFinding(readIssues(dir), slice, finding);
    },
  };
}
