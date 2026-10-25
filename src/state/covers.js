// D-35: a verdict given on head `from` still holds on a later head `to` when `to` descends from
// `from` and every change between them is the kit's own bookkeeping: the state directory, the
// review verdicts, the journal and BUILD.md. Without this, committing the verdict and the state
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
    dirs: [p.state, path.join(p.kit, 'reviews'), path.join(p.kit, 'journal')].map((d) => `${rel(d)}/`),
    files: [rel(p.journal), rel(p.build)],
  };
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
    const { dirs, files } = bookkeeping(root);
    return changed.every((f) => files.includes(f) || dirs.some((d) => f.startsWith(d)));
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}
