// session-start (REQ-3.1): tells the agent how the branch stands against origin's default branch and
// which slice is active; after `compact` it re-injects the slice's handoff and points at the brief.
// Fails open through io.js. Never pulls, merges or blocks: the only network call is one
// `git fetch --quiet origin <default>` run without a shell, with no credential prompt, killed after
// FETCH_TIMEOUT_MS (inside the 18 s deadline io.js derives from the 20 s hooks.json timeout).
import { execFile } from 'node:child_process';
import { GitError, assertRef, currentBranch, git, hasCommits, isRepo } from '../git.js';
import { sliceFromBranch } from '../ids.js';
import { readSlice } from '../state/index.js';
import { context } from './io.js';

export const FETCH_TIMEOUT_MS = 15_000;
const REASON_MAX = 120;

// One line, at most 120 characters.
function reasonOf(text) {
  const first = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? 'unknown error';
  return first.slice(0, REASON_MAX);
}

function succeeds(root, args) {
  try {
    git(root, args);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

// -> null on success, else the one-line reason.
function fetchOrigin(root, branch, env, timeoutMs) {
  return new Promise((resolve) => {
    execFile('git', ['fetch', '--quiet', 'origin', branch], {
      cwd: root,
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      windowsHide: true,
      encoding: 'utf8',
    }, (err, _stdout, stderr) => {
      if (!err) return resolve(null);
      if (err.killed) return resolve(`timed out after ${timeoutMs % 1000 === 0 ? `${timeoutMs / 1000} s` : `${timeoutMs} ms`}`);
      resolve(reasonOf(stderr || err.message));
    });
  });
}

async function divergence(root, branch, cfg, env, timeoutMs) {
  const name = branch ?? 'HEAD';
  if (!hasCommits(root)) return `slicekit: ${name} has no commits yet`;
  if (!succeeds(root, ['remote', 'get-url', 'origin'])) return 'slicekit: could not fetch origin (no origin remote)';
  let def;
  try {
    def = assertRef(cfg?.defaultBranch);
  } catch (e) {
    if (e instanceof GitError) return `slicekit: could not fetch origin (${reasonOf(e.stderr)})`;
    throw e;
  }
  const failure = await fetchOrigin(root, def, env, timeoutMs);
  const ref = `refs/remotes/origin/${def}`;
  const haveRef = succeeds(root, ['rev-parse', '--verify', '--quiet', ref]);
  if (failure && !haveRef) return `slicekit: could not fetch origin (${failure})`;
  if (!haveRef) return `slicekit: could not fetch origin (origin/${def} not found after the fetch)`;
  const [ahead, behind] = git(root, ['rev-list', '--left-right', '--count', `HEAD...${ref}`]).split(/\s+/);
  const counts = `${name} is ${ahead} ahead / ${behind} behind origin/${def}`;
  return failure
    ? `slicekit: could not fetch origin (${failure}); ${counts} (as of the last fetch)`
    : `slicekit: ${counts}`;
}

// -> {id, state} or null.
function activeSlice(root, cfg, branch) {
  const id = branch ? sliceFromBranch(branch) : null;
  if (!id) return null;
  try {
    return { id, state: readSlice(root, cfg, id) };
  } catch (e) {
    if (/^unknown slice /.test(e?.message ?? '')) return null;
    return { id, state: null, error: e?.message ?? String(e) };
  }
}

function handoffLines(handoff) {
  if (handoff == null) return [];
  if (typeof handoff === 'string') return handoff.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (typeof handoff === 'object' && !Array.isArray(handoff)) {
    return Object.entries(handoff).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return [`handoff: ${JSON.stringify(handoff)}`];
}

export async function handle(input, { root, cfg, env = process.env, fetchTimeoutMs = FETCH_TIMEOUT_MS }) {
  if (!isRepo(root)) return context('SessionStart', 'slicekit: not a git repository\nno active slice');
  const source = ['startup', 'resume', 'clear', 'compact'].includes(input?.source) ? input.source : 'startup';
  let branch;
  try {
    branch = currentBranch(root);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    branch = null;
  }
  const out = [await divergence(root, branch, cfg, env, fetchTimeoutMs)];
  const active = activeSlice(root, cfg, branch);
  if (!active) {
    out.push('no active slice');
  } else if (active.error) {
    out.push(`active slice: ${active.id} (state unreadable: ${reasonOf(active.error)})`);
  } else {
    out.push(`active slice: ${active.id} (${active.state.state})`);
    if (source === 'compact') {
      out.push(...handoffLines(active.state.handoff), `Brief: run slicekit instructions developer ${active.id}`);
    }
  }
  return context('SessionStart', out.join('\n'));
}
