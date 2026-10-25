// ci-body (02 REQ-2.10, 03 REQ-3.11, REQ-3.7): with --ci, the pull request's body carries the
// REQ-2.10 sections, each once, in order, none empty, under a `## [P<n>/S-<nn>] <name>` heading
// that names the title's slice. A section is `**<name>:**` at the start of a line (indent allowed);
// its text is what follows the colon on that line, or the next non-blank line when that is not
// itself a required section or a heading. Anything inside a fenced code block (CommonMark fences)
// or an HTML comment is never a section or a heading, and a comment is never section text. A
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
// A CommonMark fence: up to three spaces, then three or more backticks or tildes.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

// Each line as `{text, fenced}`. A fenced line (fence lines included) keeps its text and is never a
// section or a heading. Outside a fence, text inside `<!-- ... -->` (across lines too) is removed,
// so a line that is only a comment reads as blank. A leading byte order mark is dropped.
function scan(body) {
  let fence = null;
  let comment = false;
  const out = [];
  for (const raw of body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    if (fence !== null) {
      const m = FENCE_CLOSE.exec(raw);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out.push({ text: raw, fenced: true });
      continue;
    }
    if (!comment) {
      const m = FENCE_OPEN.exec(raw);
      if (m) {
        fence = m[1];
        out.push({ text: raw, fenced: true });
        continue;
      }
    }
    let text = '';
    let rest = raw;
    while (rest !== '') {
      if (comment) {
        const end = rest.indexOf('-->');
        if (end === -1) rest = '';
        else {
          comment = false;
          rest = rest.slice(end + 3);
        }
      } else {
        const start = rest.indexOf('<!--');
        if (start === -1) {
          text += rest;
          rest = '';
        } else {
          comment = true;
          text += rest.slice(0, start);
          rest = rest.slice(start + 4);
        }
      }
    }
    out.push({ text, fenced: false });
  }
  return out;
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
      // The next line with text decides: a required section or a heading ends this one empty.
      const next = lines.slice(i + 1).find((n) => n.text.trim() !== '');
      const ends = (n) => {
        if (n.fenced) return false;
        if (/^ {0,3}#{1,6}(\s|$)/.test(n.text)) return true;
        const sm = SECTION.exec(n.text);
        return sm !== null && required.includes(sm[1].trim());
      };
      filled = next !== undefined && !ends(next);
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
