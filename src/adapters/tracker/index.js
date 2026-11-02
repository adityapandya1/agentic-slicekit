import { TrackerError } from './errors.js';
import { fixtureTracker } from './fixture.js';
import { githubIssues } from './github-issues.js';
import { jiraTracker } from './jira.js';

export { TrackerError };

// C-2: the only door to a tracker. Each tracker is one file and one branch here; Jira validates its
// own config keys (D-74), so src/config.js checks only that tracker.kind is a string.
// `root` is the project the tracker is asked about; gh reads the repository from it.
// GitHub Issues answers synchronously; Jira answers with promises, so a caller awaits each answer.
export function getTracker(cfg, env = process.env, root = process.cwd()) {
  if (env.SLICEKIT_TRACKER_FIXTURE) return fixtureTracker(env.SLICEKIT_TRACKER_FIXTURE);
  const kind = cfg?.tracker?.kind;
  if (kind === 'github-issues') return githubIssues(env, root);
  if (kind === 'jira') return jiraTracker(cfg, env);
  throw new TrackerError(`unsupported tracker: ${kind}`);
}
