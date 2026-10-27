// The one home of every agent brief and every command procedure (REQ-2.12). A brief is the role's
// template followed by everything the agent needs inlined: the writing rules, the REQ blocks and
// decision rows the slice names, the slice file's summary, the team's commands, and last the slice's
// tasks. A procedure is a command's template with its arguments filled in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDecisions } from './decisions.js';
import { exists, readText } from './fs.js';
import { GitError, currentBranch, isRepo } from './git.js';
import { ROLES } from './hooks/shapes.js';
import { parseSliceAddr, sliceFromBranch } from './ids.js';
import { frontMatter, headings, lines } from './markdown.js';
import { kitPaths } from './paths.js';
import { findSliceFiles } from './slicefile.js';
import { reqBlocks } from './stage.js';

export const PROCEDURES = ['intake', 'specify', 'gaps', 'plan', 'build', 'review', 'release', 'ops', 'audit'];
export const TEMPLATES = fileURLToPath(new URL('../templates/instructions', import.meta.url));

const KIT_SKILL = fileURLToPath(new URL('../templates/claude-code/skills/slicekit-writing/SKILL.md', import.meta.url));
const SKILL = path.join('.claude', 'skills', 'slicekit-writing', 'SKILL.md');
const TEAM_COMMANDS = ['test', 'lint', 'build', 'e2e'];
const SUMMARY_SECTIONS = ['Done when', 'Evaluation set', 'Expected changes'];

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
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [String(v)]);

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

// Every heading outside a fenced block `by` levels lower (at most level 6), so inlined text sits under
// the brief's own `##` sections. Every other line is kept as it is.
export function demote(text, by = 1) {
  let inFence = false;
  return text
    .split('\n')
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) {
        inFence = !inFence;
        return l;
      }
      if (inFence) return l;
      const m = /^(#{1,6})(\s.*)$/.exec(l);
      return m ? '#'.repeat(Math.min(6, m[1].length + by)) + m[2] : l;
    })
    .join('\n');
}

// The slice file whose front matter names `id`, as {data, body}; null when none does.
function sliceFile(root, cfg, id) {
  for (const f of findSliceFiles(root, cfg)) {
    const { data, body } = frontMatter(readText(f.path));
    if (String(data.slice ?? '') === id) return { data, body };
  }
  return null;
}

// The level-2 sections of a slice file's body: lower-case title -> {title, text after the heading}.
function sliceSections(body) {
  const all = lines(body);
  const hs = headings(body).filter((h) => h.level === 2);
  return new Map(
    hs.map((h, i) => {
      const end = i + 1 < hs.length ? hs[i + 1].line - 1 : all.length;
      return [h.text.toLowerCase(), { title: h.text, text: all.slice(h.line, end).join('\n').trim() }];
    }),
  );
}

