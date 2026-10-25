// subagent-stop (REQ-3.5, REQ-2.11, REQ-2.12): clears the subagent marker and blocks the subagent once
// when its final output lacks its role's shape (shapes.js). Fails closed through io.js.
//
// Claude Code's SubagentStop carries agent_id, agent_type, agent_transcript_path, last_assistant_message
// and stop_hook_active. After a block the subagent keeps running and its next stop arrives with
// stop_hook_active: true. SubagentStop also fires for Claude Code's internal agents, which never had a
// SubagentStart: the hook acts only for an agent_id subagent-start recorded, and answers {} otherwise.
//
// Retry state, per session and agent, sits next to the marker (subagent-marker.js retryPath). It is read
// first:
//   "stopped"            -> the stop after the "stopping:" block: allow, delete, do not leave again
//   "1"       + problems -> leave, write "stopped", block "stopping: ..." (whatever stop_hook_active says)
//   "1"       + no problems -> allow, leave, delete
//   no file + stop_hook_active -> allow, leave (another hook blocked this stop; the kit does not block twice)
//   no file   + problems -> write "1", block "output shape: ..." (the subagent goes on; marker kept)
//   no problems or unknown role -> allow, leave, delete
// "Leave" decrements the session marker and drops the agent from the started-agents record, so a later
// stop for the same agent is ignored and never decrements the count of another open subagent.
import fs from 'node:fs';
import path from 'node:path';
import { allow, block } from './io.js';
import { fromGitBash } from './paths.js';
import { roleOf, shapeProblems, ROLES } from './shapes.js';
import { hasAgent, leave, removeAgent, retryPath, usableId } from './subagent-marker.js';

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

// The subagent's final text: last_assistant_message, else its own transcript. transcript_path is the
// main session's transcript and is never read.
function outputOf(input) {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim() !== '') {
    return input.last_assistant_message;
  }
  const p = input.agent_transcript_path;
  if (typeof p !== 'string' || p === '') return '';
  return lastAssistantText(path.resolve(fromGitBash(p.replace(/\\/g, '/'))));
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
  const session = input?.session_id;
  const agent = input?.agent_id;
  // Without both ids this cannot be an agent subagent-start recorded.
  if (!usableId(session) || !usableId(agent)) return allow();
  const retry = retryPath(root, session, agent);
  const state = readRetry(retry);
  if (state === STOPPED) {
    fs.rmSync(retry, { force: true });
    return allow();
  }
  if (!hasAgent(root, session, agent)) return allow();
  const quit = () => {
    leave(root, session);
    removeAgent(root, session, agent);
  };
  const finish = () => {
    fs.rmSync(retry, { force: true });
    quit();
    return allow();
  };

  const role = roleOf(input.agent_type);
  if (!ROLES.has(role)) return finish();
  if (state === null && input.stop_hook_active === true) return finish();
  const problems = shapeProblems(role, outputOf(input), { root });
  if (problems.length === 0) return finish();

  const list = problems.join('; ');
  if (state === null) {
    fs.mkdirSync(path.dirname(retry), { recursive: true });
    fs.writeFileSync(retry, '1\n');
    return block(`output shape: ${list}. Add the missing parts and finish.`);
  }
  quit();
  fs.writeFileSync(retry, `${STOPPED}\n`);
  return block(`stopping: shape still wrong after retry: ${list}. End your report with the line: stopping: ${list}`);
}
