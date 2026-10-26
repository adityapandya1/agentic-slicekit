// `build red` (REQ-2.6 step 3, D-10): the developer's tests must fail before any code is written.
// They are committed alone, recorded as the slice's frozen tests at `tests-red`, and the slice moves
// on to `building`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../fs.js';
import { commitPaths, git, headSha } from '../git.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, parseSliceFile } from '../slicefile.js';
import { readSlice } from '../state/index.js';
import { commitBookkeeping, recordState } from './record.js';
import { BuildError, findWorktree } from './worktree.js';

const nonEmpty = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
const TOTALS = /\b(pass|fail|tests?)\b/i;

// Runs `command` through the shell in `wt`. `summary` is the last output line naming pass, fail or
// tests (a runner's totals), else the last line of stdout, else of stderr; `output` is stdout then
// stderr. `error` is null for a run that finished, else why it did not (it could not be spawned, a
// signal ended it, or its output overflowed `maxBuffer`); its `exit` is then 1.
// NODE_TEST_CONTEXT is dropped: inherited from a `node --test` parent, it turns the team's own
// `node --test` into a child reporter that exits 0 whatever its tests do.
export function runCommand(wt, command, { maxBuffer = 256 * 1024 * 1024 } = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command, { cwd: wt, shell: true, env, encoding: 'utf8', maxBuffer });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const finished = typeof r.status === 'number' && !r.error;
  const error = finished ? null : r.error ? String(r.error.code ?? r.error.message) : `signal ${r.signal}`;
  const lines = [...nonEmpty(stdout), ...nonEmpty(stderr)];
  const summary = lines.filter((l) => TOTALS.test(l)).at(-1) ?? nonEmpty(stdout).at(-1) ?? nonEmpty(stderr).at(-1) ?? error ?? '';
  return { exit: finished ? r.status : 1, summary, output: `${stdout}${stderr}`, error };
}

// A shell that found no such command, or npm that found no such script: the tests never ran.
const NOT_RUN_EXITS = [126, 127, 9009];
export function couldNotRun(run) {
  if (NOT_RUN_EXITS.includes(run.exit)) return true;
  if (process.platform === 'win32' && /is not recognized as an internal or external command/.test(run.output)) return true;
  return /npm (ERR!|error) Missing script/.test(run.output);
}

const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

// Each given path, absolute or relative to the worktree and with either slash, as a POSIX path
// relative to the worktree; outside it is a usage error, and so is a path that is not a file.
function resolveTests(wt, tests) {
  const list = (Array.isArray(tests) ? tests : String(tests ?? '').split(','))
    .map((t) => t.trim())
    .filter((t) => t !== '');
  if (list.length === 0) throw new BuildError('--tests names no test file', 2);
  const root = real(wt);
  const out = [];
  for (const given of list) {
    const abs = path.resolve(wt, given.replace(/\\/g, '/'));
    // Existence first, so both sides of the comparison are real paths (8.3 names, links resolved).
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new BuildError(`${given} is not a file`, 2);
    const rel = path.relative(root, real(abs));
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new BuildError(`${given} is outside the worktree`, 2);
    const posix = rel.split(path.sep).join('/');
    if (!out.includes(posix)) out.push(posix);
  }
  return out;
}

export function sliceIn(wt, cfg, id) {
  for (const f of findSliceFiles(wt, cfg)) {
    const slice = parseSliceFile(readText(f.path), f.path);
    if (slice.id === id) return slice;
  }
  throw new BuildError(`unknown slice ${id}`, 2);
}

export const posixRel = (wt, abs) => path.relative(wt, abs).split(path.sep).join('/');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A path (POSIX, relative to the worktree) the kit owns: anything under `.slicekit/`, BUILD.md, the
// config and the slice file. The build commands change these; a test or the developer's work never does.
export function isKitFile(wt, cfg, slice, rel) {
  const paths = kitPaths(wt, cfg);
  const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const own = [posixRel(wt, paths.build), posixRel(wt, paths.config), posixRel(wt, slice.path)];
  return key(rel).startsWith(`${key(posixRel(wt, paths.kit))}/`) || own.some((o) => key(o) === key(rel));
}

// The kit's own files are never tests: freezing one would lock the kit out of its own bookkeeping.
function refuseKitFiles(wt, cfg, slice, tests) {
  for (const t of tests) if (isKitFile(wt, cfg, slice, t)) throw new BuildError(`${t} is a kit file, not a test`);
}

// A run that did not finish or never started is evidence of nothing, red or green.
export function unusableRun(command, run) {
  if (run.error) return new BuildError(`${command} did not finish (${run.error}); a run that does not finish is not a failing test`);
  if (couldNotRun(run)) return new BuildError(`${command} could not run (exit ${run.exit}): ${run.summary}`);
  return null;
}

