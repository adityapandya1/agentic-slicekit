// ci-body (02 REQ-2.10, 03 REQ-3.11, REQ-3.7): with --ci, the pull request's body carries the
// REQ-2.10 sections, each once, in order, none empty, under a `## [P<n>/S-<nn>] <name>` heading
// that names the title's slice. A section is `**<name>:**` at the start of a line (indent allowed);
// its text is what follows the colon on that line, or the next non-blank line when that is not
// itself a section. Anything inside a fenced code block is never a section or a heading. A
// `[spec] ` / `[plan] ` title needs only the first three sections and no slice heading; a title
// with no slice id leaves the heading to ci-title. Without --ci, or with no pull request, nothing.
import { ID } from '../../ids.js';
import { EXEMPT_TITLE, PR_FILE, readCiEvent } from '../ci-event.js';
import { titleSlice } from './ci-title.js';

export const id = 'ci-body';
export const blocking = true;
export const ratchet = false;

export const REQUIRED_SECTIONS = Object.freeze([
  'Done when',
  'Proof',
  'Decisions',
  'Runbook',
  'Infra / migration',
  'Try it',
  'Reviewer blocked',
  'Should-haves declined',
  'Skipped / not checked',
]);
const EXEMPT_SECTIONS = REQUIRED_SECTIONS.slice(0, 3);

const SECTION = /^\s*\*\*([^*\n]+?):\*\*(.*)$/;
const HEADING = new RegExp(`^## \\[(${ID.sliceAddr})\\] \\S`);
const FENCE = /^\s*(```|~~~)/;

// Each line with whether it sits inside a fenced code block (a fence line counts as inside).
function scan(body) {
  let fence = null;
  return body.replace(/\r\n?/g, '\n').split('\n').map((text) => {
    const m = FENCE.exec(text);
    if (m) {
      if (fence === null) fence = m[1];
      else if (m[1] === fence) fence = null;
      return { text, fenced: true };
    }
    return { text, fenced: fence !== null };
  });
}

export function run(ctx) {
  if (!ctx.ci) return [];
  const pr = readCiEvent(ctx.env);
  if (!pr) return [];
  const exempt = EXEMPT_TITLE.test(pr.title);
  const required = exempt ? EXEMPT_SECTIONS : REQUIRED_SECTIONS;
  const lines = scan(pr.body);
  const out = [];
  const at = (message) => out.push({ file: PR_FILE, line: 0, message });

  const slice = exempt ? null : titleSlice(pr.title);
  if (slice && !lines.some((l) => !l.fenced && HEADING.exec(l.text)?.[1] === slice)) {
    at(`pull request body heading does not name ${slice}`);
  }

  // Every section line outside a fence, with whether text follows it.
  const found = [];
  lines.forEach((l, i) => {
    const m = !l.fenced && SECTION.exec(l.text);
    if (!m) return;
    let filled = m[2].trim() !== '';
    if (!filled) {
      const next = lines.slice(i + 1).find((n) => n.text.trim() !== '');
      filled = next !== undefined && (next.fenced || !SECTION.test(next.text));
    }
    found.push({ name: m[1].trim(), filled });
  });

  const seen = new Set();
  let furthest = -1;
  for (const s of found) {
    const rank = required.indexOf(s.name);
    if (rank === -1) continue;
    if (seen.has(s.name)) {
      at(`pull request body has "${s.name}" twice`);
      continue;
    }
    seen.add(s.name);
    if (rank < furthest) at(`pull request body has "${s.name}" out of order`);
    furthest = Math.max(furthest, rank);
    if (!s.filled) at(`pull request body has an empty "${s.name}"`);
  }
  for (const name of required) if (!seen.has(name)) at(`pull request body is missing "${name}"`);
  return out;
}

export default { id, blocking, ratchet, run };
