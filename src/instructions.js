// The one home of every agent brief and every command procedure (REQ-2.12). A brief is the role's
// template followed by everything the agent needs inlined: the slice file, the REQ blocks and decision
// rows it names, the team's commands and the writing rules. A procedure is a command's template with
// its arguments filled in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDecisions } from './decisions.js';
import { exists, readText } from './fs.js';
import { GitError, currentBranch, isRepo } from './git.js';
import { ROLES } from './hooks/shapes.js';
import { parseSliceAddr, sliceFromBranch } from './ids.js';
import { frontMatter, lines } from './markdown.js';
import { kitPaths } from './paths.js';
import { findSliceFiles } from './slicefile.js';
import { reqBlocks } from './stage.js';

export const PROCEDURES = ['intake', 'specify', 'gaps', 'plan', 'build', 'review', 'release', 'ops', 'audit'];
export const TEMPLATES = fileURLToPath(new URL('../templates/instructions', import.meta.url));

const KIT_SKILL = fileURLToPath(new URL('../templates/claude-code/skills/slicekit-writing/SKILL.md', import.meta.url));
const SKILL = path.join('.claude', 'skills', 'slicekit-writing', 'SKILL.md');
const TEAM_COMMANDS = ['test', 'lint', 'build', 'e2e'];

// code 1: refused (a template the kit does not ship yet); code 2: usage or an unknown name.
export class InstructionsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstructionsError';
    this.code = code;
  }
}

const posix = (p) => p.split(path.sep).join('/');
const fill = (text, values) => text.replace(/\{\{(cli|args)\}\}/g, (m, k) => (k in values ? values[k] : m));

// The slice a brief is for: `arg` when it is a slice address, else the one the current branch names;
// null outside a repository or off a slice branch.
export function briefSlice(root, arg) {
  if (arg !== undefined && arg !== null) {
    if (!parseSliceAddr(arg)) throw new InstructionsError(2, `not a slice address: ${arg}`);
    return arg;
  }
  if (!isRepo(root)) return null;
  try {
    const branch = currentBranch(root);
    return branch ? sliceFromBranch(branch) : null;
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// The slice file whose front matter names `id`, as {text, data}; null when none does.
function sliceFile(root, cfg, id) {
  for (const f of findSliceFiles(root, cfg)) {
    const text = readText(f.path);
    const { data } = frontMatter(text);
    if (String(data.slice ?? '') === id) return { text, data };
  }
  return null;
}

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [String(v)]);

function requirements(root, cfg, ids) {
  if (ids.length === 0) return 'The slice names no requirement.';
  const blocks = reqBlocks(root, cfg);
  const specDir = `${posix(cfg.docsRoot).replace(/\/$/, '')}/spec/`;
  return ids
    .map((id) => {
      const b = blocks.find((x) => x.id === id);
      if (!b) return `${id}: not found under ${specDir}`;
      const heading = lines(readText(path.join(root, b.file)))[b.line - 1];
      return `${heading}\n${b.block}`.trimEnd();
    })
    .join('\n\n');
}

function decisions(root, cfg, ids) {
  if (ids.length === 0) return 'The slice names no decision.';
  const file = kitPaths(root, cfg).decisions;
  const rows = exists(file) ? readDecisions(readText(file)).rows : [];
  return ids
    .map((id) => {
      const m = /^D-(\d+)$/.exec(id);
      const row = m ? rows.find((r) => r.n === Number(m[1])) : undefined;
      if (!row) return `- ${id}: not found in decisions.md`;
      const answer = row.table === 'settled' ? row.answer : `open; recommendation: ${row.recommendation || 'none'}`;
      return `- ${row.id} (${row.type}): ${row.question} → ${answer}`;
    })
    .join('\n');
}

const stripFrontMatter = (text) => text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');

// The project's rendered writing rules, else the kit's, without front matter or a `# Writing rules` heading.
function writingRules(root) {
  for (const file of [path.join(root, SKILL), KIT_SKILL]) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    return stripFrontMatter(text).replace(/\r\n/g, '\n').replace(/^\s*# Writing rules[ \t]*\n/, '').trim();
  }
  return '';
}

function template(file, what) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  } catch (e) {
    if (e.code === 'ENOENT') throw new InstructionsError(1, what);
    throw e;
  }
}

// The whole brief of `role` for `sliceId` (null: no active slice). With `worktree` it opens by naming
// where the agent works, so the brief is the agent's whole prompt (REQ-2.6 step 2).
export function renderBrief(root, cfg, role, sliceId, { templatesDir = TEMPLATES, worktree } = {}) {
  if (!ROLES.has(role)) throw new InstructionsError(2, `unknown role '${role}'; one of ${[...ROLES].join(', ')}`);
  if (role === 'designer' && cfg.shape !== 'fullstack') throw new InstructionsError(2, `designer is not installed for shape ${cfg.shape}`);
  const slice = sliceId ? sliceFile(root, cfg, sliceId) : null;
  if (sliceId && !slice) throw new InstructionsError(2, `unknown slice ${sliceId}`);
  const file = path.join(templatesDir, 'agents', `${role}.md`);
  const head = fill(template(file, `the ${role} brief is not built in this version: ${posix(file)} is missing`), { cli: cfg.cli });
  const parts = [head.trim()];
  if (worktree) parts.push(`## Where\n\nWork only under ${path.resolve(root, worktree)}; use absolute paths.`);
  if (slice) {
    parts.push(`## Slice ${sliceId}\n\n${slice.text.replace(/\r\n/g, '\n').replace(/^﻿/, '').trim()}`);
  } else {
    parts.push('## Slice\n\nNo active slice.');
  }
  const reqs = slice ? asList(slice.data.requirements) : [];
  const ds = slice ? asList(slice.data.decisions) : [];
  parts.push(`## Requirements\n\n${slice ? requirements(root, cfg, reqs) : 'No active slice.'}`);
  parts.push(`## Decisions\n\n${slice ? decisions(root, cfg, ds) : 'No active slice.'}`);
  parts.push(`## Team commands\n\n${TEAM_COMMANDS.map((k) => `- ${k}: ${cfg.commands?.[k] || 'not declared'}`).join('\n')}`);
  parts.push(`## Writing rules\n\n${writingRules(root)}`.trim());
  return parts.join('\n\n');
}

// The procedure of `/slicekit <name>` with `{{cli}}` and `{{args}}` filled in.
export function renderProcedure(root, cfg, name, args, { templatesDir = TEMPLATES } = {}) {
  if (!PROCEDURES.includes(name)) throw new InstructionsError(2, `unknown command '${name}'`);
  const text = template(path.join(templatesDir, 'commands', `${name}.md`), `the /slicekit ${name} command is not built in this version`);
  return fill(text, { cli: cfg.cli, args: args.length > 0 ? args.join(' ') : '(none)' });
}
