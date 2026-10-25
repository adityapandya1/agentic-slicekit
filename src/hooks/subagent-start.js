// subagent-start (REQ-3.4): marks that a subagent is running (the session marker, and its agent_id in
// the session's started-agents record, which subagent-stop checks) and injects its role brief, the
// writing rules and the no-git rule. Fails open through io.js. pre-bash keeps git out of the subagent by
// the agent_id Claude Code puts on every tool call made inside it, not by the marker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from './io.js';
import { toPosix } from './paths.js';
import { roleOf } from './shapes.js';
import { addAgent, enter, usableId } from './subagent-marker.js';

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
async function roleBrief(role, root, env, commands) {
  const placeholder = `Brief: role ${role}.`;
  const cmd = Object.hasOwn(commands, 'instructions') ? commands.instructions : undefined;
  if (!cmd) return placeholder;
  let out = '';
  try {
    const code = await cmd.run([role], { cwd: root, env, stdout: (s) => { out += s; }, stderr: () => {}, stdin: async () => '' });
    return code === 0 && out.trim() !== '' ? out.trim() : placeholder;
  } catch {
    return placeholder;
  }
}

async function cliCommands() {
  return (await import('../cli/index.js')).COMMANDS;
}

// The brief, the rules and the no-git sentence in at most BRIEF_MAX characters. A cut text ends with a
// line naming where the full text is; the no-git sentence is always last.
function assemble(brief, rules, role) {
  const tail = `\n\n${NO_GIT}`;
  const body = [brief, rules.text].filter((s) => s !== '').join('\n\n');
  if (body.length + tail.length <= BRIEF_MAX) return body + tail;
  const where = brief.length + tail.length + 200 > BRIEF_MAX || !rules.file ? `slicekit instructions ${role}` : rules.file;
  const note = `\n(brief truncated; full text in ${where})`;
  return body.slice(0, BRIEF_MAX - tail.length - note.length) + note + tail;
}

export async function handle(input, { root, env = process.env, commands }) {
  // Only an agent that can be named at its stop is recorded: the stop hook acts for recorded agents.
  if (usableId(input?.session_id) && usableId(input?.agent_id)) {
    enter(root, input.session_id);
    addAgent(root, input.session_id, input.agent_id);
  }
  const role = roleOf(input?.agent_type);
  const brief = await roleBrief(role, root, env, commands ?? await cliCommands());
  return context('SubagentStart', assemble(brief, writingRules(root), role));
}
