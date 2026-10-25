// The subagent marker (REQ-2.1, REQ-3.4): the session's started-agents record, one sanitised agent_id
// per line. SubagentStart adds the agent (once: it fires on spawn and again on resume), SubagentStop
// drops it. pre-bash does not read it (it keys on the tool call's agent_id, S-07); subagent-stop acts
// only for an agent recorded here.
//
// Inside a git repository the files live in `<git-common-dir>/slicekit/`: every worktree of the
// repository shares the common directory, so an agent recorded from the main checkout is found from a
// linked worktree and the other way round. Outside a repository they live in `<root>/.slicekit/`, with
// a leading dot.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, git } from '../git.js';
import { real } from './paths.js';

const MAX_ID = 200;
const RETRY = { repo: 'retry-', local: '.retry-' };
const AGENTS = { repo: 'agents-', local: '.agents-' };

// -> {dir, kind}: where the files for root live, and whether that is the git common directory.
function markerHome(root) {
  try {
    const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return { dir: path.join(real(path.resolve(common)), 'slicekit'), kind: 'repo' };
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    return { dir: path.join(root, '.slicekit'), kind: 'local' };
  }
}

const usable = (id) => typeof id === 'string' && id !== '' && id.length <= MAX_ID;

// Ids are mapped to [A-Za-z0-9_-] so a file can never land outside the marker directory.
const safe = (id) => id.replace(/[^A-Za-z0-9_-]/g, '_');
function check(id, what) {
  if (!usable(id)) throw new Error(`subagent marker: ${what} must be a non-empty string of at most 200 characters`);
}

// subagent-stop's retry state for one agent of a session, next to the started-agents record:
// `retry-<session>-<agent>` in the git common directory, `.retry-<session>-<agent>` under .slicekit
// outside a repository.
export function retryPath(root, sessionId, agentId) {
  check(sessionId, 'session id');
  check(agentId, 'agent id');
  const { dir, kind } = markerHome(root);
  return path.join(dir, `${RETRY[kind]}${safe(sessionId)}-${safe(agentId)}`);
}

export const usableId = usable;

// The agents subagent-start recorded for a session: `agents-<session>` in the git common directory,
// `.agents-<session>` under .slicekit outside a repository. subagent-stop acts only for an agent
// recorded here: Claude Code also sends SubagentStop for its own internal agents, which never had a
// SubagentStart.
export function agentsPath(root, sessionId) {
  check(sessionId, 'session id');
  const { dir, kind } = markerHome(root);
  return path.join(dir, `${AGENTS[kind]}${safe(sessionId)}`);
}

function readAgents(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Once per agent id: SubagentStart fires again when an agent resumes, and that adds nothing.
export function addAgent(root, sessionId, agentId) {
  check(agentId, 'agent id');
  const file = agentsPath(root, sessionId);
  const ids = readAgents(file);
  if (ids.includes(safe(agentId))) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${[...ids, safe(agentId)].join('\n')}\n`);
}

export function hasAgent(root, sessionId, agentId) {
  return usable(agentId) && readAgents(agentsPath(root, sessionId)).includes(safe(agentId));
}

export function removeAgent(root, sessionId, agentId) {
  const file = agentsPath(root, sessionId);
  const ids = readAgents(file).filter((id) => id !== safe(agentId));
  if (ids.length === 0) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, `${ids.join('\n')}\n`);
}
