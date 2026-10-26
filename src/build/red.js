// `build red` (REQ-2.6 step 3, D-10): the developer's tests must fail before any code is written.
// They are committed alone, recorded as the slice's frozen tests at `tests-red`, and the slice moves
// on to `building`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../fs.js';
import { commitPaths, headSha } from '../git.js';
import { findSliceFiles, parseSliceFile } from '../slicefile.js';
import { readSlice } from '../state/index.js';
import { recordState } from './record.js';
import { BuildError, findWorktree } from './worktree.js';

const lastLine = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '').at(-1);

// Runs `command` through the shell in `wt`. `summary` is the last non-empty line of stdout, else of
// stderr (a test runner prints its totals last on stdout); `output` is stdout then stderr.
// NODE_TEST_CONTEXT is dropped: inherited from a `node --test` parent, it turns the team's own
// `node --test` into a child reporter that exits 0 whatever its tests do.
export function runCommand(wt, command) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command, { cwd: wt, shell: true, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  // No exit status: the shell could not start, or a signal ended the run. Neither is a pass.
  const exit = typeof r.status === 'number' ? r.status : 1;
  const summary = lastLine(stdout) ?? lastLine(stderr) ?? (r.error ? String(r.error.message) : '');
  return { exit, summary, output: `${stdout}${stderr}` };
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

function sliceIn(wt, cfg, id) {
  for (const f of findSliceFiles(wt, cfg)) {
    const slice = parseSliceFile(readText(f.path), f.path);
    if (slice.id === id) return slice;
  }
  throw new BuildError(`unknown slice ${id}`, 2);
}

// Every evaluation row `<file> » <name>` names a given test path ending in <file> whose text holds <name>.
function checkEvaluation(wt, slice, tests) {
  for (const { test } of slice.evaluation) {
    const row = test.replace(/^`|`$/g, '').trim();
    const at = row.indexOf(' » ');
    const file = (at === -1 ? row : row.slice(0, at)).trim();
    const name = at === -1 ? null : row.slice(at + ' » '.length).trim();
    const found = tests.some(
      (t) => (t === file || t.endsWith(`/${file}`)) && (name === null || readText(path.join(wt, t)).includes(name)),
    );
    if (!found) throw new BuildError(`evaluation test "${row}" is not in the test files`);
  }
}

export function red(root, cfg, id, { tests, worktree } = {}) {
  const wt = findWorktree(root, id, { worktree }).path;
  const current = readSlice(wt, cfg, id);
  if (current.state !== 'todo') throw new BuildError(`${id} is ${current.state}; red runs from todo`);
  const command = cfg.commands?.test ?? '';
  if (command.trim() === '') throw new BuildError('commands.test is not declared in .slicekit/config.json');
  const files = resolveTests(wt, tests);
  checkEvaluation(wt, sliceIn(wt, cfg, id), files);

  const run = runCommand(wt, command);
  if (run.exit === 0) throw new BuildError(`the evaluation set must fail before the build; ${command} → exit 0: ${run.summary}`);

  // Nothing to commit means a re-run after the commit landed: the tests at HEAD are the red ones.
  const commit =
    commitPaths(wt, files, `test(${id}): evaluation set\n\nran: ${command} → exit ${run.exit}\n\nSlice: ${id}`) ?? headSha(wt);
  recordState(wt, cfg, id, 'tests-red', { commit, testExit: run.exit, tests: files });
  recordState(wt, cfg, id, 'building', {});
  return { commit, tests: files };
}
