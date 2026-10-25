// The shape a subagent's final output must have, per role (REQ-3.5, REQ-2.11, REQ-2.12). subagent-stop
// blocks once on any problem named here. An empty array means the output is well formed.
import fs from 'node:fs';
import path from 'node:path';
import { parseVerdict, verdictProblems } from '../verdict.js';

export const ROLES = new Set(['developer', 'reviewer', 'fixer', 'auditor', 'ops', 'designer']);
export const REVIEW_WINDOW_MS = 30 * 60 * 1000;
export const NO_OUTPUT = 'no output to check';
export const NO_VERDICT = 'no verdict file in .slicekit/reviews/ from this run';

const SKIPPED = /^\s*Skipped:/m;
const NOT_CHECKED = /^\s*Not checked:/m;
// Agents type ASCII: `->` stands for `→`.
const RAN = /^\s*ran: .+ (?:→|->) exit \d+/m;
const FINDING_ID = /\b[BH]-[1-9]\d*\b/;

// The newest regular file in <root>/.slicekit/reviews/ modified within the window, or null.
function newestReview(root, now) {
  const dir = path.join(root, '.slicekit', 'reviews');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best = null;
  for (const name of names) {
    let st;
    try {
      st = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile() || now - st.mtimeMs > REVIEW_WINDOW_MS) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { name, mtimeMs: st.mtimeMs };
  }
  return best && { file: path.join(dir, best.name), shown: `.slicekit/reviews/${best.name}` };
}

function reviewerProblems(root, now) {
  const review = newestReview(root, now);
  if (!review) return [NO_VERDICT];
  let text;
  try {
    text = fs.readFileSync(review.file);
  } catch (e) {
    return [`verdict file ${review.shown} unreadable: ${e.code ?? e.message}`];
  }
  return verdictProblems(parseVerdict(text, review.shown)).map((p) => `verdict file ${review.shown}: ${p}`);
}

// -> string[]. `role` is one of ROLES; any other role has no shape and gives [].
export function shapeProblems(role, text, { root, now = Date.now() } = {}) {
  if (!ROLES.has(role)) return [];
  if (typeof text !== 'string' || text.trim() === '') return [NO_OUTPUT];
  const out = [];
  if (!SKIPPED.test(text)) out.push('no "Skipped:" line');
  if (!NOT_CHECKED.test(text)) out.push('no "Not checked:" line');
  if (role === 'developer' && !RAN.test(text)) out.push('no "ran: <command> → exit <code>" line');
  if (role === 'fixer' && !FINDING_ID.test(text)) out.push('no finding id (B-<n> or H-<n>) named');
  if (role === 'reviewer') out.push(...reviewerProblems(root, now));
  return out;
}

// Claude Code's `agent_type` mapped onto a kit role: the name after any `plugin:` prefix, any case;
// anything else is `other`.
export function roleOf(agentType) {
  if (typeof agentType !== 'string') return 'other';
  const name = agentType.trim().toLowerCase().split(':').pop();
  return ROLES.has(name) ? name : 'other';
}
