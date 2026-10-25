// The pull request body (02 REQ-2.10): one home for what the body must hold, read by the ci-body
// rule and by `slicekit pr open`, and the renderer and editors every command writes it through.
// A section is `**<name>:**` at the start of a line (indent allowed); its text is what follows the
// colon on that line, or the next non-blank line when that is not itself a required section or a
// heading. Anything inside a fenced code block (CommonMark fences) or an HTML comment is never a
// section or a heading, and a comment is never section text. A `[spec] ` / `[plan] ` title needs
// only the first three sections and no slice heading; a title with no slice id leaves the heading to
// ci-title. The configured filler list (style.banned) is matched over the body, one finding per
// phrase (REQ-3.10).
import { ID } from './ids.js';
import { EXEMPT_TITLE } from './check/ci-event.js';
import { titleSlice } from './check/rules/ci-title.js';
import { bannedPhrasesIn } from './check/rules/style.js';

export class PrBodyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrBodyError';
  }
}

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
export const EXEMPT_SECTIONS = Object.freeze(REQUIRED_SECTIONS.slice(0, 3));

const SECTION = /^\s*\*\*([^*\n]+?):\*\*(.*)$/;
const HEADING = new RegExp(`^## \\[(${ID.sliceAddr})\\] \\S`);
const ANY_HEADING = /^ {0,3}#{1,6}(\s|$)/;
// A CommonMark fence: up to three spaces, then three or more backticks or tildes.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

// Each line as `{text, fenced}`. A fenced line (fence lines included) keeps its text and is never a
// section or a heading. Outside a fence, text inside `<!-- ... -->` (across lines too) is removed,
// so a line that is only a comment reads as blank. A leading byte order mark is dropped. Lines break
// at CRLF, CR or LF, the same breaks `segments` keeps.
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

const sectionName = (line) => {
  const m = !line.fenced && SECTION.exec(line.text);
  return m ? m[1].trim() : null;
};

// Whether a line ends the text of a section that has none on its own line.
const ends = (line, required) => {
  if (line.fenced) return false;
  if (ANY_HEADING.test(line.text)) return true;
  const name = sectionName(line);
  return name !== null && required.includes(name);
};

// REQ-2.10's messages for a title and body, exactly as ci-body reports them.
export function prBodyProblems(title, body, cfg) {
  const exempt = EXEMPT_TITLE.test(title);
  const required = exempt ? EXEMPT_SECTIONS : REQUIRED_SECTIONS;
  const lines = scan(body ?? '');
  const out = [];

  const slice = exempt ? null : titleSlice(title);
  if (slice && !lines.some((l) => !l.fenced && HEADING.exec(l.text)?.[1] === slice)) {
    out.push(`pull request body heading does not name ${slice}`);
  }

  // Every section line outside a fence, with whether text follows it.
  const found = [];
  lines.forEach((l, i) => {
    const m = !l.fenced && SECTION.exec(l.text);
    if (!m) return;
    let filled = m[2].trim() !== '';
    if (!filled) {
      const next = lines.slice(i + 1).find((n) => n.text.trim() !== '');
      filled = next !== undefined && !ends(next, required);
    }
    found.push({ name: m[1].trim(), filled });
  });

  const seen = new Set();
  let furthest = -1;
  for (const s of found) {
    const rank = required.indexOf(s.name);
    if (rank === -1) continue;
    if (seen.has(s.name)) {
      out.push(`pull request body has "${s.name}" twice`);
      continue;
    }
    seen.add(s.name);
    if (rank < furthest) out.push(`pull request body has "${s.name}" out of order`);
    furthest = Math.max(furthest, rank);
    if (!s.filled) out.push(`pull request body has an empty "${s.name}"`);
  }
  for (const name of required) if (!seen.has(name)) out.push(`pull request body is missing "${name}"`);
  for (const p of bannedPhrasesIn(body ?? '', cfg?.style?.banned ?? [])) out.push(`pull request body uses banned phrase "${p}"`);
  return out;
}

const blank = (text) => typeof text !== 'string' || text.trim() === '';

function assertSection(name, text) {
  if (!REQUIRED_SECTIONS.includes(name)) throw new PrBodyError(`unknown section "${name}"`);
  if (blank(text)) throw new PrBodyError(`section "${name}" is empty`);
}

const SLICE_ADDR = new RegExp(`^${ID.sliceAddr}$`);

// A section's line, and its continuation lines when the text has more than one. A text that opens
// with a fence starts on the line after the marker, since a fence only opens at the start of a line.
function sectionLines(name, text) {
  const t = text.trim();
  return FENCE_OPEN.test(t.split(/\r\n|\r|\n/)[0]) ? `**${name}:**\n${t}` : `**${name}:** ${t}`;
}

