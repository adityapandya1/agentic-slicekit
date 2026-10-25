// subagent-start (REQ-3.4): marks that a subagent is running (pre-bash then keeps git out of it) and
// injects its role brief, the writing rules and the no-git rule. Fails open through io.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from './io.js';
import { roleOf } from './shapes.js';
import { enter, usableId } from './subagent-marker.js';

export { roleOf };
export const BRIEF_MAX = 8000;
export const NO_GIT = 'You never run git; report and the command commits.';
const SKILL = path.join('.claude', 'skills', 'slicekit-writing', 'SKILL.md');
const KIT_SKILL = fileURLToPath(new URL('../../templates/claude-code/skills/slicekit-writing/SKILL.md', import.meta.url));

const stripFrontMatter = (text) => text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');

// The writing rules as rendered in the project, else the kit's template; '' when neither reads.
function writingRules(root) {
  for (const file of [path.join(root, SKILL), KIT_SKILL]) {
    try {
      return stripFrontMatter(fs.readFileSync(file, 'utf8')).replace(/\r\n/g, '\n').trim();
    } catch {
      // try the next one
    }
  }
  return '';
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

export async function handle(input, { root, env = process.env, commands }) {
  // With no usable session id there is no marker to key; the brief is still injected.
  if (usableId(input?.session_id)) enter(root, input.session_id);
  const role = roleOf(input?.agent_type);
  const brief = await roleBrief(role, root, env, commands ?? await cliCommands());
  const body = [brief, writingRules(root)].filter((s) => s !== '').join('\n\n');
  // The no-git rule always survives the cap.
  const room = BRIEF_MAX - NO_GIT.length - 2;
  return context('SubagentStart', `${body.length > room ? body.slice(0, room) : body}\n\n${NO_GIT}`);
}
