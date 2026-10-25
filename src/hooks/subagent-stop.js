// subagent-stop (REQ-3.5, REQ-2.11, REQ-2.12): clears the subagent marker and blocks the subagent once
// when its final output lacks its role's shape (shapes.js). Fails closed through io.js.
//
// Retry state, per session and agent, sits next to the marker (subagent-marker.js retryPath):
//   no file   + problems -> write "1", block "output shape: ..." (the subagent goes on; marker kept)
//   "1"       + problems -> leave the marker, write "stopped", block "stopping: ..."
//   "stopped"            -> the stop after the "stopping:" block: allow, delete, do not leave again
//   no problems, unknown role or stop_hook_active -> allow, leave the marker, delete the file
// The "stopped" record is what keeps a third stop from leaving twice, which would drop the count of
// another subagent open in the same session.
import fs from 'node:fs';
import path from 'node:path';
import { allow, block } from './io.js';
import { fromGitBash } from './paths.js';
import { roleOf, shapeProblems, ROLES } from './shapes.js';
import { leave, retryPath, usableId } from './subagent-marker.js';

export const TRANSCRIPT_TAIL = 256 * 1024;
const STOPPED = 'stopped';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
}

// The last assistant text in the transcript's last TRANSCRIPT_TAIL bytes; '' when there is none.
export function lastAssistantText(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - TRANSCRIPT_TAIL);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // a partial first line
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry?.message?.role !== 'assistant') continue;
      const text = textOf(entry.message.content);
      if (text.trim() !== '') return text;
    }
    return '';
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function outputOf(input) {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim() !== '') {
    return input.last_assistant_message;
  }
  for (const key of ['agent_transcript_path', 'transcript_path']) {
    const p = input[key];
    if (typeof p !== 'string' || p === '') continue;
    const text = lastAssistantText(path.resolve(fromGitBash(p.replace(/\\/g, '/'))));
    if (text !== '') return text;
  }
  return '';
}

function readRetry(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function handle(input, { root }) {
  const session = usableId(input?.session_id) ? input.session_id : null;
  const agent = [input?.agent_id, input?.agent_type].find(usableId) ?? 'agent';
  const retry = session ? retryPath(root, session, agent) : null;
  const state = retry ? readRetry(retry) : null;
  const finish = ({ leaving = true } = {}) => {
    if (retry) fs.rmSync(retry, { force: true });
    if (leaving && session) leave(root, session);
    return allow();
  };

  if (state === STOPPED) return finish({ leaving: false });
  const role = roleOf(input?.agent_type);
  if (input?.stop_hook_active === true || !ROLES.has(role)) return finish();
  const problems = shapeProblems(role, outputOf(input), { root });
  if (problems.length === 0) return finish();

  const list = problems.join('; ');
  if (state === null) {
    if (retry) {
      fs.mkdirSync(path.dirname(retry), { recursive: true });
      fs.writeFileSync(retry, '1\n');
    }
    return block(`output shape: ${list}. Add the missing parts and finish.`);
  }
  leave(root, session);
  fs.writeFileSync(retry, `${STOPPED}\n`);
  return block(`stopping: shape still wrong after retry: ${list}`);
}
