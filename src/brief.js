// `slicekit brief` (REQ-2.15, D-99): the interview that writes `<docsRoot>/brief/<slug>.md` from a
// person's answers alone, one topic per question in the order of REQ-2.15. An answer the person
// cannot give is listed under `## Open questions` by its topic's name and nowhere else. The brief
// holds only the seven headings, the answers and those topic names; `brief done` commits it.
//
// The session lives in this worktree's own git directory, `<git-dir>/slicekit/brief.json`, as
// {slug, startedAt, specFiles, pending, asked}: never in the work tree, so `git add -A` cannot stage
// it, and one per worktree. pre-edit denies the file, so an agent cannot rewrite it by hand.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './fs.js';
import { commitPaths, currentBranch, git } from './git.js';
import { kitPaths } from './paths.js';

// `code` 1: refused. `code` 2: bad input.
export class BriefError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BriefError';
    this.code = code;
  }
}

// The topics of REQ-2.15 in their order, each with the heading its answers go under. An answer to
// `unknowns` is an open question the person named; it goes under `## Open questions`.
export const SECTIONS = [
  { topic: 'problem', heading: 'Problem and who has it' },
  { topic: 'today', heading: 'What they do today' },
  { topic: 'use-cases', heading: 'Use cases' },
  { topic: 'out-of-scope', heading: 'Out of scope' },
  { topic: 'success-measures', heading: 'Success measures' },
  { topic: 'constraints', heading: 'Constraints' },
  { topic: 'unknowns', heading: 'Open questions' },
];
export const BRIEF_HEADINGS = SECTIONS.map((s) => s.heading);
const TOPICS = SECTIONS.map((s) => s.topic);
const OPEN = 'Open questions';
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

const posix = (p) => p.split(path.sep).join('/');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// The `## ` headings of a brief that are missing from `text`, in the order of REQ-2.15.
export function missingHeadings(text) {
  const present = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  return BRIEF_HEADINGS.filter((h) => !present.has(`## ${h}`));
}

function onWorkBranch(root, cfg, what) {
  const branch = currentBranch(root);
  if (branch === null || branch === cfg.defaultBranch || cfg.protectedBranches.includes(branch)) {
    throw new BriefError(1, `${what} on a work branch; run slicekit branch spec <slug>`);
  }
}

function sessionPath(root) {
  return path.join(git(root, ['rev-parse', '--path-format=absolute', '--git-dir']), 'slicekit', 'brief.json');
}

function readSession(root) {
  const file = sessionPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new BriefError(1, `${posix(file)} is not valid JSON; delete it to start the brief again`);
  }
}

