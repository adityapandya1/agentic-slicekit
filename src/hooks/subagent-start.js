// subagent-start (REQ-3.4): records the agent in the session's started-agents record (once per agent:
// SubagentStart fires on spawn and again on resume), which subagent-stop checks, and injects its role
// brief, then the writing rules (once, even when `slicekit instructions` gave a brief holding them) and
// the no-git rule. Fails open through io.js. pre-bash keeps git out of the subagent by the agent_id
// Claude Code puts on every tool call made inside it, not by the record.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from './io.js';
import { toPosix } from './paths.js';
import { roleOf } from './shapes.js';
import { addAgent, usableId } from './subagent-marker.js';

export { roleOf };
export const BRIEF_MAX = 8000;
export const NO_GIT = 'You never run git; report and the command commits.';
const SKILL = path.join('.claude', 'skills', 'slicekit-writing', 'SKILL.md');
const KIT_SKILL = fileURLToPath(new URL('../../templates/claude-code/skills/slicekit-writing/SKILL.md', import.meta.url));

const stripFrontMatter = (text) => text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');

// A file as the brief names it: relative to root when inside it, else absolute; forward slashes.
function shown(root, file) {
  const rel = path.relative(path.resolve(root), file);
  return toPosix(rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? file : rel);
}

// -> {text, file}: the writing rules as rendered in the project, else the kit's template; text '' when
// neither reads.
function writingRules(root) {
  for (const file of [path.join(root, SKILL), KIT_SKILL]) {
    try {
      return { text: stripFrontMatter(fs.readFileSync(file, 'utf8')).replace(/\r\n/g, '\n').trim(), file: shown(root, file) };
    } catch {
      // try the next one
    }
  }
  return { text: '', file: null };
}

// `slicekit instructions <role>` when that command exists (S-09) and succeeds, else the P1 placeholder.
// -> {text, fromKit}: fromKit when the text came from the command, whose brief carries the writing
// rules under `## Writing rules`.
async function roleBrief(role, root, env, commands) {
  const placeholder = { text: `Brief: role ${role}.`, fromKit: false };
  const cmd = Object.hasOwn(commands, 'instructions') ? commands.instructions : undefined;
  if (!cmd) return placeholder;
  let out = '';
  try {
    const code = await cmd.run([role], { cwd: root, env, stdout: (s) => { out += s; }, stderr: () => {}, stdin: async () => '' });
    return code === 0 && out.trim() !== '' ? { text: out.trim(), fromKit: true } : placeholder;
  } catch {
    return placeholder;
  }
}

async function cliCommands() {
  return (await import('../cli/index.js')).COMMANDS;
}

// A brief from `slicekit instructions` without its `## Writing rules` section: the hook appends the
// rules itself, at the end, so they appear once and survive a cut.
function withoutRules(text) {
  const out = [];
  let inFence = false;
  let skipping = false;
  for (const l of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    else if (!inFence && /^## /.test(l)) skipping = /^## Writing rules\s*$/.test(l);
    if (!skipping) out.push(l);
  }
  return out.join('\n').trim();
}

// The brief, the rules and the no-git sentence in at most BRIEF_MAX characters, the rules and the
// sentence always last and whole. A brief that does not fit is cut from its end and followed by a
// line naming where the full text is. Only when the rules alone do not fit are they cut too.
function assemble(brief, rules, role, cli) {
  const tail = `\n\n${NO_GIT}`;
  const end = rules.text === '' ? tail : `\n\n${rules.text}${tail}`;
  if (brief.length + end.length <= BRIEF_MAX) return brief + end;
  const note = `\n(brief truncated; full text in ${cli} instructions ${role})`;
  const room = BRIEF_MAX - end.length - note.length;
  if (room >= 200) return brief.slice(0, room) + note + end;
  const body = [brief, rules.text].filter((s) => s !== '').join('\n\n');
  const where = brief.length + tail.length + 200 > BRIEF_MAX || !rules.file ? `${cli} instructions ${role}` : rules.file;
  const cut = `\n(brief truncated; full text in ${where})`;
  return body.slice(0, BRIEF_MAX - tail.length - cut.length) + cut + tail;
}

export async function handle(input, { root, cfg, env = process.env, commands }) {
  // Only an agent that can be named at its stop is recorded: the stop hook acts for recorded agents.
  if (usableId(input?.session_id) && usableId(input?.agent_id)) addAgent(root, input.session_id, input.agent_id);
  const role = roleOf(input?.agent_type);
  const brief = await roleBrief(role, root, env, commands ?? await cliCommands());
  const text = brief.fromKit ? withoutRules(brief.text) : brief.text;
  return context('SubagentStart', assemble(text, writingRules(root), role, cfg?.cli || 'slicekit'));
}