// A body with every section in order: `## [<slice>] <name>` first, or, with `slice: null` (a
// `[spec]` or `[plan]` pull request), no heading and only the first three sections. The result is
// judged as ci-body would judge it; a value that would make it fail (an unclosed fence or comment,
// a line that reads as another section) is refused naming the problem.
export function renderPrBody({ slice, name, sections }) {
  if (slice !== null && (typeof slice !== 'string' || !SLICE_ADDR.test(slice))) {
    throw new PrBodyError(`slice must be null or P<n>/S-<nn>, got ${JSON.stringify(slice)}`);
  }
  const names = slice === null ? EXEMPT_SECTIONS : REQUIRED_SECTIONS;
  const out = slice === null ? [] : [`## [${slice}] ${name}`];
  for (const n of names) {
    const text = sections?.[n];
    assertSection(n, text);
    out.push(sectionLines(n, text));
  }
  const body = `${out.join('\n')}\n`;
  const problems = prBodyProblems(slice === null ? '[spec] body' : `[${slice}] ${name}`, body, {});
  if (problems.length > 0) throw new PrBodyError(`the body would fail the CI body rule: ${problems.join('; ')}`);
  return body;
}

// The body as lines with the break that follows each, so an edit keeps every other byte.
function segments(body) {
  const parts = body.split(/(\r\n|\r|\n)/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) out.push({ raw: parts[i], sep: parts[i + 1] ?? '' });
  return out;
}

// The section's line range [start, end) and its text, or null when the body has no such section.
// Its text is the rest of its line and the lines that follow up to a blank line outside a fence, a
// heading or another required section; when its own line has no text, blank lines before the text
// are skipped.
function locate(lines, name) {
  const start = lines.findIndex((l) => sectionName(l) === name);
  if (start === -1) return null;
  const first = SECTION.exec(lines[start].text)[2].trim();
  const text = first === '' ? [] : [first];
  let end = start + 1;
  if (first === '') {
    let k = end;
    while (k < lines.length && lines[k].text.trim() === '') k++;
    if (k < lines.length && !ends(lines[k], REQUIRED_SECTIONS)) end = k;
  }
  // A fenced block is one piece of text, blank lines inside it included.
  while (end < lines.length && (lines[end].fenced || (lines[end].text.trim() !== '' && !ends(lines[end], REQUIRED_SECTIONS)))) {
    text.push(lines[end].text);
    end++;
  }
  return { start, end, text: text.join('\n').trim() };
}

// The text of a section, or null when the body does not have it.
export function getSection(body, name) {
  return locate(scan(body), name)?.text ?? null;
}

// Writes `**<name>:** <text>` in place of the section and its text, keeping every other byte. An
// absent section goes before the next required section the body has, else at the end. An edit that
// gives the body a problem it did not have (judged under the slice its heading names) is refused.
export function setSection(body, name, text) {
  assertSection(name, text);
  const out = writeSection(body, name, text);
  const slice = scan(body).map((l) => !l.fenced && HEADING.exec(l.text)?.[1]).find(Boolean);
  const title = slice ? `[${slice}] body` : 'body';
  const before = prBodyProblems(title, body, {});
  const added = prBodyProblems(title, out, {}).filter((p) => !before.includes(p));
  if (added.length > 0) throw new PrBodyError(`the section would break the body: ${added.join('; ')}`);
  return out;
}

function writeSection(body, name, text) {
  const segs = segments(body);
  const lines = scan(body);
  const at = locate(lines, name);
  const eol = segs.find((s) => s.sep !== '')?.sep ?? '\n';
  const fresh = sectionLines(name, text).split(/\r\n|\r|\n/);
  const bom = body.startsWith('\uFEFF') ? '\uFEFF' : '';
  const join = (list) => list.map((s) => s.raw + s.sep).join('');
  if (at) {
    const sep = segs[at.end - 1].sep;
    const keepBom = at.start === 0 ? bom : '';
    const replaced = fresh.map((raw, i) => ({ raw: (i === 0 ? keepBom : '') + raw, sep: i === fresh.length - 1 ? sep : eol }));
    return join([...segs.slice(0, at.start), ...replaced, ...segs.slice(at.end)]);
  }
  const later = REQUIRED_SECTIONS.slice(REQUIRED_SECTIONS.indexOf(name) + 1);
  const before = lines.findIndex((l) => later.includes(sectionName(l)));
  const inserted = fresh.map((raw) => ({ raw, sep: eol }));
  if (before !== -1) {
    if (before === 0 && bom) {
      inserted[0].raw = bom + inserted[0].raw;
      segs[0] = { ...segs[0], raw: segs[0].raw.slice(1) };
    }
    return join([...segs.slice(0, before), ...inserted, ...segs.slice(before)]);
  }
  if (body === '') return fresh.join(eol);
  const tail = body.endsWith('\n') || body.endsWith('\r');
  return tail ? `${body}${fresh.join(eol)}${eol}` : `${body}${eol}${fresh.join(eol)}`;
}
