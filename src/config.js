import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_VERSION = 1;
export const SHAPES = ['backend', 'fullstack', 'data'];
export const CONFIG_PATH = path.join('.slicekit', 'config.json');

const COMMAND_KEYS = ['test', 'lint', 'build', 'e2e'];
const REVIEW_MODES = ['required', 'optional'];
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

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
export function defaultConfig({ name, shape, docsRoot = 'docs', commands = {}, cli = 'slicekit' }) {
  return {
    configVersion: CONFIG_VERSION,
    name,
    shape,
    docsRoot,
    defaultBranch: 'main',
    cli,
    protectedBranches: ['main'],
    commands: { test: '', lint: '', build: '', e2e: '', ...commands },
    repos: [],
    gitHost: { kind: 'github' },
    tracker: { kind: 'github-issues' },
    review: { independent: 'required' },
    freezeTests: true,
    style: { banned: seedBanned() },
    destructive: [...DESTRUCTIVE],
    ci: { matrix: false, observabilitySteps: [] },
  };
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

// One message per docsRoot; a hand-edited config must already be clean (the CLI normalises --docs).
function docsRootError(d) {
  if (d.includes('\\')) return 'docsRoot: use forward slashes';
  if (d.startsWith('/') || /^[A-Za-z]:/.test(d)) return 'docsRoot: must be relative';
  if (d.split('/').includes('..')) return 'docsRoot: no .. segment';
  if (d.endsWith('/')) return 'docsRoot: no trailing slash';
  return null;
}

const STEP_KEYS = ['name', 'run', 'env'];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// ci.matrix is optional (absent reads as false); each observability step renders as one CI job (REQ-3.11).
function ciErrors(ci) {
  if (!isObject(ci)) return ['ci: must be an object'];
  const errors = [];
  if (ci.matrix !== undefined && typeof ci.matrix !== 'boolean') errors.push('ci.matrix: must be a boolean');
  if (!Array.isArray(ci.observabilitySteps)) return [...errors, 'ci.observabilitySteps: must be an array'];
  ci.observabilitySteps.forEach((step, i) => {
    const at = `ci.observabilitySteps[${i}]`;
    if (!isObject(step)) return errors.push(`${at}: must be an object`);
    for (const key of ['name', 'run']) if (!nonEmpty(step[key])) errors.push(`${at}.${key}: must be a non-empty string`);
    if (step.env !== undefined) {
      const ok = isObject(step.env) && Object.entries(step.env).every(([k, v]) => ENV_NAME.test(k) && typeof v === 'string');
      if (!ok) errors.push(`${at}.env: must map names to strings`);
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
