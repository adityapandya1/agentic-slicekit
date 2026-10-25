// session-start (REQ-3.1): tells the agent how the branch stands against origin's default branch and
// which slice is active; after `compact` it re-injects the slice's handoff and points at the brief.
// Fails open through io.js. Never pulls, merges or blocks: the only network call is one fetch of the
// default branch into origin/<default> (an explicit refspec, so a narrowed remote.origin.fetch cannot
// leave the counts stale), run without a shell, with no credential prompt, no ext:: transport and no
// submodule recursion, killed after FETCH_TIMEOUT_MS (inside the 18 s deadline io.js derives from the
// 20 s hooks.json timeout).
//
// Text from the state file is untrusted: every value goes through oneLine and every handoff line is
// prefixed `handoff: `, so it can never print a line the hook itself prints.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GitError, assertRef, currentBranch, git, hasCommits, isRepo } from '../git.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { context, oneLine } from './io.js';
import { activeSlice } from './paths.js';

export const FETCH_TIMEOUT_MS = 15_000;
const REASON_MAX = 120;
const HANDOFF_MAX = 4000;
const WIN = process.platform === 'win32';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every spelling of root git might print: as given, real path, either slash. Longest first.
function rootSpellings(root) {
  const forms = new Set();
  let realRoot = root;
  try {
    realRoot = fs.realpathSync.native(root);
  } catch {
    // keep root as given
  }
  for (const r of [path.resolve(root), realRoot]) {
    forms.add(r.replace(/\\/g, '/'));
    forms.add(r.replace(/\//g, '\\'));
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

// Absolute paths under root, made relative to it.
function relativise(text, root) {
  if (!root) return text;
  let out = text;
  for (const r of rootSpellings(root)) {
    out = out.replace(new RegExp(`${escapeRe(r)}[\\\\/]`, WIN ? 'gi' : 'g'), '');
  }
  return out;
}

// One line, at most 120 characters, cut from the middle so git's head and tail both survive.
function reasonOf(text, root) {
  const first = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? 'unknown error';
  const line = relativise(first, root);
  if (line.length <= REASON_MAX) return line;
  const head = Math.ceil((REASON_MAX - 1) / 2);
  return `${line.slice(0, head)}…${line.slice(line.length - (REASON_MAX - 1 - head))}`;
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

// def has passed assertRef (and config's branch-name check).
export function fetchArgs(def) {
  return [
    '-c', 'protocol.ext.allow=never', 'fetch', '--quiet', '--no-recurse-submodules', 'origin',
    `+refs/heads/${def}:refs/remotes/origin/${def}`,
  ];
}

// -> null on success, else the one-line reason.
function fetchOrigin(root, def, env, timeoutMs) {
  return new Promise((resolve) => {
    execFile('git', fetchArgs(def), {
      cwd: root,
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      windowsHide: true,
      encoding: 'utf8',
    }, (err, _stdout, stderr) => {
      if (!err) return resolve(null);
      if (err.killed) return resolve(`timed out after ${timeoutMs % 1000 === 0 ? `${timeoutMs / 1000} s` : `${timeoutMs} ms`}`);
      resolve(reasonOf(stderr || err.message, root));
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
    if (e instanceof GitError) return `slicekit: could not fetch origin (${reasonOf(e.stderr, root)})`;
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

const text = (v) => oneLine(typeof v === 'string' ? v : JSON.stringify(v) ?? String(v));

function handoffLines(handoff) {
  if (handoff == null) return [];
  if (typeof handoff === 'string') {
    return handoff.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => `handoff: ${text(l)}`);
  }
  if (typeof handoff === 'object' && !Array.isArray(handoff)) {
    return Object.entries(handoff).map(([k, v]) => `handoff: ${text(k)}: ${text(v)}`);
  }
  return [`handoff: ${text(handoff)}`];
}

// Whole lines up to HANDOFF_MAX characters, then a pointer to the state file.
function capped(lines, root, cfg, id) {
  const full = lines.join('\n').length;
  if (full <= HANDOFF_MAX) return lines;
  const kept = [];
  let used = 0;
  for (const l of lines) {
    const add = (kept.length ? 1 : 0) + l.length;
    if (used + add > HANDOFF_MAX) break;
    kept.push(l);
    used += add;
  }
  const file = path.relative(root, path.join(kitPaths(root, cfg).state, stateFileName(id))).split(path.sep).join('/');
  return [...kept, `(handoff truncated, ${full} chars; see ${file})`];
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
  const active = activeSlice(root, cfg);
  if (!active) {
    out.push('no active slice');
  } else if (active.error) {
    out.push(`active slice: ${active.id} (state unreadable: ${reasonOf(active.error, root)})`);
  } else {
    out.push(`active slice: ${active.id} (${text(active.state.state)})`);
    if (source === 'compact') {
      out.push(...capped(handoffLines(active.state.handoff), root, cfg, active.id),
        `Brief: run slicekit instructions developer ${active.id}`);
    }
  }
  return context('SessionStart', out.join('\n'));
}
