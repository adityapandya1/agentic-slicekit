import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_VERSION = 1;
export const SHAPES = ['backend', 'fullstack', 'data'];
export const CONFIG_PATH = path.join('.slicekit', 'config.json');

const COMMAND_KEYS = ['test', 'lint', 'build', 'e2e'];
const REVIEW_MODES = ['required', 'optional'];
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// A branch name the config accepts as defaultBranch or a protected branch.
export const isBranchName = (name) => BRANCH.test(name);

// Matched case-insensitively: compileDestructive adds the i flag, so `drop table` is caught too.
// No force-push entry: pre-bash's rule 3 refuses force pushes from the parsed command.
const DESTRUCTIVE = [
  '\\brm\\s+-rf\\s+(/|~|\\.\\.)',
  '\\bDROP\\s+(TABLE|DATABASE|SCHEMA)\\b',
  '\\bTRUNCATE\\s+TABLE\\b',
  'git\\s+reset\\s+--hard\\s+origin/',
];

export class ConfigError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

// The kit's own filler list, before any team extends it.
export function seedBanned() {
  const file = fileURLToPath(new URL('../templates/style.json', import.meta.url));
  return JSON.parse(fs.readFileSync(file, 'utf8')).banned;
}

// init always passes cli (from --cli or the D-30 probe); the default serves callers that do not.
export function defaultConfig({ name, shape, docsRoot = 'docs', commands = {}, cli = 'slicekit', defaultBranch = 'main' }) {
  return {
    configVersion: CONFIG_VERSION,
    name,
    shape,
    docsRoot,
    defaultBranch,
    cli,
    protectedBranches: [defaultBranch],
    commands: { test: '', lint: '', build: '', e2e: '', ...commands },
    repos: [],
    gitHost: { kind: 'github' },
    tracker: { kind: 'github-issues' },
    review: { independent: 'required' },
    freezeTests: true,
    style: { banned: seedBanned() },
    destructive: [...DESTRUCTIVE],
    ci: { matrix: false, observabilitySteps: [], botActors: [...DEFAULT_BOT_ACTORS], timeoutMinutes: DEFAULT_TIMEOUT_MINUTES },
  };
}

// D-37: pull requests these actors open skip ci-title and ci-body.
export const DEFAULT_BOT_ACTORS = Object.freeze(['dependabot[bot]', 'renovate[bot]']);
// The timeout of each generated gate, command and observability job, in minutes.
export const DEFAULT_TIMEOUT_MINUTES = 30;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

// One message per docsRoot; a hand-edited config must already be clean (the CLI normalises --docs).
function docsRootError(d) {
  if (d.includes('\\')) return 'docsRoot: use forward slashes';
  if (d.startsWith('/') || /^[A-Za-z]:/.test(d)) return 'docsRoot: must be relative';
  if (d.split('/').includes('..')) return 'docsRoot: no .. segment';
  if (d.endsWith('/')) return 'docsRoot: no trailing slash';
  if (/\s/.test(d)) return 'docsRoot must not contain spaces (git attribute patterns cannot hold them)';
  return null;
}

