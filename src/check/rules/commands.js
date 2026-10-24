// commands (03 REQ-3.7): every command the team declared in config must be findable. The first
// token is looked up and nothing is ever run. An empty string means "not declared", not missing.
import fs from 'node:fs';
import path from 'node:path';
import { which, runnable } from '../../which.js';

export const id = 'commands';
export const blocking = true;
export const ratchet = false;

const NAMES = ['test', 'lint', 'build', 'e2e'];
const CONFIG = '.slicekit/config.json';

// The first whitespace-delimited token; a leading double quote runs to its closing quote.
function firstToken(command) {
  const s = command.trim();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    return end === -1 ? s.slice(1) : s.slice(1, end);
  }
  return s.split(/\s+/)[0];
}

function resolves(token, ctx) {
  if (token.includes('/') || token.includes('\\')) {
    const file = path.resolve(ctx.root, token);
    const exts = process.platform === 'win32' ? ['', '.cmd', '.bat', '.exe', '.com'] : [''];
    return exts.some((e) => runnable(file + e) || fs.existsSync(file + e));
  }
  return which(token, ctx.env ?? process.env, [path.join(ctx.root, 'node_modules', '.bin')]) !== null;
}

// The line of `"<name>":` inside the "commands" object, else 1.
function keyLine(root, name) {
  try {
    const text = fs.readFileSync(path.join(root, CONFIG), 'utf8').split('\n');
    const start = text.findIndex((l) => /"commands"\s*:/.test(l));
    if (start === -1) return 1;
    const at = text.findIndex((l, i) => i >= start && new RegExp(`"${name}"\s*:`).test(l));
    return at === -1 ? 1 : at + 1;
  } catch {
    return 1;
  }
}

export function run(ctx) {
  const out = [];
  for (const name of NAMES) {
    const value = ctx.cfg?.commands?.[name];
    if (typeof value !== 'string' || value.trim() === '') continue;
    const token = firstToken(value);
    if (!resolves(token, ctx)) {
      out.push({
        file: CONFIG,
        line: keyLine(ctx.root, name),
        message: `commands.${name}: "${token}" not found on PATH or under node_modules/.bin`,
      });
    }
  }
  return out;
}

export default { id, blocking, ratchet, run };
