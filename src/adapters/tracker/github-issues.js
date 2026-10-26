import { execFileSync } from 'node:child_process';
import { GitHostError } from '../githost/errors.js';
import { gh } from '../githost/github.js';
import { TrackerError, assertFinding, assertIssueId, assertIssueTitle, assertLabels, assertSlice, pickFinding } from './errors.js';

// C-2 for GitHub Issues through the `gh` CLI, spawned the way the git host spawns it. gh picks the
// repository from its working directory, so every call runs in the project root. `exec` is the test
// seam; it defaults to execFileSync. Nothing here closes an issue.
const LIST_FIELDS = 'number,url,title';

// The number and url gh prints for an issue it made: the last line holding `/issues/<n>`.
export function parseIssueUrl(out) {
  const line = String(out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => /^https?:\/\/\S+\/issues\/\d+$/.test(l));
  if (line === undefined) return null;
  return { id: Number(/\/issues\/(\d+)$/.exec(line)[1]), url: line };
}

export function githubIssues(env = process.env, root = process.cwd(), exec = execFileSync) {
  const run = (args, input) => {
    try {
      return gh(exec, args, { env, cwd: root, ...(input === undefined ? {} : { input }) });
    } catch (e) {
      if (e instanceof GitHostError) throw new TrackerError(e.message, { stderr: e.stderr });
      throw e;
    }
  };
  return {
    kind: 'github-issues',
    // Each value is one `--flag=value` argument, so a title or label starting with "-" is not read
    // as a flag; the body goes on stdin.
    open({ title, body, labels = [], slice }) {
      assertIssueTitle(title);
      assertLabels(labels);
      assertSlice(slice);
      const args = ['issue', 'create', `--title=${title}`, '--body-file', '-', ...labels.map((l) => `--label=${l}`)];
      const made = parseIssueUrl(run(args, String(body ?? '')));
      if (made === null) throw new TrackerError('gh issue create printed no issue url');
      return made;
    },
    comment(id, body) {
      assertIssueId(id);
      run(['issue', 'comment', String(id), '--body-file', '-'], String(body ?? ''));
    },
    // GitHub's search is loose, so its hits are narrowed to a title that begins `[<slice>] <finding>:`.
    find(slice, finding) {
      assertSlice(slice);
      assertFinding(finding);
      const out = run(['issue', 'list', '--state', 'all', '--search', `${slice} ${finding} in:title`, '--json', LIST_FIELDS, '--limit', '50']);
      let list;
      try {
        list = JSON.parse(out);
      } catch (e) {
        throw new TrackerError(`gh issue list printed something that is not JSON: ${e.message}`);
      }
      return pickFinding(list, slice, finding);
    },
  };
}
