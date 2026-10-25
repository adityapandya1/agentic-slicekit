// `spec verify` (REQ-2.3): what the spec stands on before it goes to review. The earlier stages are
// done, every REQ cites a decision row or an intake file that exists, and every interface named at
// intake has a contract. A `[NEEDS CLARIFICATION: …]` marker is listed, never a finding: specify
// may leave one, plan refuses it.
import fs from 'node:fs';
import path from 'node:path';
import { exists, listFiles, readText } from './fs.js';
import { readDecisions } from './decisions.js';
import { prose } from './markdown.js';
import { kitPaths } from './paths.js';
import { programStage, reqBlocks } from './stage.js';

const posix = (p) => p.split(path.sep).join('/');
const LIST = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const DECISION = /^D-\d+$/;
const MARKER = /\[NEEDS CLARIFICATION:[^\]]*\]/g;

const mdFiles = (dir) => (exists(dir) ? listFiles(dir, { ext: '.md' }).map((f) => path.join(dir, f)) : []);

// The tokens of every `Cites:` entry in a REQ block, with the lines wrapped under each entry
// (indented, not a list item, carrying no `Key:`), stripped of markdown punctuation and of a
// `:<line>` or `#L<line>` suffix.
function citedTokens(block) {
  const ls = block.split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (let i = 0; i < ls.length; i++) {
    if (/^\s*(```|~~~)/.test(ls[i])) inFence = !inFence;
    if (inFence || !ls[i].replace(LIST, '').startsWith('Cites:')) continue;
    const parts = [ls[i].replace(LIST, '').slice('Cites:'.length)];
    while (i + 1 < ls.length && /^\s+\S/.test(ls[i + 1]) && !LIST_ITEM.test(ls[i + 1]) && !/^\s*[A-Z][\w ]*:/.test(ls[i + 1])) {
      parts.push(ls[++i]);
    }
    for (const t of parts.join(' ').split(/[\s,;]+/)) {
      const token = t
        .replace(/^[`'"([*_]+/, '')
        .replace(/[`'")\]*_.:]+$/, '')
        .replace(/(?::\d+|#L\d+(?:-L?\d+)?)$/, '');
      if (token !== '') out.push(token);
    }
  }
  return out;
}

const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
const inside = (dir, p) => {
  const r = path.relative(dir, p);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
};

// Each REQ whose `Cites:` entries name no D row present in decisions.md and no file that exists
// under `<docsRoot>/intake/`. A path resolves against the spec file's directory, then the root.
export function unsupportedReqs(root, cfg) {
  const p = kitPaths(root, cfg);
  const ids = new Set(exists(p.decisions) ? readDecisions(readText(p.decisions)).rows.map((r) => r.id) : []);
  const intakeFile = (file, token) =>
    [path.resolve(path.dirname(path.join(root, file)), token), path.resolve(root, token)].some(
      (abs) => inside(p.intake, abs) && isFile(abs) && !abs.endsWith('.meta.json'),
    );
  return reqBlocks(root, cfg)
    .filter(({ file, block }) => !citedTokens(block).some((t) => (DECISION.test(t) ? ids.has(t) : intakeFile(file, t))))
    .map(({ id, file, line }) => ({ req: id, file, line }));
}

// Every `[NEEDS CLARIFICATION: …]` marker in the spec, outside fenced blocks.
function markers(root, cfg) {
  const out = [];
  for (const f of mdFiles(kitPaths(root, cfg).spec)) {
    const file = posix(path.relative(root, f));
    for (const [l, line] of prose(readText(f))) for (const m of l.matchAll(MARKER)) out.push({ file, line, text: m[0] });
  }
  return out;
}

export function verifySpec(root, cfg) {
  const findings = [];
  const now = programStage(root, cfg, { upTo: 'specify' });
  if (!now.complete && now.stage !== 'specify') {
    for (const b of now.blockers) findings.push({ file: '-', line: 0, message: `${now.stage} not done: ${b}` });
  }
  for (const r of unsupportedReqs(root, cfg)) {
    findings.push({ file: r.file, line: r.line, message: `${r.req} cites nothing that exists; write [NEEDS CLARIFICATION: <question>] instead of a guess` });
  }
  const found = markers(root, cfg);
  return {
    findings,
    counts: { reqs: reqBlocks(root, cfg).length, contracts: mdFiles(kitPaths(root, cfg).contracts).length, markers: found.length },
    markers: found,
  };
}