// The front matter as a list, then Done when, Evaluation set and Expected changes, their headings one
// level lower. The Tasks section goes last in the brief, on its own.
function sliceSummary(slice) {
  const parts = [Object.entries(slice.data).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n')];
  const sections = sliceSections(slice.body);
  for (const title of SUMMARY_SECTIONS) {
    const sec = sections.get(title.toLowerCase());
    if (sec) parts.push(demote(`## ${sec.title}\n\n${sec.text}`.trim()));
  }
  return parts.filter((p) => p !== '').join('\n\n');
}

function requirements(root, cfg, ids) {
  if (ids.length === 0) return 'The slice names no requirement.';
  const blocks = reqBlocks(root, cfg);
  const specDir = `${posix(cfg.docsRoot).replace(/\/$/, '')}/spec/`;
  return ids
    .map((id) => {
      const b = blocks.find((x) => x.id === id);
      if (!b) return `${id}: not found under ${specDir}`;
      const heading = lines(readText(path.join(root, b.file)))[b.line - 1];
      return demote(`${heading}\n${b.block}`.trimEnd());
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

// The project's rendered writing rules, else the kit's, without front matter or the leading level-1
// title (`# Writing rules` in the kit's), the other headings one level lower.
function writingRules(root) {
  for (const file of [path.join(root, SKILL), KIT_SKILL]) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    return demote(stripFrontMatter(text).replace(/\r\n/g, '\n').replace(/^\s*# [^\n]*(?:\n|$)/, '').trim());
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

// Refuses a role that is not one of the six, and the designer outside a fullstack project.
export function checkRole(cfg, role) {
  if (!ROLES.has(role)) throw new InstructionsError(2, `unknown role '${role}'; one of ${[...ROLES].join(', ')}`);
  if (role === 'designer' && cfg.shape !== 'fullstack') throw new InstructionsError(2, `designer is not installed for shape ${cfg.shape}`);
}

// The slice file of `sliceId` (null: none) and the role's template with `{{cli}}` filled in, after
// the role and the slice are checked.
function briefHead(root, cfg, role, sliceId, templatesDir, fromBranch) {
  checkRole(cfg, role);
  const slice = sliceId ? sliceFile(root, cfg, sliceId) : null;
  if (sliceId && !slice && !fromBranch) throw new InstructionsError(2, `unknown slice ${sliceId}`);
  const file = path.join(templatesDir, 'agents', `${role}.md`);
  const head = fill(template(file, `the ${role} brief is not built in this version: ${posix(file)} is missing`), { cli: cfg.cli });
  return { slice, head };
}

// The whole brief of `role` for `sliceId` (null: no active slice). The essentials come first and the
// slice's Tasks section last, so a reader that cuts the text from its end loses the least. With
// `worktree` it names where the agent works, so the brief is the agent's whole prompt (REQ-2.6 step 2).
// `fromBranch`: the id came from the branch, so a missing slice file is no active slice, not an error.
export function renderBrief(root, cfg, role, sliceId, { templatesDir = TEMPLATES, worktree, fromBranch = false } = {}) {
  const { slice, head } = briefHead(root, cfg, role, sliceId, templatesDir, fromBranch);
  const none = sliceId && !slice ? `No active slice. (branch names ${sliceId}, which has no slice file)` : 'No active slice.';
  const parts = [head.trim(), `## Writing rules\n\n${writingRules(root)}`.trim()];
  parts.push(`## Requirements\n\n${slice ? requirements(root, cfg, asList(slice.data.requirements)) : none}`);
  parts.push(`## Decisions\n\n${slice ? decisions(root, cfg, asList(slice.data.decisions)) : none}`);
  parts.push(slice ? `## Slice ${sliceId}\n\n${sliceSummary(slice)}` : `## Slice\n\n${none}`);
  parts.push(`## Team commands\n\n${TEAM_COMMANDS.map((k) => `- ${k}: ${cfg.commands?.[k] || 'not declared'}`).join('\n')}`);
  // The reviewer's verdict goes in the session root, where `build verdict` and the stop hook read it.
  const verdictFile = role === 'reviewer' ? ' The one exception is the verdict file: write it at the absolute path the command gives you, in the session root.' : '';
  if (worktree) parts.push(`## Where\n\nWork only under ${posix(path.resolve(root, worktree))}; use absolute paths.${verdictFile}`);
  const tasks = slice ? sliceSections(slice.body).get('tasks') : undefined;
  if (tasks) parts.push(`## Tasks\n\n${demote(tasks.text)}`.trim());
  return parts.join('\n\n');
}

// The cap on a summary with the kit's writing rules, and on each of its two id lines: the hook that
// injects a summary has 8000 characters for it, its own copy of the rules and the no-git sentence.
export const SUMMARY_MAX = 6000;
const ID_LINE_MAX = 600;

// `<label>: a, b, c`, or as many ids as fit in ID_LINE_MAX followed by `, and <n> more`.
function idLine(label, ids) {
  const full = `${label}: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
  if (full.length <= ID_LINE_MAX) return full;
  const kept = [];
  for (const id of ids) {
    const next = `${label}: ${[...kept, id].join(', ')}, and ${ids.length - kept.length - 1} more`;
    if (next.length > ID_LINE_MAX) break;
    kept.push(id);
  }
  return `${label}: ${kept.join(', ')}, and ${ids.length - kept.length} more`;
}

// The short form of a brief, for the SubagentStart hook: the role template, the writing rules, the
// slice's REQ and D ids, and last the command that prints the full brief. The build procedure gives
// the developer the full brief in its prompt; every other agent reads it with that command.
export function renderSummary(root, cfg, role, sliceId, { templatesDir = TEMPLATES, fromBranch = false } = {}) {
  const { slice, head } = briefHead(root, cfg, role, sliceId, templatesDir, fromBranch);
  const ids = slice
    ? [idLine('Requirements', asList(slice.data.requirements)), idLine('Decisions', asList(slice.data.decisions))]
    : [sliceId ? `No active slice. (branch names ${sliceId}, which has no slice file)` : 'No active slice.'];
  const full = `Full brief: ${cfg.cli} instructions ${role}${slice ? ` ${sliceId}` : ''}`;
  const heading = `## Slice${slice ? ` ${sliceId}` : ''}`;
  return [head.trim(), `## Writing rules\n\n${writingRules(root)}`.trim(), `${heading}\n\n${[...ids, full].join('\n')}`].join('\n\n');
}

// The procedure of `/slicekit <name>` with `{{cli}}` and `{{args}}` filled in.
export function renderProcedure(root, cfg, name, args, { templatesDir = TEMPLATES } = {}) {
  if (!PROCEDURES.includes(name)) throw new InstructionsError(2, `unknown command '${name}'`);
  const text = template(path.join(templatesDir, 'commands', `${name}.md`), `the /slicekit ${name} command is not built in this version`);
  return fill(text, { cli: cfg.cli, args: args.length > 0 ? args.join(' ') : '(none)' });
}
