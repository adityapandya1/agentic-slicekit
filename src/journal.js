// The session journal (03 REQ-3.8, D-32, D-34, D-36): append-only, hash-chained files under
// `.slicekit/journal/`, one per branch per clone, named `<branch-part>--<clone-id>.log`, each its own
// chain from `prev=genesis`. Two branches, or two clones on one branch, never append to the same file,
// so merging never conflicts and never breaks a chain. One line per session end:
//
//   <iso> actor=<a> slice=<id|-> stage=<s> commits=<sha7,…|-> verdicts=<ids|-> decisions=<ids|-> prev=<hash|genesis> hash=<sha256>
//
// `hash` is the SHA-256 of the line up to and including `prev=<…>`. Values carry no spaces and no `=`:
// every value is masked with redact() first, then whitespace and `=` become `_`.
//
// What is protected: a mid-chain edit is caught by the chain (verifyJournal); shortening or removing a
// committed file is caught against the default branch (appendOnlyProblems); lines not yet committed are
// not protected. Nothing here repairs a journal.
//
// The chain carries no key: anyone who rewrites a file can recompute every hash, so the chain shows an
// edit only against what the default branch already holds. The `actor` field is what the session
// reports and proves nothing about who ran it. What binds a journal to a person is the commit that
// carries it (D-71): under `check --ci` every commit of the pull request that changes a journal file
// must be signed and verified by the git host (C-1 getCommit). The sync pull request records each
// merged journal's last hash in `.slicekit/journal-heads.log` (headsLines), with the CI run that wrote
// it, and `check --ci` recomputes every line that file gains from git and C-1 getRun rather than trust
// its writer (D-89). The kit manages no keys.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GitError, assertRef, currentBranch, git, isRepo, resolveCommit } from './git.js';
import { toPosix } from './hooks/paths.js';
import { LOCK_WAIT_MS, sleep, withFileLock } from './lock.js';
import { kitPaths } from './paths.js';
import { redact } from './redact.js';

export const GENESIS = 'genesis';
export const NO_CLONE = 'no-clone';
const FIELDS = ['actor', 'slice', 'stage', 'commits', 'verdicts', 'decisions'];
const LISTS = new Set(['commits', 'verdicts', 'decisions']);
const LINE = /^(\S+) actor=(\S+) slice=(\S+) stage=(\S+) commits=(\S+) verdicts=(\S+) decisions=(\S+) prev=(genesis|[0-9a-f]{64}) hash=([0-9a-f]{64})$/;
const CLONE_ID = /^[0-9a-f]{8}$/;

const LOCK_BUDGET_MS = 2_000;

export class JournalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JournalError';
  }
}

const dirOf = (root, cfg) => kitPaths(root, cfg ?? { docsRoot: 'docs' }).journalDir;

export const hashLine = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// A branch name as the first part of a file name: `/` → `__`, anything outside [A-Za-z0-9._-] → `_`.
// When that changed the name, or the name is longer than 80 characters, it is cut to 60 and gets `-`
// and the first 8 hex of the raw name's SHA-256, so `feature/a` and `feature__a` never share a file.
export function branchPart(branch) {
  const raw = String(branch);
  const clean = raw.replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_');
  if (clean === raw && raw.length <= 80) return clean;
  return `${clean.slice(0, 60)}-${hashLine(raw).slice(0, 8)}`;
}

// The branch whose file a session at root appends to: its name, `detached`, or `no-branch` outside a repo.
export function journalBranch(root) {
  try {
    return currentBranch(root) ?? 'detached';
  } catch (e) {
    if (e instanceof GitError) return 'no-branch';
    throw e;
  }
}

function cloneIdFile(root) {
  try {
    return path.join(path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])), 'slicekit', 'clone-id');
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