const STEP_KEYS = ['name', 'run', 'env'];
// A ${{ … }} inside a run: line is expanded by GitHub before the shell sees it, so a pull request title
// could become a command; values reach a command through env: instead (REQ-3.11).
export const GITHUB_EXPRESSION = /\$\{\{/;
// The line breaks YAML honours beyond CR and LF; the workflow cannot carry them in a command.
export const LINE_SEPARATOR = /[\u0085\u2028\u2029]/;

// Errors for text that lands in the generated workflow; expression false where ${{ … }} is the intended use (env).
function workflowTextErrors(at, value, { expression = true } = {}) {
  if (typeof value !== 'string') return [];
  const errors = [];
  if (expression && GITHUB_EXPRESSION.test(value)) errors.push(`${at}: contains a GitHub expression; pass values through env:`);
  if (LINE_SEPARATOR.test(value)) errors.push(`${at}: contains a line separator YAML cannot carry`);
  return errors;
}
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// ci.shards (D-49, optional, absent is none): operating system to the number of parallel jobs the
// test command's job is split into on it. Exported so the workflow generator refuses the same values.
export function shardErrors(shards) {
  if (shards === undefined) return [];
  if (!isObject(shards)) return ['ci.shards: must map operating systems to shard counts'];
  return Object.entries(shards)
    .filter(([, n]) => !(Number.isInteger(n) && n >= 1))
    .map(([os]) => `ci.shards.${os}: must be a positive integer`);
}

// ci.matrix is optional (absent reads as false), ci.botActors and ci.timeoutMinutes too (absent
// reads as the default); each observability step renders as one CI job (REQ-3.11).
function ciErrors(ci) {
  if (!isObject(ci)) return ['ci: must be an object'];
  const errors = [];
  if (ci.matrix !== undefined && typeof ci.matrix !== 'boolean') errors.push('ci.matrix: must be a boolean');
  if (ci.botActors !== undefined && !(isStringArray(ci.botActors) && ci.botActors.every(nonEmpty))) {
    errors.push('ci.botActors: must be an array of non-empty strings');
  }
  const t = ci.timeoutMinutes;
  if (t !== undefined && !(Number.isInteger(t) && t >= 1 && t <= 360)) errors.push('ci.timeoutMinutes: must be an integer from 1 to 360');
  errors.push(...shardErrors(ci.shards));
  if (!Array.isArray(ci.observabilitySteps)) return [...errors, 'ci.observabilitySteps: must be an array'];
  ci.observabilitySteps.forEach((step, i) => {
    const at = `ci.observabilitySteps[${i}]`;
    if (!isObject(step)) return errors.push(`${at}: must be an object`);
    for (const key of ['name', 'run']) if (!nonEmpty(step[key])) errors.push(`${at}.${key}: must be a non-empty string`);
    errors.push(...workflowTextErrors(`${at}.name`, step.name, { expression: false }));
    errors.push(...workflowTextErrors(`${at}.run`, step.run));
    if (step.env !== undefined) {
      const ok = isObject(step.env) && Object.entries(step.env).every(([k, v]) => ENV_NAME.test(k) && typeof v === 'string');
      if (!ok) errors.push(`${at}.env: must map names to strings`);
      else if (Object.values(step.env).some((v) => LINE_SEPARATOR.test(v))) errors.push(`${at}.env: contains a line separator YAML cannot carry`);
    }
    for (const key of Object.keys(step)) {
      if (!STEP_KEYS.includes(key)) errors.push(`${at}.${key}: unknown key; use ${STEP_KEYS.join(', ')}`);
    }
  });
  return errors;
}

export function validateConfig(cfg) {
  if (!isObject(cfg)) return ['config: must be an object'];
  const errors = [];
  if (cfg.configVersion !== CONFIG_VERSION) errors.push(`configVersion: must be ${CONFIG_VERSION}`);
  for (const key of ['name', 'docsRoot', 'defaultBranch', 'cli']) {
    if (typeof cfg[key] !== 'string' || cfg[key] === '') errors.push(`${key}: must be a non-empty string`);
  }
  errors.push(...workflowTextErrors('cli', cfg.cli));
  if (typeof cfg.docsRoot === 'string' && cfg.docsRoot !== '') {
    const error = docsRootError(cfg.docsRoot);
    if (error) errors.push(error);
  }
  if (typeof cfg.defaultBranch === 'string' && cfg.defaultBranch !== '' && !BRANCH.test(cfg.defaultBranch)) {
    errors.push('defaultBranch: must be a branch name');
  }
  if (!SHAPES.includes(cfg.shape)) errors.push(`shape: must be one of ${SHAPES.join(', ')}`);
  if (!isStringArray(cfg.protectedBranches)) {
    errors.push('protectedBranches: must be an array of strings');
  } else {
    cfg.protectedBranches.forEach((b, i) => {
      if (!BRANCH.test(b)) errors.push(`protectedBranches[${i}]: must be a branch name`);
    });
  }
  if (!isObject(cfg.commands)) {
    errors.push('commands: must be an object');
  } else {
    for (const key of COMMAND_KEYS) {
      if (typeof cfg.commands[key] !== 'string') errors.push(`commands.${key}: must be a string`);
      errors.push(...workflowTextErrors(`commands.${key}`, cfg.commands[key]));
    }
    for (const key of Object.keys(cfg.commands)) {
      if (!COMMAND_KEYS.includes(key)) errors.push(`commands.${key}: unknown command; use ${COMMAND_KEYS.join(', ')}`);
    }
  }
  if (!Array.isArray(cfg.repos)) errors.push('repos: must be an array');
  for (const key of ['gitHost', 'tracker']) {
    if (!isObject(cfg[key]) || typeof cfg[key].kind !== 'string') errors.push(`${key}.kind: must be a string`);
  }
  if (!isObject(cfg.review) || !REVIEW_MODES.includes(cfg.review.independent)) {
    errors.push(`review.independent: must be ${REVIEW_MODES.join(' or ')}`);
  }
  if (typeof cfg.freezeTests !== 'boolean') errors.push('freezeTests: must be a boolean');
  if (!isObject(cfg.style) || !isStringArray(cfg.style.banned)) errors.push('style.banned: must be an array of strings');
  if (!isStringArray(cfg.destructive)) {
    errors.push('destructive: must be an array of strings');
  } else {
    cfg.destructive.forEach((src, i) => {
      try {
        new RegExp(src, 'i');
      } catch {
        errors.push(`destructive[${i}]: must be a valid regular expression`);
      }
    });
  }
  errors.push(...ciErrors(cfg.ci));
  errors.push(...testFilesErrors(cfg.testFiles));
  return errors;
}

// D-46: testFiles is optional; when present, regular expressions over the repository-relative POSIX
// path that name the test files (absent reads as the graph's DEFAULT_TEST_FILES).
function testFilesErrors(list) {
  if (list === undefined) return [];
  if (!isStringArray(list)) return ['testFiles: must be an array of strings'];
  const errors = [];
  list.forEach((src, i) => {
    try {
      new RegExp(src);
    } catch (e) {
      errors.push(`testFiles[${i}]: ${e.message}`);
    }
  });
  return errors;
}

export function compileDestructive(cfg) {
  return cfg.destructive.map((src) => new RegExp(src, 'i'));
}

export function loadConfig(root) {
  const file = path.join(root, CONFIG_PATH);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError([`config: cannot read ${CONFIG_PATH}`]);
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch {
    throw new ConfigError([`config: ${CONFIG_PATH} is not valid JSON`]);
  }
  const errors = validateConfig(cfg);
  if (errors.length > 0) throw new ConfigError(errors);
  return cfg;
}

// The machine's own settings (D-43): `.slicekit/local.json`, untracked, in the session root (the
// main checkout). Only `testCommand` is read, by the build steps that run the test command on this
// machine (`build red`, `build commit --require-green`, `build pr`), and by the `commands` rule
// outside CI, which looks up the command this machine runs. The committed commands.test is left as
// it is: CI's workflow and `check --ci` judge and run it.
export const LOCAL_PATH = '.slicekit/local.json';

// The main checkout of the repository `dir` is in (a slice worktree's session root), or `dir` when
// it is no repository or the repository has no main checkout.
export function mainCheckout(dir) {
  let common;
  try {
    common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return dir;
  }
  return path.basename(common) === '.git' ? path.dirname(common) : dir;
}

// -> the local test command, or null when the file is absent or sets none; a file that does not
// parse, or a testCommand that is not a non-empty string, is a ConfigError.
export function localTestCommand(root, env = process.env) {
  // Under CI the file is never read: CI runs the committed command.
  if (typeof env.CI === 'string' && env.CI !== '') return null;
  const file = path.join(root, ...LOCAL_PATH.split('/'));
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new ConfigError([`config: cannot read ${LOCAL_PATH}: ${e.code ?? e.message}`]);
  }
  let local;
  try {
    local = JSON.parse(text);
  } catch {
    throw new ConfigError([`config: ${LOCAL_PATH} is not valid JSON`]);
  }
  if (local === null || typeof local !== 'object' || Array.isArray(local)) throw new ConfigError([`config: ${LOCAL_PATH} must be a JSON object`]);
  if (local.testCommand === undefined) return null;
  if (typeof local.testCommand !== 'string' || local.testCommand.trim() === '') {
    throw new ConfigError([`config: ${LOCAL_PATH} testCommand must be a non-empty string`]);
  }
  return local.testCommand;
}

// The test command the build steps run here: the local one when set, else commands.test.
// -> { command, local } where `local` is true for the local file's command.
export function buildTestCommand(root, cfg, env = process.env) {
  const local = localTestCommand(mainCheckout(root), env);
  if (local !== null) return { command: local, local: true };
  return { command: cfg.commands?.test ?? '', local: false };
}

export const localNote = (command) => `ran the test command from ${LOCAL_PATH}: ${command}`;
