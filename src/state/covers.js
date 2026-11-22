// D-35: a verdict given on head `from` still holds on a later head `to` when `to` descends from
// `from` and every change between them is the kit's own bookkeeping: the state directory, the
// review verdicts, the journal directory (every file under it) and BUILD.md. Without this, committing the verdict and the state
// file would itself make every verdict stale. A merge of the default branch that leaves every file
// the pull request changes as it was also keeps the verdict (D-100). Any doubt (unknown commit, no
// repository, no config) is "no".
import path from 'node:path';
import { isSha, sameSha } from '../evidence.js';
import { loadConfig } from '../config.js';
import { GitError, git, resolveCommit } from '../git.js';
import { kitPaths } from '../paths.js';

// The bookkeeping paths as repository-relative prefixes (a directory ends in `/`). None of them
// depends on docsRoot, so the default only keeps kitPaths happy.
function bookkeeping(root) {
  const p = kitPaths(root, { docsRoot: 'docs' });
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  const rel = (f) => prefix + path.relative(root, f).split(path.sep).join('/');
  return {
    dirs: [p.state, path.join(p.kit, 'reviews'), p.journalDir].map((d) => `${rel(d)}/`),
    files: [rel(p.build)],
  };
}

const inBookkeeping = ({ dirs, files }, f) => files.includes(f) || dirs.some((d) => f.startsWith(d));

// A test of whether a repository-relative POSIX path of the repository at `root` is bookkeeping,
// with the bookkeeping paths worked out once (one git process) for every path it is asked about.
export function bookkeepingTest(root) {
  const kept = bookkeeping(root);
  return (rel) => inBookkeeping(kept, rel);
}

// Whether `rel`, a repository-relative POSIX path of the repository at `root`, is bookkeeping.
export function isBookkeepingPath(root, rel) {
  return bookkeepingTest(root)(rel);
}

// `merges: false` judges by D-35 alone: a merge of the default branch is a moved head (D-43).
export function headCovers(root, from, to, { merges = true } = {}) {
  if (!isSha(from) || !isSha(to)) return false;
  if (sameSha(from, to)) return true;
  try {
    const a = resolveCommit(root, from);
    const b = resolveCommit(root, to);
    if (!a || !b) return false;
    if (a === b) return true;
    try {
      git(root, ['merge-base', '--is-ancestor', a, b]);
    } catch (e) {
      if (e instanceof GitError) return false;
      throw e;
    }
    const kept = bookkeeping(root);
    if (names(root, ['diff', '--name-only', '--no-renames', a, b, '--']).every((f) => inBookkeeping(kept, f))) {
      // A bookkeeping-only difference that a merge reached by putting back older content is no cover.
      return !merges || firstParentLine(root, a, b).every(({ sha, parents }) => parents.length < 2 || keepsSecondParent(root, kept, sha, parents));
    }
    return merges && mergedDefaultOnly(root, kept, a, b);
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

const names = (root, args) => git(root, args).split('\n').filter(Boolean);

// The default branch's tips, on origin first, then local, that resolve; none without a readable config.
function defaultTips(root) {
  let name;
  try {
    name = loadConfig(root).defaultBranch;
  } catch {
    return [];
  }
  if (typeof name !== 'string' || name === '') return [];
  return [`refs/remotes/origin/${name}`, `refs/heads/${name}`]
    .map((ref) => resolveCommit(root, ref))
    .filter(Boolean);
}

const isAncestor = (root, x, y) => {
  try {
    git(root, ['merge-base', '--is-ancestor', x, y]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

// D-100, refining D-35: B adds to A, on its first-parent line, only bookkeeping commits and merges
// whose second parent the default branch reaches and which give every file the slice branch did not
// change that parent's content, and every file the pull request changes (its
// changes against the default branch's merge base at A and at B, bookkeeping aside) has the same
// content at B as at A.
// The commits B adds to A on its first-parent line, each with its parents.
const firstParentLine = (root, a, b) =>
  names(root, ['rev-list', '--first-parent', '--parents', b, `^${a}`]).map((line) => {
    const [sha, ...parents] = line.split(' ');
    return { sha, parents };
  });

// Whether merge `sha` gives every file its first parent did not change since it met the second
// parent, bookkeeping aside, the second parent's content: a merge that puts back older content of a
// file only the default branch changed does not.
function keepsSecondParent(root, kept, sha, parents) {
  const base = git(root, ['merge-base', parents[0], parents[1]]);
  const ownSide = new Set(names(root, ['diff', '--name-only', '--no-renames', base, parents[0], '--']));
  return names(root, ['diff', '--name-only', '--no-renames', parents[1], sha, '--']).every((f) => inBookkeeping(kept, f) || ownSide.has(f));
}

function mergedDefaultOnly(root, kept, a, b) {
  const tips = defaultTips(root);
  if (tips.length === 0) return false;
  for (const { sha, parents } of firstParentLine(root, a, b)) {
    if (parents.length >= 2) {
      if (!tips.some((t) => isAncestor(root, parents[1], t))) return false;
      if (!keepsSecondParent(root, kept, sha, parents)) return false;
    } else {
      const own = names(root, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '--root', sha]);
      if (!own.every((f) => inBookkeeping(kept, f))) return false;
    }
  }
  const own = new Set();
  for (const head of [a, b]) {
    const base = git(root, ['merge-base', head, tips[0]]);
    for (const f of names(root, ['diff', '--name-only', '--no-renames', base, head, '--'])) if (!inBookkeeping(kept, f)) own.add(f);
  }
  if (own.size === 0) return true;
  const files = [...own];
  const blobs = (head) => {
    const listed = git(root, ['ls-tree', '--full-tree', head, '--', ...files]);
    return new Map(listed.split('\n').filter(Boolean).map((l) => [l.slice(l.indexOf('\t') + 1), l.split(' ')[2].split('\t')[0]]));
  };
  const [at, bt] = [blobs(a), blobs(b)];
  return files.every((f) => at.get(f) === bt.get(f));
}
