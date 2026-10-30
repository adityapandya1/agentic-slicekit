// What the graph reads from git (REQ-4.2): the default branch and every slice/* branch, each
// commit's parents, committer date, subject, Slice trailers and touched paths. Never file contents.
import { execFileSync } from 'node:child_process';
import { GraphError, cmp } from './schema.js';

const MAX = 1024 * 1024 * 1024;

function run(root, args, input) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    maxBuffer: MAX,
  });
}

function tryRun(root, args) {
  try {
    return run(root, args).trim();
  } catch {
    return null;
  }
}

const verify = (root, ref) => tryRun(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);

export function defaultRef(repoRoot, branch) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const sha = verify(repoRoot, ref);
    if (sha) return { ref, sha };
  }
  throw new GraphError(1, `the default branch ${branch} is not present here; fetch it`);
}

// The default branch first, then every local and origin slice/* branch, sorted by ref name.
export function refTips(repoRoot, branch) {
  const tips = [defaultRef(repoRoot, branch)];
  const out = run(repoRoot, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)', 'refs/heads/slice/', 'refs/remotes/origin/slice/']);
  const rest = out
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.split('\0'))
    .filter(([, , type]) => type === 'commit')
    .map(([ref, sha]) => ({ ref, sha }))
    .sort((a, b) => cmp(a.ref, b.ref));
  return [...tips, ...rest];
}

const FORMAT = '--format=%x1e%H%x1f%P%x1f%cI%x1f%s%x1f%(trailers:key=Slice,valueonly,unfold,separator=%x1d)%x1f';

// The commits reachable from `include` and not from `exclude`, one `git log`; a merge lists no files.
export function walkCommits(repoRoot, { include = [], exclude = [] } = {}) {
  if (include.length === 0) return [];
  const args = ['-c', 'core.quotePath=false', 'log', '--no-renames', '--name-only', '-z', FORMAT, ...include];
  if (exclude.length > 0) args.push('--not', ...exclude);
  args.push('--');
  const out = run(repoRoot, args);
  const commits = [];
  for (const rec of out.split('\x1e')) {
    if (rec === '') continue;
    const cut = rec.lastIndexOf('\x1f');
    const [sha, parents, date, subject, trailers] = rec.slice(0, cut).split('\x1f');
    const files = rec.slice(cut + 1).split('\0').map((f) => f.replace(/^\n/, '')).filter((f) => f !== '');
    const slices = [...new Set((trailers ?? '').split('\x1d').map((s) => s.trim()).filter((s) => /^P\d+\/S-\d{2}$/.test(s)))].sort(cmp);
    commits.push({ sha, parents: parents === '' ? [] : parents.split(' '), date, subject, slices, files: parents.includes(' ') ? [] : [...new Set(files)].sort(cmp) });
  }
  return commits;
}

// Every commit reachable from shas.
export function reachable(repoRoot, shas) {
  if (shas.length === 0) return new Set();
  const out = run(repoRoot, ['rev-list', '--stdin'], `${shas.join('\n')}\n`);
  return new Set(out.split('\n').filter((l) => l !== ''));
}

// The shas among `shas` that name a commit here (a recorded tip may have been collected since).
export function existing(repoRoot, shas) {
  if (shas.length === 0) return [];
  const out = run(repoRoot, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], `${shas.join('\n')}\n`);
  return out.split('\n').map((l) => l.split(' ')).filter(([, type]) => type === 'commit').map(([sha]) => sha);
}

// The https form of an origin on GitHub, or null.
export function webUrl(repoRoot) {
  const url = tryRun(repoRoot, ['remote', 'get-url', 'origin']);
  if (!url) return null;
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}
