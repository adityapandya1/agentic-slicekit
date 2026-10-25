// The subagent marker (REQ-2.1): a file that holds how many subagents are open in a session.
// SubagentStart enters, SubagentStop leaves; pre-bash reads it to keep git out of agents.
//
// Inside a git repository the marker is `<git-common-dir>/slicekit/subagent-<sessionId>`: every worktree
// of the repository shares the common directory, so a marker entered from the main checkout is found
// from a linked worktree and the other way round. Outside a repository it is
// `<root>/.slicekit/.subagent-<sessionId>`.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, git } from '../git.js';
import { real, toPosix } from './paths.js';

const MAX_ID = 200;
const REPO_PREFIX = 'subagent-';
const LOCAL_PREFIX = '.subagent-';
const RETRY = { [REPO_PREFIX]: 'retry-', [LOCAL_PREFIX]: '.retry-' };

// -> {dir, prefix}: where the markers for root live and how their names start.
function markerHome(root) {
  try {
    const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return { dir: path.join(real(path.resolve(common)), 'slicekit'), prefix: REPO_PREFIX };
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    return { dir: path.join(root, '.slicekit'), prefix: LOCAL_PREFIX };
  }
}

const usable = (id) => typeof id === 'string' && id !== '' && id.length <= MAX_ID;

const safe = (id) => id.replace(/[^A-Za-z0-9_-]/g, '_');
function check(id, what) {
  if (!usable(id)) throw new Error(`subagent marker: ${what} must be a non-empty string of at most 200 characters`);
}

// The session id is mapped to [A-Za-z0-9_-] so the file can never land outside the marker directory.
export function markerPath(root, sessionId) {
  check(sessionId, 'session id');
  const { dir, prefix } = markerHome(root);
  return path.join(dir, `${prefix}${safe(sessionId)}`);
}

// subagent-stop's retry state for one agent of a session, next to the marker: `retry-<session>-<agent>`
// in the git common directory, `.retry-<session>-<agent>` under .slicekit outside a repository.
export function retryPath(root, sessionId, agentId) {
  check(sessionId, 'session id');
  check(agentId, 'agent id');
  const { dir, prefix } = markerHome(root);
  return path.join(dir, `${RETRY[prefix]}${safe(sessionId)}-${safe(agentId)}`);
}

export const usableId = usable;

// null when there is no marker; NaN when it exists but is unreadable as a count.
function readCount(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  return /^\s*\d+\s*$/.test(text) ? Number(text) : Number.NaN;
}

export function enter(root, sessionId) {
  const file = markerPath(root, sessionId);
  const count = readCount(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${(Number.isFinite(count) ? count : 0) + 1}\n`);
}

export function leave(root, sessionId) {
  const file = markerPath(root, sessionId);
  const count = readCount(file);
  if (count === null) return;
  const next = (Number.isFinite(count) ? count : 1) - 1;
  if (next <= 0) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, `${next}\n`);
}

// A marker as the deny message names it: relative to root when it lies inside root, else absolute.
function shown(root, file) {
  const abs = real(file);
  const rel = path.relative(real(path.resolve(root)), abs);
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? toPosix(abs) : toPosix(rel);
}

// -> the active marker's path as shown(), or null.
// A marker that exists but cannot be read as a count reads as active: the guard fails closed.
// With no usable session id, any session's marker counts: the hook cannot tell whose call this is.
export function activeMarker(root, sessionId) {
  if (usable(sessionId)) {
    const file = markerPath(root, sessionId);
    const count = readCount(file);
    return count === null || count === 0 ? null : shown(root, file);
  }
  const { dir, prefix } = markerHome(root);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hit = names.filter((n) => n.startsWith(prefix)).sort()[0];
  return hit === undefined ? null : shown(root, path.join(dir, hit));
}

export const subagentActive = (root, sessionId) => activeMarker(root, sessionId) !== null;
