// D-35: a verdict given on head `from` still holds on a later head `to` when `to` descends from
// `from` and every change between them is the kit's own bookkeeping: the state directory, the
// review verdicts, the journal directory (every file under it) and BUILD.md. Without this, committing the verdict and the state
// file would itself make every verdict stale. Any doubt (unknown commit, no repository) is "no".
import path from 'node:path';
import { isSha, sameSha } from '../evidence.js';
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

export function headCovers(root, from, to) {
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
    const out = git(root, ['diff', '--name-only', '--no-renames', a, b, '--']);
    const changed = out === '' ? [] : out.split('\n');
    const kept = bookkeeping(root);
    return changed.every((f) => inBookkeeping(kept, f));
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}
