import { seedBanned } from '../../config.js';
import { blankCodeSpans, prose } from '../../markdown.js';
import { intakeStatus } from '../context.js';

export const id = 'style';
export const blocking = true;
export const ratchet = true;

// A doc section that starts with this marker defines the filler list: it is not matched, and it
// must keep the seed list.
export const CATALOGUE = '<!-- slicekit:style-catalogue -->';
// A line carrying this marker quotes an example; it is not matched (as in `references`).
const EXAMPLE = '<!-- slicekit:example -->';

// Files that define the list without being docs. They are never in ctx.docs; named here so the
// exemption REQ-3.10 grants them stays explicit if the doc set ever widens.
const CONFIG = '.slicekit/config.json';
const EXEMPT = new Set([CONFIG, 'templates/style.json']);

const HEADING = /^(#{1,6})\s/;
const LINK_TARGET = /\]\(([^)]*)\)/g;
const URL = /[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+/gi;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blank = (m) => ' '.repeat(m.length);

// One spelling per phrase: trimmed, single-spaced, a curly apostrophe made straight.
const normal = (p) => p.replace(/’/g, "'").trim().replace(/\s+/g, ' ');

// Config phrases with duplicates (by lower-cased normal form) and blanks removed, first spelling kept.
function phrases(list) {
  const seen = new Map();
  for (const raw of list) {
    const p = normal(raw);
    if (p !== '' && !seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
  }
  return [...seen.values()];
}

// A phrase as whole words, case-insensitive: bounded by non-letters, any whitespace (a line break
// included) between its words, and a straight apostrophe also matching a curly one. Inflections are
// not derived, so `leverage` does not match `leverages`; a team lists each form it bans.
function matcher(phrase) {
  const body = phrase
    .split(' ')
    .map((w) => escape(w).replace(/'/g, "['’]"))
    .join('\\s+');
  return new RegExp(`(?<!\\p{L})${body}(?!\\p{L})`, 'giu');
}

// What a line says as writing: code spans, link targets and bare URLs blanked, columns unchanged.
const writing = (line) => blankCodeSpans(line).replace(LINK_TARGET, (m, t) => `](${blank(t)})`).replace(URL, blank);

// Catalogue sections: each starts at a marker written as prose (not quoted in code) and runs to the
// next heading of a level at or above the heading the marker sits under (to the end with none).
function sections(prosed) {
  const out = [];
  let parent = 0;
  for (const [i, [line]] of prosed.entries()) {
    const h = HEADING.exec(line);
    if (h) parent = h[1].length;
    if (!blankCodeSpans(line).includes(CATALOGUE)) continue;
    let end = prosed.length;
    for (let j = i + 1; j < prosed.length; j++) {
      const hj = HEADING.exec(prosed[j][0]);
      if (hj && parent > 0 && hj[1].length <= parent) {
        end = j;
        break;
      }
    }
    out.push({ start: i, end, line: prosed[i][1] });
  }
  return out;
}

// Runs of consecutive prose lines to match as one text: a blank line, a fence, a heading (its own
// run), an example line or a catalogue line ends one, so a phrase is found across a hard wrap but
// never across a paragraph break.
function runs(prosed, skip) {
  const out = [];
  let cur = null;
  const close = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const [i, [line, n]] of prosed.entries()) {
    // A marker quoted in a code span is text about the marker, not a marker.
    if (skip.has(i) || line.trim() === '' || blankCodeSpans(line).includes(EXAMPLE)) {
      close();
      continue;
    }
    const heading = HEADING.test(line);
    if (heading || (cur && n !== cur.lines.at(-1) + 1)) close();
    cur ??= { text: '', starts: [], lines: [] };
    if (cur.lines.length > 0) cur.text += '\n';
    cur.starts.push(cur.text.length);
    cur.lines.push(n);
    cur.text += writing(line);
    if (heading) close();
  }
  close();
  return out;
}

// The findings for docs, given the team's list and the kit's seed list. Exported for the
// empty-seed test, which cannot empty the real template.
export function findStyle(docs, banned, seed) {
  const findings = [];
  const seeds = phrases(seed);
  if (seeds.length === 0) {
    // A seed list emptied by accident would make every catalogue pass with nothing in it.
    findings.push({ file: 'templates/style.json', line: 0, message: 'catalogue seed list is empty', bucket: 'catalogue' });
  }
  const configured = phrases(banned);
  // The configured list must keep every seed phrase (REQ-3.10): an emptied list would make this
  // rule match nothing. Its bucket is a catalogue bucket, which `baseline update --adopt` refuses.
  const have = new Set(configured.map((p) => p.toLowerCase()));
  for (const p of seeds) {
    if (!have.has(p.toLowerCase())) {
      findings.push({ file: CONFIG, line: 0, message: `catalogue missing "${p}"`, bucket: `catalogue:${CONFIG}` });
    }
  }
  const patterns = configured.map((p) => [p, matcher(p)]);

  for (const doc of docs) {
    if (EXEMPT.has(doc.rel)) continue;
    const prosed = [...prose(doc.text)];
    const skip = new Set();
    for (const s of sections(prosed)) {
      for (let i = s.start; i < s.end; i++) skip.add(i);
      // A catalogue finding's bucket is `catalogue:<rel>`, which no baseline carries, so the
      // ratchet fails it on the first one. Only the seed list is required: a team phrase lives in
      // config alone.
      const text = normal(prosed.slice(s.start, s.end).map(([l]) => l).join(' ')).toLowerCase();
      for (const p of seeds) {
        if (!text.includes(p.toLowerCase())) {
          findings.push({ file: doc.rel, line: s.line, message: `catalogue missing "${p}"`, bucket: `catalogue:${doc.rel}` });
        }
      }
    }
    for (const run of runs(prosed, skip)) {
      const hits = [];
      for (const [phrase, re] of patterns) {
        for (const m of run.text.matchAll(re)) {
          let k = run.starts.length - 1;
          while (run.starts[k] > m.index) k--;
          hits.push({ file: doc.rel, line: run.lines[k], message: `banned phrase "${phrase}"`, bucket: doc.rel });
        }
      }
      findings.push(...hits.sort((a, b) => a.line - b.line));
    }
  }
  return findings;
}

export function run(ctx) {
  // A pinned intake file is frozen (REQ-1.2): a quoted phrase there is the author's words, never
  // rewritten. An unpinned one is matched like any doc.
  const docs = ctx.docs.filter((d) => intakeStatus(ctx, d) !== 'frozen');
  return findStyle(docs, ctx.cfg.style?.banned ?? [], seedBanned());
}

export default { id, blocking, ratchet, run };
