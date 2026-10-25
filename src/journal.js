// The session journal (03 REQ-3.8, D-32, D-34): one append-only, hash-chained file per branch under
// `.slicekit/journal/`, each its own chain from `prev=genesis`, so two branches that both appended merge
// without breaking either chain. One line per session end:
//
//   <iso> actor=<a> slice=<id|-> stage=<s> commits=<sha7,…|-> verdicts=<ids|-> decisions=<ids|-> prev=<hash|genesis> hash=<sha256>
//
// `hash` is the SHA-256 of the line up to and including `prev=<…>`. Values carry no spaces and no `=`:
// every value is masked with redact() first, then whitespace and `=` become `_`. A broken chain is
// reported, never repaired: verifyJournal only reads. A deleted whole file shows only in git history.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GitError, currentBranch } from './git.js';
import { kitPaths } from './paths.js';
import { redact } from './redact.js';

export const GENESIS = 'genesis';
const FIELDS = ['actor', 'slice', 'stage', 'commits', 'verdicts', 'decisions'];
const LISTS = new Set(['commits', 'verdicts', 'decisions']);
const LINE = /^(\S+) actor=(\S+) slice=(\S+) stage=(\S+) commits=(\S+) verdicts=(\S+) decisions=(\S+) prev=(genesis|[0-9a-f]{64}) hash=([0-9a-f]{64})$/;

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

export const hashLine = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// A branch name as a file stem: `/` → `__`, anything outside [A-Za-z0-9._-] → `_`.
export function branchFileName(branch) {
  return String(branch).replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_');
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

export const journalFile = (root, branch, cfg) => path.join(dirOf(root, cfg), `${branchFileName(branch)}.log`);

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

// One file's text: {lines, brokenAt, torn}. The first line whose hash or prev link does not hold is the
// break; a last line with no newline (a torn write) is a break at its own number.
function verifyText(text) {
  if (text === '') return { lines: 0, brokenAt: null, torn: false };
  const parts = text.split('\n');
  const torn = parts.at(-1) !== '';
  const complete = parts.slice(0, -1);
  let prev = GENESIS;
  for (let i = 0; i < complete.length; i++) {
    const p = parseLine(complete[i]);
    if (!p || p.prev !== prev || hashLine(p.body) !== p.hash) return { lines: complete.length, brokenAt: i + 1, torn };
    prev = p.hash;
  }
  if (torn) return { lines: complete.length, brokenAt: complete.length + 1, torn };
  return { lines: complete.length, brokenAt: null, torn: false };
}

// Every `*.log` file directly under .slicekit/journal/, by name. Never writes.
// -> {ok, lines, brokenAt, file, message, files: [{file, lines, brokenAt}]}; `file` and `brokenAt` name the
// first break across files, and `message` reads `journal chain broken at line <n> of <file>`.
export function verifyJournal(root, cfg) {
  const dir = dirOf(root, cfg);
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.log')).map((d) => d.name).sort();
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
  }
  const files = [];
  let first = null;
  for (const name of names) {
    const abs = path.join(dir, name);
    const r = verifyText(fs.readFileSync(abs, 'utf8'));
    const rel = toPosix(path.relative(root, abs));
    files.push({ file: rel, lines: r.lines, brokenAt: r.brokenAt });
    if (r.brokenAt !== null && first === null) first = { file: rel, brokenAt: r.brokenAt };
  }
  return {
    ok: first === null,
    lines: files.reduce((n, f) => n + f.lines, 0),
    brokenAt: first?.brokenAt ?? null,
    file: first?.file ?? null,
    message: first ? brokenMessage(first.file, first.brokenAt) : null,
    files,
  };
}

export const brokenMessage = (file, n) => `journal chain broken at line ${n} of ${file}`;

function readIfAny(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

function lastComplete(text) {
  const parts = text.split('\n');
  parts.pop(); // '' after the final newline, or a torn tail
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].trim() !== '') return parts[i];
  return null;
}

// The last complete line of the branch's file, parsed; null when there is none or it does not parse.
export function readLast(root, branch = journalBranch(root), cfg) {
  const line = lastComplete(readIfAny(journalFile(root, branch, cfg)));
  return line === null ? null : parseLine(line);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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

// Appends one line to the branch's file under a lock, in one write, and returns it (no newline). Refuses
// a file whose last line is torn or does not parse: the chain is never continued from a guess.
export function appendJournal(root, fields, { branch = journalBranch(root), now = new Date(), cfg, budgetMs = LOCK_BUDGET_MS } = {}) {
  const file = journalFile(root, branch, cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withLock(file, () => {
    const text = readIfAny(file);
    if (text !== '' && !text.endsWith('\n')) throw new JournalError(`${toPosix(path.relative(root, file))} ends in a torn line; not appending`);
    const last = lastComplete(text);
    let prev = GENESIS;
    if (last !== null) {
      const p = parseLine(last);
      if (!p) throw new JournalError(`${toPosix(path.relative(root, file))} last line does not parse; not appending`);
      prev = p.hash;
    }
    const body = lineBody(fields, prev, now.toISOString());
    const line = `${body} hash=${hashLine(body)}`;
    const fd = fs.openSync(file, 'a');
    try {
      fs.writeSync(fd, `${line}\n`);
    } finally {
      fs.closeSync(fd);
    }
    return line;
  }, budgetMs);
}
