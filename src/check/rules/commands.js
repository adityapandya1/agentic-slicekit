// commands (03 REQ-3.7): every command the team declared in config must be findable. Nothing is
// ever run. An empty string means "not declared", not missing.
//
// What is judged: the command is split on `&&`, `||`, `;` and `|` outside quotes. Each segment
// loses a leading `(` and a trailing `)`, then its leading `NAME=value` words. A segment whose next
// word is a shell builtin (`cd`, `set`, `export`, `.`, `source`, `exit`, `true`, `false`, `echo`,
// `test`, `[`) is not judged. In every other segment the first word is looked up. So
// `cd x && nosuchtool` is a finding on `nosuchtool`.
//
// Not expanded: a `$VAR` or `%VAR%` token is looked up as written and reported as written.
// A token with a path separator must be a regular file, relative to the root or absolute. On win32
// it is tried with the PATHEXT suffixes and bare, as `which()` does; on POSIX bare only. So a
// Windows-only `.cmd` passes on Windows and fails on POSIX.
import fs from 'node:fs';
import path from 'node:path';
import { which, extensions } from '../../which.js';

export const id = 'commands';
export const blocking = true;
export const ratchet = false;

const NAMES = ['test', 'lint', 'build', 'e2e'];
const CONFIG = '.slicekit/config.json';
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const BUILTINS = new Set(['cd', 'set', 'export', '.', 'source', 'exit', 'true', 'false', 'echo', 'test', '[']);

// Split on &&, ||, ; and | outside single or double quotes.
function segments(command) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if ((c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      out.push(cur);
      cur = '';
      i++;
    } else if (c === ';' || c === '|') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// The words to look up: one per segment that is not empty and not led by a builtin.
function commandWords(command) {
  const words = [];
  for (const seg of segments(command)) {
    const s = seg.trim().replace(/^\(+/, '').replace(/\)+$/, '').trim();
    if (s === '') continue;
    const word = firstToken(s);
    if (word === '' || BUILTINS.has(word)) continue;
    words.push(word);
  }
  return words;
}

// The command word: skip leading NAME=value words, then take the first token. A leading double
// quote runs to its closing quote, or to the end of the string when it is never closed.
function firstToken(command) {
  let s = command.trim();
  for (;;) {
    if (s.startsWith('"')) {
      const end = s.indexOf('"', 1);
      return end === -1 ? s.slice(1) : s.slice(1, end);
    }
    const word = s.split(/\s+/)[0];
    if (!ASSIGNMENT.test(word) || word === s) return word;
    s = s.slice(word.length).trimStart();
  }
}

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

function resolves(token, ctx) {
  const env = ctx.env ?? process.env;
  if (token.includes('/') || token.includes('\\')) {
    const file = path.resolve(ctx.root, token);
    return extensions(env).some((ext) => isFile(file + ext));
  }
  return which(token, env, [path.join(ctx.root, 'node_modules', '.bin')]) !== null;
}

// The line of the `"<name>"` key inside the "commands" object: scan from its opening brace to the
// brace that closes it, skipping string contents. Falls back to the "commands" line, else 1.
function keyLine(root, name) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, CONFIG), 'utf8');
  } catch {
    return 1;
  }
  const open = /"commands"\s*:\s*\{/.exec(text);
  if (!open) return 1;
  const lineAt = (i) => text.slice(0, i).split('\n').length;
  let depth = 0;
  for (let i = open.index + open[0].length - 1; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const isKey = depth === 1 && /^\s*:/.test(text.slice(j + 1, j + 64));
      if (isKey && text.slice(i + 1, j) === name) return lineAt(i);
      i = j;
    }
  }
  return lineAt(open.index);
}

export function run(ctx) {
  const out = [];
  for (const name of NAMES) {
    const value = ctx.cfg?.commands?.[name];
    if (typeof value !== 'string' || value.trim() === '') continue;
    for (const token of commandWords(value)) {
      if (resolves(token, ctx)) continue;
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