// The rows as { row, file, name }: `<file> » <name>`, or a bare `<file>` with no name.
function rows(slice) {
  return slice.evaluation.map(({ test }) => {
    const row = test.replace(/^`|`$/g, '').trim();
    const at = row.indexOf(' » ');
    return {
      row,
      file: (at === -1 ? row : row.slice(0, at)).trim(),
      name: at === -1 ? null : row.slice(at + ' » '.length).trim(),
    };
  });
}

const endsWithFile = (t, file) => t === file || t.endsWith(`/${file}`);
// The name inside one string literal on one line: between matching quotes or backticks.
const holdsName = (text, name) =>
  ["'", '"', '`'].some((q) => new RegExp(`${q}[^${q}\\n]*${escape(name)}[^${q}\\n]*${q}`).test(text));

// Every row names a listed file ending in <file> that holds <name> as a string; every listed file
// holds at least one row.
function checkEvaluation(wt, slice, tests) {
  const all = rows(slice);
  for (const { row, file, name } of all) {
    const found = tests.some((t) => endsWithFile(t, file) && (name === null || holdsName(readText(path.join(wt, t)), name)));
    if (!found) throw new BuildError(`evaluation test "${row}" is not in the test files`);
  }
  for (const t of tests) {
    if (!all.some(({ file }) => endsWithFile(t, file))) throw new BuildError(`${t} holds no evaluation test`);
  }
}

// HEAD is this slice's red commit when it touches exactly the listed tests under the evaluation-set
// subject: the commit of an earlier run whose recording did not land.
function headIsRedCommit(wt, id, tests) {
  const touched = git(wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').filter(Boolean).sort();
  const want = [...tests].sort();
  const subject = git(wt, ['log', '-1', '--format=%s', 'HEAD']);
  return touched.length === want.length && touched.every((t, i) => t === want[i]) && subject.startsWith(`test(${id}): evaluation set`);
}

// The listed tests with no change against HEAD (tracked and unmodified).
function unchanged(wt, tests) {
  return tests.filter((t) => {
    const tracked = git(wt, ['--literal-pathspecs', 'ls-files', '--', t]) !== '';
    return tracked && git(wt, ['--literal-pathspecs', 'status', '--porcelain', '--', t]) === '';
  });
}

const noChange = (files) => new BuildError(`${files.join(', ')} have no change to commit; red needs the evaluation set as new or changed files`);

// A run from tests-red: setState wrote tests-red but its bookkeeping commit, or the move to building,
// did not land. The tests must be the frozen ones; nothing is run again.
function finishRed(wt, cfg, id, current, tests) {
  const files = resolveTests(wt, tests).sort();
  const frozen = [...current.frozenTests].sort();
  if (files.length !== frozen.length || files.some((f, i) => f !== frozen[i])) {
    throw new BuildError(`${id} is tests-red with frozen tests ${current.frozenTests.join(', ')}; pass the same --tests`);
  }
  const paths = kitPaths(wt, cfg);
  const bookkeeping = [posixRel(wt, path.join(paths.state, stateFileName(id)))];
  if (fs.existsSync(paths.build)) bookkeeping.push(posixRel(wt, paths.build));
  commitBookkeeping(wt, id, 'tests-red', bookkeeping);
  recordState(wt, cfg, id, 'building', {});
  return { commit: current.redCommit, tests: current.frozenTests };
}

export function red(root, cfg, id, { tests, worktree } = {}) {
  const wt = findWorktree(root, id, { worktree }).path;
  const current = readSlice(wt, cfg, id);
  if (current.state === 'tests-red') return finishRed(wt, cfg, id, current, tests);
  if (current.state !== 'todo') throw new BuildError(`${id} is ${current.state}; red runs from todo`);
  const command = cfg.commands?.test ?? '';
  if (command.trim() === '') throw new BuildError('commands.test is not declared in .slicekit/config.json');
  const files = resolveTests(wt, tests);
  const slice = sliceIn(wt, cfg, id);
  refuseKitFiles(wt, cfg, slice, files);
  checkEvaluation(wt, slice, files);
  const same = unchanged(wt, files);
  if (same.length > 0 && !headIsRedCommit(wt, id, files)) throw noChange(same);

  const run = runCommand(wt, command);
  const unusable = unusableRun(command, run);
  if (unusable) throw unusable;
  if (run.exit === 0) throw new BuildError(`the evaluation set must fail before the build; ${command} → exit 0: ${run.summary}`);

  const made = commitPaths(wt, files, `test(${id}): evaluation set\n\nran: ${command} → exit ${run.exit}\n\nSlice: ${id}`);
  if (made === null && !headIsRedCommit(wt, id, files)) throw noChange(files);
  const commit = made ?? headSha(wt);
  recordState(wt, cfg, id, 'tests-red', { commit, testExit: run.exit, tests: files });
  recordState(wt, cfg, id, 'building', {});
  return { commit, tests: files };
}
