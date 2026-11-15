// The runbook judgement (03 REQ-3.7, D-21, D-55), shared by the `runbook` check rule, `build pr` and
// `slicekit release`: a slice that says `runbook: yes` changes a `##` section of the runbook, or its
// pull request body's Runbook line begins "no operational change".
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GitError, git } from './git.js';
import { headings, lines } from './markdown.js';
import { kitPaths } from './paths.js';
import { getSection } from './prbody.js';

export const NO_CHANGE = 'no operational change';

// The runbook's POSIX path relative to the root: `runbook.md` when `docsRoot` is `.`.
export function runbookRel(root, cfg) {
  return path.relative(root, kitPaths(root, cfg).runbook).split(path.sep).join('/');
}

const resolves = (root, ref) => {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

// The default branch as origin has it, else the local one.
export function defaultRef(root, cfg) {
  const origin = `refs/remotes/origin/${cfg.defaultBranch}`;
  return resolves(root, origin) ? origin : `refs/heads/${cfg.defaultBranch}`;
}

// The commit `tip` left the default branch at.
export function mergeBase(root, cfg, tip = 'HEAD') {
  return git(root, ['merge-base', tip, defaultRef(root, cfg)]);
}

// The file at `rev`, byte for byte (git() trims, which would move every line number of a file that
// begins with a blank line); '' when the commit does not hold it.
function fileAt(root, rev, rel) {
  try {
    return execFileSync('git', ['show', `${rev}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return '';
  }
}

// line number (1-based) -> the text of the `##` heading whose section holds it, or null above the
// first one. A heading line belongs to its own section; a fenced `## ` line is not a heading.
function sectionFinder(text) {
  const hs = headings(text).filter((h) => h.level === 2);
  return (n) => {
    let found = null;
    for (const h of hs) {
      if (h.line > n) break;
      found = h.text;
    }
    return found;
  };
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// The `##` headings of the runbook whose section holds a line added or removed between `base` and
// `tip`, sorted and unique. Removed lines are placed with the base's file, added lines with the
// tip's. A change of trailing whitespace only is no change (D-55).
export function runbookSections(root, rel, base, tip) {
  const diff = git(root, ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-renames', '--unified=0', '--ignore-space-at-eol', base, tip, '--', rel]);
  if (diff === '') return [];
  const inBase = sectionFinder(fileAt(root, base, rel));
  const inTip = sectionFinder(fileAt(root, tip, rel));
  const found = new Set();
  const mark = (finder, start, count) => {
    for (let n = start; n < start + count; n++) {
      const s = finder(n);
      if (s !== null) found.add(s);
    }
  };
  for (const line of lines(diff)) {
    const m = HUNK.exec(line);
    if (!m) continue;
    mark(inBase, Number(m[1]), m[2] === undefined ? 1 : Number(m[2]));
    mark(inTip, Number(m[3]), m[4] === undefined ? 1 : Number(m[4]));
  }
  return [...found].sort();
}

// null when the slice passes, else the finding's message. `body` is a pull request body, or null
// when there is none to read; then only the flag and the changed sections count.
export function runbookVerdict({ flag, sections, body, rel }) {
  if (!flag) return null;
  if (sections.length > 0) return null;
  if (typeof body === 'string' && (getSection(body, 'Runbook') ?? '').trim().startsWith(NO_CHANGE)) return null;
  return `runbook: the slice says runbook: yes, ${rel} changed no section, and the Runbook line does not begin "${NO_CHANGE}"`;
}
