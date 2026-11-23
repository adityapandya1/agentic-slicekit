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
import { fileURLToPath } from 'node:url';
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

// The topic headings of a brief whose section holds no line and whose name is not listed under
// `## Open questions`, in the order of REQ-2.15: each such topic was neither answered nor left open.
export function unlistedEmptySections(text) {
  const under = {};
  let at = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      at = line.slice(3).trim();
      under[at] ??= [];
    } else if (at !== null && line !== '') under[at].push(line);
  }
  const open = new Set((under[OPEN] ?? []).map((l) => l.toLowerCase()));
  return BRIEF_HEADINGS.filter((h) => h !== OPEN && Object.hasOwn(under, h) && under[h].length === 0 && !open.has(h.toLowerCase()));
}

// The kit's blank brief, `templates/brief/blank.md`: the guidance line it holds under each heading.
// Read once, when first asked.
const BLANK = fileURLToPath(new URL('../templates/brief/blank.md', import.meta.url));
let blank = null;
function blankBrief() {
  if (blank !== null) return blank;
  const lines = fs.readFileSync(BLANK, 'utf8').split(/\r?\n/).map((l) => l.trim());
  const guidance = {};
  let at = null;
  for (const line of lines) {
    if (line.startsWith('## ')) at = line.slice(3).trim();
    else if (at !== null && line !== '') (guidance[at] ??= new Set()).add(line);
  }
  blank = { guidance };
  return blank;
}

// What of the blank brief a brief still holds unfilled (issue #206): a title that still holds
// `<name>`, or a section whose only line is the guidance line the blank brief holds
// under that heading. -> the first such, as a phrase that follows the file's name, or null.
export function blankLeftover(text) {
  const { guidance } = blankBrief();
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const first = lines.find((l) => l.startsWith('# '));
  if (first !== undefined && first.includes('<name>')) {
    return `still has the blank brief's title "${first}"; put the brief's name in place of <name>`;
  }
  const under = {};
  let at = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      at = line.slice(3).trim();
      under[at] ??= [];
    } else if (at !== null && line !== '') under[at].push(line);
  }
  for (const h of BRIEF_HEADINGS) {
    const body = under[h] ?? [];
    if (body.length === 1 && guidance[h]?.has(body[0])) {
      return `has under ## ${h} only the blank brief's guidance line; replace it with the answer${h === OPEN ? ', or remove it when nothing is open' : `, or list ${h} under ## ${OPEN}`}`;
    }
  }
  return null;
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

// The brief as the session holds it, rebuilt from every recorded answer: each heading, then the
// answers under it in the order given. A topic with only unknown answers is its heading name under
// Open questions, once; a topic with a real answer is answered and not listed as open.
export function renderBrief(asked) {
  const under = Object.fromEntries(BRIEF_HEADINGS.map((h) => [h, []]));
  const answered = new Set(asked.filter((a) => a.answer !== null).map((a) => a.topic));
  const open = new Set();
  for (const a of asked) {
    const { heading } = SECTIONS.find((s) => s.topic === a.topic);
    if (a.answer !== null) under[heading].push(a.answer);
    else if (a.topic !== 'unknowns' && !answered.has(a.topic)) open.add(heading);
  }
  under[OPEN].unshift(...open);
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
// questions instead, and is refused on a topic the person already answered.
export function answer(root, cfg, { answer: text, unknown = false } = {}) {
  const session = needSession(root);
  if (!session.pending) throw new BriefError(1, 'no question is waiting for an answer');
  let value = null;
  if (unknown) {
    const { topic } = session.pending;
    if (topic !== 'unknowns' && session.asked.some((a) => a.topic === topic && a.answer !== null)) {
      throw new BriefError(1, `topic ${topic} is already answered, so it cannot be open; record what the person says to this question with slicekit brief answer --answer <a>`);
    }
  } else {
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
// topic was never asked and answered (an unknown answer counts), while a heading is missing from the brief,
// while a section's only line is the blank brief's guidance line under that heading (`blankLeftover`),
// or when a file under the spec directory appeared, changed or went since `brief start`; otherwise
// commits the brief alone.
export function done(root, cfg) {
  const session = needSession(root);
  if (session.pending) throw new BriefError(1, `answer the last question first: "${session.pending.question}" has no answer`);
  onWorkBranch(root, cfg, 'the brief');
  const answered = new Set(session.asked.map((a) => a.topic));
  const unasked = TOPICS.find((t) => !answered.has(t));
  if (unasked) {
    throw new BriefError(1, `topic ${unasked} was never asked and answered; run slicekit brief ask --topic ${unasked} --question <q>, then slicekit brief answer`);
  }
  const file = briefFile(root, cfg, session.slug);
  const rel = briefRel(root, cfg, session.slug);
  if (!fs.existsSync(file)) throw new BriefError(1, `${rel} is missing; run slicekit brief start ${session.slug} again`);
  const text = fs.readFileSync(file, 'utf8');
  const missing = missingHeadings(text);
  if (missing.length > 0) throw new BriefError(1, `${rel} has no section ## ${missing[0]}`);
  const leftover = blankLeftover(text);
  if (leftover !== null) throw new BriefError(1, `${rel} ${leftover}`);
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