function writeSession(root, session) {
  const file = sessionPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`);
}

const needSession = (root) => {
  const session = readSession(root);
  if (!session) throw new BriefError(1, 'no brief is under way; run slicekit brief start <slug> first');
  return session;
};

// Each file under the spec directory, root-relative and POSIX, with the SHA-256 of its bytes.
function specFilesNow(root, cfg) {
  const dir = kitPaths(root, cfg).spec;
  if (!fs.existsSync(dir)) return {};
  const base = posix(path.relative(root, dir));
  return Object.fromEntries(listFiles(dir).map((f) => [`${base}/${f}`, sha256(fs.readFileSync(path.join(dir, f)))]));
}

const briefFile = (root, cfg, slug) => path.join(kitPaths(root, cfg).brief, `${slug}.md`);
const briefRel = (root, cfg, slug) => posix(path.relative(root, briefFile(root, cfg, slug)));

// The brief as the session holds it: each heading, then the answers under it in the order given;
// an unknown answer is its topic's heading name under Open questions.
export function renderBrief(asked) {
  const under = Object.fromEntries(BRIEF_HEADINGS.map((h) => [h, []]));
  for (const a of asked) {
    const { heading } = SECTIONS.find((s) => s.topic === a.topic);
    if (a.answer !== null) under[heading].push(a.answer);
    else if (a.topic !== 'unknowns') under[OPEN].push(heading);
  }
  return `${BRIEF_HEADINGS.map((h) => [`## ${h}`, ...under[h]].join('\n\n')).join('\n\n')}\n`;
}

// Opens the session for `slug` and writes the brief with its seven empty headings.
export function start(root, cfg, { slug, now = new Date() } = {}) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new BriefError(2, `slug '${slug}' must be lowercase letters, digits and dashes, at most 60, not starting with a dash`);
  }
  onWorkBranch(root, cfg, 'the brief');
  const existing = readSession(root);
  if (existing) {
    throw new BriefError(1, `the brief ${existing.slug} is under way; run slicekit brief done, or delete ${posix(sessionPath(root))} to drop it`);
  }
  const file = briefFile(root, cfg, slug);
  const rel = briefRel(root, cfg, slug);
  if (fs.existsSync(file)) throw new BriefError(1, `${rel} exists; choose another slug`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderBrief([]));
  writeSession(root, { slug, startedAt: now.toISOString(), specFiles: specFilesNow(root, cfg), pending: null, asked: [] });
  return { file: rel };
}

function oneLine(field, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new BriefError(2, `${field} is required`);
  if (/[\r\n]/.test(value)) throw new BriefError(2, `${field} must be one line`);
  return value.trim();
}

// Holds `question` on `topic` as the one waiting for an answer; returns its number. The topic is the
// one last asked (a follow-up) or the next in the order of REQ-2.15.
export function ask(root, cfg, { topic, question } = {}) {
  if (!TOPICS.includes(topic)) throw new BriefError(2, `topic must be one of ${TOPICS.join(', ')}, not '${topic}'`);
  const q = oneLine('question', question);
  const session = needSession(root);
  if (session.pending) throw new BriefError(1, `answer the last question first: "${session.pending.question}" has no answer`);
  const last = session.asked.length === 0 ? -1 : TOPICS.indexOf(session.asked.at(-1).topic);
  const at = TOPICS.indexOf(topic);
  if (at !== last && at !== last + 1) {
    throw new BriefError(1, `topic ${topic} is out of order; ask ${last === -1 ? TOPICS[0] : `${TOPICS[last]} or ${TOPICS[last + 1] ?? 'nothing more'}`}`);
  }
  session.pending = { topic, question: q };
  writeSession(root, session);
  return { n: session.asked.length + 1 };
}

// Writes the waiting question's answer into the brief, then clears it: the brief first, so the
// answer is recorded before the next question can be asked. `unknown` lists the topic under Open
// questions instead.
export function answer(root, cfg, { answer: text, unknown = false } = {}) {
  const session = needSession(root);
  if (!session.pending) throw new BriefError(1, 'no question is waiting for an answer');
  let value = null;
  if (!unknown) {
    if (typeof text !== 'string' || text.trim() === '') throw new BriefError(2, 'answer is required');
    value = text.trim().replace(/\r\n/g, '\n');
    if (value.split('\n').some((l) => /^#{1,6}\s/.test(l.trim()))) throw new BriefError(2, 'an answer holds no heading line');
  }
  const asked = [...session.asked, { ...session.pending, answer: value }];
  fs.mkdirSync(kitPaths(root, cfg).brief, { recursive: true });
  fs.writeFileSync(briefFile(root, cfg, session.slug), renderBrief(asked));
  writeSession(root, { ...session, pending: null, asked });
  return { file: briefRel(root, cfg, session.slug) };
}

// Ends the brief: refuses while a question waits, on the default or a protected branch, while a
// heading is missing from the brief, or when a file under the spec directory appeared, changed or
// went since `brief start`; otherwise commits the brief alone.
export function done(root, cfg) {
  const session = needSession(root);
  if (session.pending) throw new BriefError(1, `answer the last question first: "${session.pending.question}" has no answer`);
  onWorkBranch(root, cfg, 'the brief');
  const file = briefFile(root, cfg, session.slug);
  const rel = briefRel(root, cfg, session.slug);
  if (!fs.existsSync(file)) throw new BriefError(1, `${rel} is missing; run slicekit brief start ${session.slug} again`);
  const missing = missingHeadings(fs.readFileSync(file, 'utf8'));
  if (missing.length > 0) throw new BriefError(1, `${rel} has no section ## ${missing[0]}`);
  const known = session.specFiles ?? {};
  const now = specFilesNow(root, cfg);
  for (const [f, digest] of Object.entries(now)) {
    if (!Object.hasOwn(known, f)) throw new BriefError(1, `the brief writes no spec text; remove ${f}`);
    if (known[f] !== digest) throw new BriefError(1, `the brief writes no spec text; ${f} changed during the interview`);
  }
  for (const f of Object.keys(known)) {
    if (!Object.hasOwn(now, f)) throw new BriefError(1, `the brief writes no spec text; ${f} was removed during the interview`);
  }
  const commit = commitPaths(root, [rel], `docs(brief): ${session.slug}`);
  fs.rmSync(sessionPath(root), { force: true });
  return { file: rel, commit };
}
