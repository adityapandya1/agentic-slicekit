import { seedBanned } from '../../config.js';
import { blankCodeSpans, prose } from '../../markdown.js';

export const id = 'style';
export const blocking = true;
export const ratchet = true;

// A doc carrying this marker defines the filler list: it is not matched, and it must keep the list.
export const CATALOGUE = '<!-- slicekit:style-catalogue -->';

// Files that define the list without being docs. They are never in ctx.docs; named here so the
// exemption REQ-3.10 grants them stays explicit if the doc set ever widens.
const EXEMPT = new Set(['.slicekit/config.json', 'templates/style.json']);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A phrase as whole words, case-insensitive: bounded by non-letters, any run of spaces between its
// words, and a straight apostrophe also matching a curly one. Inflections are not derived, so
// `leverage` does not match `leverages`; a team lists each form it bans.
function matcher(phrase) {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map((w) => escape(w).replace(/'/g, "['’]"))
    .join('\\s+');
  return new RegExp(`(?<!\\p{L})${body}(?!\\p{L})`, 'giu');
}

export function run(ctx) {
  const findings = [];
  const banned = [...new Set((ctx.cfg.style?.banned ?? []).filter((p) => p.trim() !== ''))];
  const patterns = banned.map((p) => [p, matcher(p)]);
  const seed = seedBanned();

  for (const doc of ctx.docs) {
    if (EXEMPT.has(doc.rel)) continue;
    // The marker counts only as prose: a doc that quotes it in code (this slice's own plan does)
    // is not a catalogue.
    const isCatalogue = [...prose(doc.text)].some(([line]) => blankCodeSpans(line).includes(CATALOGUE));
    if (isCatalogue) {
      // A catalogue finding has its own bucket, `catalogue`, which no baseline carries, so the
      // ratchet fails it on the first one. Only the seed list is required here: a team phrase
      // lives in config alone.
      const plain = doc.text.toLowerCase().replace(/’/g, "'");
      for (const p of seed) {
        if (!plain.includes(p.toLowerCase())) {
          findings.push({ file: doc.rel, line: 0, message: `catalogue missing "${p}"`, bucket: 'catalogue' });
        }
      }
      continue;
    }
    for (const [line, n] of prose(doc.text)) {
      const text = blankCodeSpans(line);
      for (const [phrase, re] of patterns) {
        for (const _ of text.matchAll(re)) {
          findings.push({ file: doc.rel, line: n, message: `banned phrase "${phrase}"`, bucket: doc.rel });
        }
      }
    }
  }
  return findings;
}

export default { id, blocking, ratchet, run };
