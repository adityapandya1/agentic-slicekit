import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_VERSION = 1;
export const SHAPES = ['backend', 'fullstack', 'data'];
export const CONFIG_PATH = path.join('.slicekit', 'config.json');

const COMMAND_KEYS = ['test', 'lint', 'build', 'e2e'];

const DESTRUCTIVE = [
  '\\brm\\s+-rf\\s+(/|~|\\.\\.)',
  '\\bDROP\\s+(TABLE|DATABASE|SCHEMA)\\b',
  '\\bTRUNCATE\\b',
  'git\\s+push\\s+.*--force',
  'git\\s+reset\\s+--hard\\s+origin/',
];

export class ConfigError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

function seedBanned() {
  const file = fileURLToPath(new URL('../templates/style.json', import.meta.url));
  return JSON.parse(fs.readFileSync(file, 'utf8')).banned;
}

export function defaultConfig({ name, shape, docsRoot = 'docs', commands = {} }) {
  return {
    configVersion: CONFIG_VERSION,
    name,
    shape,
    docsRoot,
    defaultBranch: 'main',
    protectedBranches: ['main'],
    commands: { test: '', lint: '', build: '', e2e: '', ...commands },
    repos: [],
    gitHost: { kind: 'github' },
    tracker: { kind: 'github-issues' },
    review: { independent: 'required' },
    freezeTests: true,
    style: { banned: seedBanned() },
    destructive: [...DESTRUCTIVE],
    ci: { observabilitySteps: [] },
  };
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

export function validateConfig(cfg) {
  if (!isObject(cfg)) return ['config: must be an object'];
  const errors = [];
  if (cfg.configVersion !== CONFIG_VERSION) errors.push(`configVersion: must be ${CONFIG_VERSION}`);
  for (const key of ['name', 'docsRoot', 'defaultBranch']) {
    if (typeof cfg[key] !== 'string' || cfg[key] === '') errors.push(`${key}: must be a non-empty string`);
  }
  if (!SHAPES.includes(cfg.shape)) errors.push(`shape: must be one of ${SHAPES.join(', ')}`);
  if (!isStringArray(cfg.protectedBranches)) errors.push('protectedBranches: must be an array of strings');
  if (!isObject(cfg.commands)) {
    errors.push('commands: must be an object');
  } else {
    for (const key of COMMAND_KEYS) {
      if (typeof cfg.commands[key] !== 'string') errors.push(`commands.${key}: must be a string`);
    }
  }
  if (!Array.isArray(cfg.repos)) errors.push('repos: must be an array');
  for (const key of ['gitHost', 'tracker']) {
    if (!isObject(cfg[key]) || typeof cfg[key].kind !== 'string') errors.push(`${key}.kind: must be a string`);
  }
  if (!isObject(cfg.review) || typeof cfg.review.independent !== 'string') errors.push('review.independent: must be a string');
  if (typeof cfg.freezeTests !== 'boolean') errors.push('freezeTests: must be a boolean');
  if (!isObject(cfg.style) || !isStringArray(cfg.style.banned)) errors.push('style.banned: must be an array of strings');
  if (!isStringArray(cfg.destructive)) {
    errors.push('destructive: must be an array of strings');
  } else {
    cfg.destructive.forEach((src, i) => {
      try {
        new RegExp(src);
      } catch {
        errors.push(`destructive[${i}]: must be a valid regular expression`);
      }
    });
  }
  if (!isObject(cfg.ci) || !isStringArray(cfg.ci.observabilitySteps)) errors.push('ci.observabilitySteps: must be an array of strings');
  return errors;
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
