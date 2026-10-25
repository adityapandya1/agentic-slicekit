// The subagent marker (REQ-2.1): `.slicekit/.subagent-<sessionId>` holds how many subagents are open in
// that session. SubagentStart enters, SubagentStop leaves; pre-bash reads it to keep git out of agents.
import fs from 'node:fs';
import path from 'node:path';

const MAX_ID = 200;

// The session id is mapped to [A-Za-z0-9_-] so the file can never land outside .slicekit/.
export function markerPath(root, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > MAX_ID) {
    throw new Error('subagent marker: session id must be a non-empty string of at most 200 characters');
  }
  return path.join(root, '.slicekit', `.subagent-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
}

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

// A marker that exists but cannot be read as a count reads as active: the guard fails closed.
export function subagentActive(root, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return false;
  const count = readCount(markerPath(root, sessionId));
  return count === null ? false : !(count === 0);
}
