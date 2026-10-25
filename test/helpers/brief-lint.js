// The brief lint (REQ-2.1, REQ-2.12): an agent brief or a command procedure checked against the
// writing rules and the git rule. Commands own git, so a procedure runs no git or gh command at all.
// A brief may name the read-only `git diff`, `git log`, `git show` and `git status` (pre-bash allows
// them); any other git command, and any gh call, only in a sentence that forbids it ("never").
import { seedBanned } from '../../src/config.js';
import { COMMANDS } from '../../src/cli/index.js';
import { blankCodeSpans, prose } from '../../src/markdown.js';

const READ_ONLY = new Set(['diff', 'log', 'show', 'status']);
const FOOTER = ['Skipped:', 'Not checked:'];
const CLI_WORD = /\{\{cli\}\}[ \t]+([^\s`.,;:)]+)(?:[ \t]+([^\s`.,;:)]+))?/g;
const SUB = /^[a-z][a-z-]*$/;
const CODE_SPAN = /`([^`\n]+)`/g;
const FENCE = /^\s*(```|~~~)/;
// A git or gh invocation at the start of a command or after a shell operator, with its next word.
const INVOCATION = /(?:^|&&|\|\||[;|(])\s*(git|gh)(?:\s+(\S+))?/g;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every git or gh invocation in a piece of command text, as {tool, sub}.
function invocations(cmd) {
  return [...cmd.trim().matchAll(INVOCATION)].map((m) => ({ tool: m[1], sub: m[2] ?? '' }));
}

// The command texts a line holds: each code span, and the line itself when it starts with git or gh
// (a list marker allowed) or sits inside a fenced block.
function commandTexts(line, fenced) {
  if (fenced) return [line];
  const out = [...line.matchAll(CODE_SPAN)].map((m) => m[1]);
  const start = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?((?:git|gh)\s.*)$/.exec(line);
  if (start) out.push(start[1]);
  return out;
}

function gitProblems(text, kind) {
  const out = [];
  let fenced = false;
  for (const raw of text.split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    const line = raw.trim();
    if (kind === 'command') {
      if (commandTexts(raw, fenced).flatMap(invocations).length > 0) out.push(`procedure runs git: ${line}`);
      continue;
    }
    // "never" forbids only within its own sentence; a fenced line is one command.
    const allowed = (sentence) => {
      const found = commandTexts(sentence, fenced).flatMap(invocations);
      return !found.some((f) => f.tool === 'gh' || !READ_ONLY.has(f.sub)) || /\bnever\b/i.test(sentence);
    };
    if (!(fenced ? [raw] : sentences(raw)).every(allowed)) out.push(`brief tells an agent to run git: ${line}`);
  }
  return out;
}

// A line split into sentences after `.`, `!`, `?` or `;` and a space; a full stop inside a code span
// does not end a sentence.
function sentences(line) {
  const blanked = blankCodeSpans(line);
  const out = [];
  let from = 0;
  for (const m of blanked.matchAll(/[.!?;]\s+/g)) {
    out.push(line.slice(from, m.index + 1));
    from = m.index + m[0].length;
  }
  out.push(line.slice(from));
  return out.filter((s) => s.trim() !== '');
}

// The `## Your report` section when the text has one, else the whole text.
function reportSection(text) {
  const all = text.split(/\r?\n/);
  const start = all.findIndex((l) => /^## Your report\s*$/.test(l));
  if (start === -1) return text;
  const end = all.findIndex((l, i) => i > start && /^## /.test(l));
  return all.slice(start, end === -1 ? all.length : end).join('\n');
}

function cliProblems(text, commands) {
  const out = [];
  for (const m of text.matchAll(CLI_WORD)) {
    const [, word, sub] = m;
    const cmd = Object.hasOwn(commands, word) ? commands[word] : undefined;
    if (!cmd) {
      out.push(`unknown command ${word}`);
      continue;
    }
    if (sub && SUB.test(sub) && Array.isArray(cmd.subcommands) && !cmd.subcommands.includes(sub)) out.push(`unknown subcommand ${word} ${sub}`);
  }
  return [...new Set(out)];
}

// Each phrase as whole words, case-insensitive, matched across a line break in the prose with code
// spans blanked.
function bannedProblems(text, banned) {
  const writing = [...prose(text)].map(([l]) => blankCodeSpans(l)).join('\n');
  const out = [];
  for (const p of banned) {
    const body = p.trim().split(/\s+/).map((w) => escape(w).replace(/'/g, "['’]")).join('\\s+');
    if (body !== '' && new RegExp(`(?<!\\p{L})${body}(?!\\p{L})`, 'iu').test(writing)) out.push(`banned phrase "${p}"`);
  }
  return out;
}

// -> string[], one message per problem; [] when the text passes.
export function briefProblems(text, { kind, commands = COMMANDS, banned = seedBanned() } = {}) {
  if (kind !== 'agent' && kind !== 'command') throw new Error(`kind must be agent or command, not ${kind}`);
  const out = [...cliProblems(text, commands), ...gitProblems(text, kind), ...bannedProblems(text, banned)];
  // A brief requires the footer where it states the report: each label quoted or in a code span.
  const report = reportSection(text);
  const requires = (f) => report.includes(`\`${f}\``) || report.includes(`"${f}"`);
  if (kind === 'agent') for (const f of FOOTER) if (!requires(f)) out.push(`brief does not require "${f}"`);
  return out;
}
