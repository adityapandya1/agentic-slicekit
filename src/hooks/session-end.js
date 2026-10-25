// session-end (REQ-3.8, D-32, D-34, D-36): appends one line to this clone's journal file for the current
// branch, `.slicekit/journal/<branch-part>--<clone-id>.log`. Fails open through io.js: a refused append
// (torn or unparseable last line, lock busy) is a stderr note and nothing is written.
//
// Since the last line in that file (from the start of the branch when the file is empty):
//   commits    short shas of commits on the branch beyond the default branch, committed since that line
//              (same-second commits the last line already named are left out); `-` outside a repository
//   verdicts   stems of `.slicekit/reviews/*.md` files modified since that line
//   decisions  `D-<n>` ids in the decisions table now, minus those in it at the commit HEAD stood at when
//              that line was written (the merge base with the default branch when the file is empty);
//              `-` outside a repository
import fs from 'node:fs';
import path from 'node:path';
import { GitError, assertRef, git as runGit, isRepo, resolveCommit } from '../git.js';
import { re } from '../ids.js';
import { appendJournal, journalBranch, readLast } from '../journal.js';
import { tables } from '../markdown.js';
import { kitPaths } from '../paths.js';
import { programStage } from '../stage.js';
import { allow } from './io.js';
import { activeSlice } from './paths.js';

const toPosix = (p) => p.split(path.sep).join('/');

function tryGit(git, args) {
  try {
    return git(args);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// The default branch as a commit: local first, then origin's; null when neither resolves.
function defaultBase(root, cfg) {
  const def = assertRef(cfg?.defaultBranch ?? 'main');
  for (const ref of [def, `origin/${def}`]) {
    const sha = resolveCommit(root, ref);
    if (sha) return sha;
  }
  return null;
}

function commitsSince(git, base, last) {
  const range = base ? `${base}..HEAD` : 'HEAD';
  const out = tryGit(git, ['log', '--format=%H %ct', '--end-of-options', range, '--']);
  if (!out) return [];
  const sinceSec = last ? Math.floor(Date.parse(last.at) / 1000) : -Infinity;
  const named = new Set(last?.commits ?? []);
  return out.split('\n').map((l) => l.split(' ')).filter(([, ct]) => Number(ct) >= sinceSec)
    .map(([sha]) => sha.slice(0, 7)).filter((s) => !named.has(s));
}

function verdictsSince(root, last) {
  const dir = path.join(root, '.slicekit', 'reviews');
  const since = last ? Date.parse(last.at) : -Infinity;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('.md')).filter((n) => {
    try {
      const st = fs.lstatSync(path.join(dir, n));
      return st.isFile() && st.mtimeMs > since;
    } catch {
      return false;
    }
  }).map((n) => n.slice(0, -'.md'.length));
}

const ID_RE = new RegExp(`^${re('decision').source}$`);
function decisionIds(text) {
  const out = new Set();
  for (const t of tables(text ?? '')) for (const row of t.rows) if (ID_RE.test(row[0] ?? '')) out.add(row[0]);
  return out;
}

function decisionsSince(root, cfg, git, base, last) {
  const file = kitPaths(root, cfg).decisions;
  let now = '';
  try {
    now = fs.readFileSync(file, 'utf8');
  } catch {
    // no decisions file: nothing added
  }
  const then = last
    ? tryGit(git, ['rev-list', '-1', `--before=${last.at}`, 'HEAD'])
    : base && tryGit(git, ['merge-base', base, 'HEAD']);
  const rel = toPosix(path.relative(root, file));
  const old = then ? decisionIds(tryGit(git, ['show', `${then}:${rel}`])) : new Set();
  return [...decisionIds(now)].filter((d) => !old.has(d));
}

function stageOf(root, cfg) {
  try {
    return programStage(root, cfg).stage;
  } catch {
    return '-';
  }
}

export async function handle(_input, { root, cfg, env = process.env, git = (args) => runGit(root, args) }) {
  const branch = journalBranch(root);
  const last = readLast(root, branch, cfg);
  const repo = isRepo(root);
  const base = repo ? defaultBase(root, cfg) : null;
  const active = activeSlice(root, cfg);
  appendJournal(root, {
    actor: env.SLICEKIT_ACTOR || env.USER || env.USERNAME || 'unknown',
    slice: active?.id ?? '-',
    stage: stageOf(root, cfg),
    commits: repo ? commitsSince(git, base, last) : [],
    verdicts: verdictsSince(root, last),
    decisions: repo ? decisionsSince(root, cfg, git, base, last) : [],
  }, { branch, cfg });
  return allow();
}
