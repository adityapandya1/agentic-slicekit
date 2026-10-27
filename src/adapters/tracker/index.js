import { TrackerError } from './errors.js';
import { fixtureTracker } from './fixture.js';
import { githubIssues } from './github-issues.js';

export { TrackerError };

// C-2: the only door to a tracker. A second tracker (Jira) is a second file and one more branch here.
// `root` is the project the tracker is asked about; gh reads the repository from it.
export function getTracker(cfg, env = process.env, root = process.cwd()) {
  if (env.SLICEKIT_TRACKER_FIXTURE) return fixtureTracker(env.SLICEKIT_TRACKER_FIXTURE);
  const kind = cfg?.tracker?.kind;
  if (kind === 'github-issues') return githubIssues(env, root);
  throw new TrackerError(`unsupported tracker: ${kind}`);
}