function readId(file) {
  try {
    const id = fs.readFileSync(file, 'utf8').trim();
    return CLONE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

// This clone's id: 8 random hex characters kept at `<git-common-dir>/slicekit/clone-id`, so the
// worktrees of one clone share it. `no-clone` outside git. With create false, null when it is not made
// yet; with create true it is made once (wx), and a process that loses the race reads the winner's.
export function cloneId(root, { create = false } = {}) {
  const file = cloneIdFile(root);
  if (file === null) return NO_CLONE;
  const have = readId(file);
  if (have || !create) return have;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const id = crypto.randomBytes(4).toString('hex');
  try {
    fs.writeFileSync(file, `${id}\n`, { flag: 'wx' });
    return id;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const deadline = Date.now() + LOCK_BUDGET_MS;
  for (;;) {
    const won = readId(file);
    if (won) return won;
    if (Date.now() >= deadline) throw new JournalError(`${toPosix(file)} holds no clone id`);
    sleep(LOCK_WAIT_MS);
  }
}

// The file this clone appends to for branch; null when the clone has no id yet and create is false.
export function journalFile(root, branch, cfg, { create = false } = {}) {
  const id = cloneId(root, { create });
  return id === null ? null : path.join(dirOf(root, cfg), `${branchPart(branch)}--${id}.log`);
}

function value(v) {
  const s = redact(String(v ?? '')).replace(/[\s=]/g, '_');
  return s === '' ? '-' : s;
}

function list(v) {
  const items = (Array.isArray(v) ? v : v == null || v === '' || v === '-' ? [] : [v])
    .map((x) => value(x).replace(/,/g, '_')).filter((x) => x !== '-');
  return items.length === 0 ? '-' : [...new Set(items)].sort().join(',');
}

// The text the hash covers: the line up to and including `prev=<…>`.
export function lineBody(fields, prev, at) {
  const parts = FIELDS.map((k) => `${k}=${LISTS.has(k) ? list(fields[k]) : value(fields[k])}`);
  return `${value(at)} ${parts.join(' ')} prev=${prev}`;
}

// -> {at, actor, slice, stage, commits[], verdicts[], decisions[], prev, hash, body}, or null.
export function parseLine(text) {
  const m = LINE.exec(String(text).replace(/\r$/, ''));
  if (!m) return null;
  const split = (s) => (s === '-' ? [] : s.split(','));
  const [, at, actor, slice, stage, commits, verdicts, decisions, prev, hash] = m;
  const body = m[0].slice(0, m[0].lastIndexOf(' hash='));
  return { at, actor, slice, stage, commits: split(commits), verdicts: split(verdicts), decisions: split(decisions), prev, hash, body };
}

// One file's text: {lines, brokenAt}. The first line whose hash or prev link does not hold is the break;
// a last line with no newline (a torn write) is a break at its own number.
function verifyText(text) {
  if (text === '') return { lines: 0, brokenAt: null };
  const parts = text.split('\n');
  const torn = parts.at(-1) !== '';
  const complete = parts.slice(0, -1);
  let prev = GENESIS;
  for (let i = 0; i < complete.length; i++) {
    const p = parseLine(complete[i]);
    if (!p || p.prev !== prev || hashLine(p.body) !== p.hash) return { lines: complete.length, brokenAt: i + 1 };
    prev = p.hash;
  }
  return { lines: complete.length, brokenAt: torn ? complete.length + 1 : null };
}

export const NO_BASE = 'journal: no base to compare against (fetch the default branch with full history)';
export const brokenMessage = (file, n) => `journal chain broken at line ${n} of ${file}`;
const unexpectedMessage = (name) => `unexpected entry ${name} in .slicekit/journal/`;

// Every regular `*.log` file directly under .slicekit/journal/, by name, whatever the name. Anything else
// there (another name, a directory, a link) except a `*.lock` is a problem. Never writes.
// -> {ok, lines, brokenAt, file, message, problems: [{file, line, message}], files: [{file, lines, brokenAt}]};
// `file` and `brokenAt` name the first chain break, `message` the first problem.
export function verifyJournal(root, cfg) {
  const dir = dirOf(root, cfg);
  const relDir = toPosix(path.relative(root, dir));
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
  }
  const files = [];
  const problems = [];
  let first = null;
  for (const d of entries) {
    const rel = `${relDir}/${d.name}`;
    if (!(d.isFile() && d.name.endsWith('.log'))) {
      if (!(d.isFile() && d.name.endsWith('.lock'))) problems.push({ file: rel, line: 0, message: unexpectedMessage(d.name) });
      continue;
    }
    const r = verifyText(fs.readFileSync(path.join(dir, d.name), 'utf8'));
    files.push({ file: rel, lines: r.lines, brokenAt: r.brokenAt });
    if (r.brokenAt !== null) {
      problems.push({ file: rel, line: r.brokenAt, message: brokenMessage(rel, r.brokenAt) });
      first ??= { file: rel, brokenAt: r.brokenAt };
    }
  }
  return {
    ok: problems.length === 0,
    lines: files.reduce((n, f) => n + f.lines, 0),
    brokenAt: first?.brokenAt ?? null,
    file: first?.file ?? null,
    message: problems[0]?.message ?? null,
    problems,
    files,
  };
}

function gitBytes(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  } catch (e) {
    throw new GitError(args, String(e.stderr ?? e.message).trim());
  }
}
const lf = (buf) => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

function resolves(root, ref) {
  try {
    return resolveCommit(root, assertRef(ref)) !== null;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

// The merge base of `tip` and `against` (default: the default branch, local, else origin's), as
// { ref, base }, or null when neither ref nor a merge base exists.
export function mergeBaseWith(root, cfg, { against, tip = 'HEAD' } = {}) {
  const def = cfg?.defaultBranch ?? 'main';
  const candidates = against != null ? [against] : [def, `origin/${def}`];
  const ref = candidates.find((r) => resolves(root, r));
  if (ref === undefined) return null;
  try {
    return { ref, base: git(root, ['merge-base', assertRef(tip), ref]) };
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// Append-only against git: every journal file at the merge base of HEAD and `against` (default: the
// default branch, local, else origin's) must still exist in the working tree and start with the base
// copy's bytes (CRLF read as LF). [] outside a repo. When the ref or the merge base does not exist: []
// locally, and with ci one problem saying so (a CI checkout without the default branch's history).
// root may sit below the git top level; the files reported are relative to root.
// -> [{file, line, message}] with message `journal file <f> was shortened or removed since <ref>`.
export function appendOnlyProblems(root, cfg, { against, ci = false } = {}) {
  if (!isRepo(root)) return [];
  const relDir = toPosix(path.relative(root, dirOf(root, cfg)));
  const found = mergeBaseWith(root, cfg, { against });
  if (found === null) return ci ? [{ file: relDir, line: 0, message: NO_BASE }] : [];
  const { ref, base } = found;
  // --full-name lists paths from the top level, as `git show <base>:<path>` takes them; the prefix
  // (root's place below the top level) maps each back to root.
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  const listed = git(root, ['ls-tree', '-r', '--full-name', '--name-only', base, '--', `${relDir}/`]);
  const out = [];
  for (const full of listed === '' ? [] : listed.split('\n')) {
    if (!full.endsWith('.log') || !full.startsWith(prefix)) continue;
    const rel = full.slice(prefix.length);
    const was = lf(gitBytes(root, ['show', `${base}:${full}`]));
    let now = null;
    try {
      now = lf(fs.readFileSync(path.join(root, ...rel.split('/'))));
    } catch {
      now = null;
    }
    if (now === null || now.length < was.length || !now.subarray(0, was.length).equals(was)) {
      out.push({ file: rel, line: 0, message: `journal file ${rel} was shortened or removed since ${ref}` });
    }
  }
  return out;
}

function readIfAny(file) {
  if (file === null) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// The text's last line (the one before the final newline), or null for an empty text.
function lastLine(text) {
  if (text === '') return null;
  const parts = text.split('\n');
  return parts.length >= 2 ? parts.at(-2) : null;
}

// The last line of this clone's file for branch, parsed; null when there is none or it does not parse.
export function readLast(root, branch = journalBranch(root), cfg) {
  const text = readIfAny(journalFile(root, branch, cfg));
  if (text !== '' && !text.endsWith('\n')) return null;
  const line = lastLine(text);
  return line === null ? null : parseLine(line);
}

function withLock(file, fn, budgetMs) {
  return withFileLock(`${file}.lock`, fn, {
    budgetMs,
    busy: () => new JournalError(`could not lock ${toPosix(file)}: another slicekit is appending`),
  });
}

function writeAll(fd, text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
}

// Appends one line to this clone's file for branch, under a lock, and returns it (no newline). Refuses a
// file whose last line is torn or is not a journal line (a blank line included): the chain is never
// continued from a guess.
export function appendJournal(root, fields, { branch = journalBranch(root), now = new Date(), cfg, budgetMs = LOCK_BUDGET_MS } = {}) {
  const file = journalFile(root, branch, cfg, { create: true });
  const shown = toPosix(path.relative(root, file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withLock(file, () => {
    const text = readIfAny(file);
    if (text !== '' && !text.endsWith('\n')) throw new JournalError(`${shown} ends in a torn line; not appending`);
    const last = lastLine(text);
    let prev = GENESIS;
    if (last !== null) {
      const p = parseLine(last);
      if (!p) throw new JournalError(`${shown} last line does not parse; not appending`);
      prev = p.hash;
    }
    const body = lineBody(fields, prev, now.toISOString());
    const line = `${body} hash=${hashLine(body)}`;
    const fd = fs.openSync(file, 'a');
    try {
      writeAll(fd, `${line}\n`);
    } finally {
      fs.closeSync(fd);
    }
    return line;
  }, budgetMs);
}

// ---- signed commits and the journal-heads file (03 REQ-3.8, D-71, D-89) ----

export const HEADS_FILE = 'journal-heads.log';
export const SIGNED_MESSAGE = 'journal commits must be signed';
const HEADS_LINE = /^(\S+) hash=(\S+) merge=([0-9a-f]{40}) run=(\S+) workflow=(\S+) actor=(\S+)$/;

// Where the sync pull request records each merged journal's last hash: `.slicekit/journal-heads.log`.
export const headsPath = (root, cfg) => path.join(kitPaths(root, cfg ?? { docsRoot: 'docs' }).kit, HEADS_FILE);

// One line of the journal-heads file (no newline):
//   <journal file> hash=<its last hash> merge=<merge sha> run=<run id> workflow=<name> actor=<login>
// Every value goes through the journal's own masking, so none carries a space or `=`.
export function headsLine({ file, hash, merge, run, workflow, actor }) {
  return `${value(file)} hash=${value(hash)} merge=${value(merge)} run=${value(run)} workflow=${value(workflow)} actor=${value(actor)}`;
}

// -> {file, hash, merge, run, workflow, actor}, or null.
export function parseHeadsLine(text) {
  const m = HEADS_LINE.exec(String(text).replace(/\r$/, ''));
  if (!m) return null;
  const [, file, hash, merge, run, workflow, actor] = m;
  return { file, hash, merge, run, workflow, actor };
}

const gitOr = (root, args, fallback) => {
  try {
    return git(root, args);
  } catch (e) {
    if (e instanceof GitError) return fallback;
    throw e;
  }
};

// The bytes of `rel` (relative to root) at commit `rev` (CRLF read as LF), or null when it has none.
function bytesAt(root, rev, rel) {
  try {
    return lf(gitBytes(root, ['show', `${rev}:./${rel}`]));
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// The journal files a heads line is owed for at merge commit `merge` (REQ-3.8), sorted by file, each
// as {file, hash} with its last hash at the merge ('-' when it has none). A file is owed a line when its
// last hash at the merge differs from the last hash the heads log `recorded` gives for it. A file the log
// does not name is owed one when its last hash differs from its last hash at the newest merge the log
// names (absent there counts as different). While the log names no merge yet, a merge commit with two
// or more parents compares against its first parent, the default branch before the merge; any other
// commit (a fast-forward, rebase or squash push, or a root commit) owes a line for every journal file it
// holds, because git alone cannot say where its push began and check --ci must compute the same set.
// So a push of several commits and a merge whose sync pull request was superseded before it merged both
// get their lines from the next sync. `recorded`
// is the heads log text the lines will be appended to; it defaults to the log at the merge commit.
// Computed from git alone. Throws GitError when `merge` is not a commit of this clone.
export function headsFiles(root, cfg, merge, { recorded } = {}) {
  const sha = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${assertRef(merge)}^{commit}`]);
  const relDir = toPosix(path.relative(root, dirOf(root, cfg)));
  const log = recorded ?? (bytesAt(root, sha, toPosix(path.relative(root, headsPath(root, cfg)))) ?? Buffer.alloc(0)).toString('utf8');
  const named = new Map();
  let lastMerge = null;
  for (const text of log.split('\n')) {
    const p = parseHeadsLine(text);
    if (p === null) continue;
    named.set(p.file, p.hash);
    lastMerge = p.merge;
  }
  const base = lastMerge !== null
    ? gitOr(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${lastMerge}^{commit}`], '')
    : gitOr(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^2`], '') === ''
      ? ''
      : gitOr(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^1`], '');
  const inDir = (listed) => (listed === '' ? [] : listed.split('\n'))
    .map((f) => f.replace(/\r$/, ''))
    .filter((f) => f.startsWith(`${relDir}/`) && f.endsWith('.log') && !f.slice(relDir.length + 1).includes('/'));
  const lastHashAt = (rev, file) => {
    const bytes = bytesAt(root, rev, file);
    if (bytes === null) return null;
    const text = bytes.toString('utf8');
    const last = text.endsWith('\n') ? lastLine(text) : null;
    return (last === null ? null : parseLine(last)?.hash) ?? '-';
  };
  const out = [];
  for (const file of inDir(git(root, ['ls-tree', '-r', '--name-only', sha, '--', `${relDir}/`])).sort()) {
    const hash = lastHashAt(sha, file);
    const was = named.has(file) ? named.get(file) : base === '' ? null : lastHashAt(base, file);
    if (hash !== was) out.push({ file, hash });
  }
  return out;
}

// The lines the sync job adds to the journal-heads file for merge commit `merge` (REQ-3.8): one per
// file headsFiles names, with the run's id, workflow and actor. The sync job writes with it (`slicekit
// journal heads`, values from the run's environment, against the log at the merge), and `check --ci`
// recomputes with it (values from C-1 getRun, against the log at the merge base), so the two cannot
// drift. Throws GitError when `merge` is not a commit of this clone.
export function headsLines(root, cfg, merge, { run, workflow, actor }, { recorded } = {}) {
  const sha = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${assertRef(merge)}^{commit}`]);
  return headsFiles(root, cfg, sha, { recorded }).map(({ file, hash }) => headsLine({ file, hash, merge: sha, run, workflow, actor }));
}

// Appends lines to the journal-heads file and returns them. The file is written only here.
export function appendHeads(root, cfg, lines) {
  if (lines.length === 0) return [];
  const file = headsPath(root, cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = readIfAny(file);
  const sep = text !== '' && !text.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${sep}${lines.join('\n')}\n`);
  return lines;
}

// The commits after `base` up to `tip` that change a file under .slicekit/journal/, newest first.
// The journal-heads file sits beside that directory, not in it, so a sync commit is not one of them.
export function journalCommits(root, cfg, base, tip) {
  const relDir = toPosix(path.relative(root, dirOf(root, cfg)));
  const out = git(root, ['log', '--format=%H', `${assertRef(base)}..${assertRef(tip)}`, '--', `${relDir}/`]);
  return out === '' ? [] : out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// The journal-heads file at `base` and at `tip`: { rel, was, now } (bytes, LF; empty when absent).
export function headsAt(root, cfg, base, tip) {
  const rel = toPosix(path.relative(root, headsPath(root, cfg)));
  return { rel, was: bytesAt(root, base, rel) ?? Buffer.alloc(0), now: bytesAt(root, tip, rel) ?? Buffer.alloc(0) };
}
