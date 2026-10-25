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
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GitError, assertRef, currentBranch, git, isRepo, resolveCommit } from './git.js';
import { kitPaths } from './paths.js';
import { redact } from './redact.js';

export const GENESIS = 'genesis';
export const NO_CLONE = 'no-clone';
const FIELDS = ['actor', 'slice', 'stage', 'commits', 'verdicts', 'decisions'];
const LISTS = new Set(['commits', 'verdicts', 'decisions']);
const LINE = /^(\S+) actor=(\S+) slice=(\S+) stage=(\S+) commits=(\S+) verdicts=(\S+) decisions=(\S+) prev=(genesis|[0-9a-f]{64}) hash=([0-9a-f]{64})$/;
const CLONE_ID = /^[0-9a-f]{8}$/;

const LOCK_BUDGET_MS = 2_000;
const LOCK_WAIT_MS = 10;
const LOCK_STALE_MS = 30_000;

export class JournalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JournalError';
  }
}

const toPosix = (p) => p.split(path.sep).join('/');
const dirOf = (root, cfg) => kitPaths(root, cfg ?? { docsRoot: 'docs' }).journalDir;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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

const gitBytes = (root, args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
const lf = (buf) => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

function resolves(root, ref) {
  try {
    return resolveCommit(root, assertRef(ref)) !== null;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

// Append-only against git: every journal file at the merge base of HEAD and `against` (default: the
// default branch, local, else origin's) must still exist in the working tree and start with the base
// copy's bytes (CRLF read as LF). [] outside a repo, or when the ref or the merge base does not exist.
// -> [{file, line, message}] with message `journal file <f> was shortened or removed since <ref>`.
export function appendOnlyProblems(root, cfg, { against } = {}) {
  if (!isRepo(root)) return [];
  const def = cfg?.defaultBranch ?? 'main';
  const candidates = against != null ? [against] : [def, `origin/${def}`];
  const ref = candidates.find((r) => resolves(root, r));
  if (ref === undefined) return [];
  let base;
  try {
    base = git(root, ['merge-base', 'HEAD', ref]);
  } catch (e) {
    if (e instanceof GitError) return [];
    throw e;
  }
  const relDir = toPosix(path.relative(root, dirOf(root, cfg)));
  const listed = git(root, ['ls-tree', '-r', '--name-only', base, '--', `${relDir}/`]);
  const out = [];
  for (const rel of listed === '' ? [] : listed.split('\n')) {
    if (!rel.endsWith('.log')) continue;
    const was = lf(gitBytes(root, ['show', `${base}:${rel}`]));
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
  const lock = `${file}.lock`;
  const deadline = Date.now() + budgetMs;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
      } catch {
        // released between the attempt and the stat
      }
      if (Date.now() >= deadline) throw new JournalError(`could not lock ${toPosix(file)}: another slicekit is appending`);
      sleep(LOCK_WAIT_MS);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
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
