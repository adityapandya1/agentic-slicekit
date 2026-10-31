// workspace (04 REQ-4.6's Enforced by, D-47, D-48): a slice file's `repo:` is `.` or names an entry
// of the workspace file; a contract names at least one producer and one consumer. A party that is a
// slice is named by its address; one outside the program is named in words, so any text will do.
import path from 'node:path';
import { keyedText, partyOf } from '../../graph/docs.js';
import { GraphError } from '../../graph/schema.js';
import { readWorkspace, workspaceRel } from '../../graph/workspace.js';
import { re } from '../../ids.js';
import { frontMatter } from '../../markdown.js';
import { findSliceFiles } from '../../slicefile.js';

export const id = 'workspace';
export const blocking = true;
export const ratchet = false;

const toPosix = (p) => p.split(path.sep).join('/');
const SLICE = new RegExp(`^${re('sliceAddr').source}$`);

// The 1-based line of the front-matter key `repo:`, or 1.
function repoLine(text) {
  const ls = String(text).replace(/\r\n/g, '\n').split('\n');
  if (ls[0]?.replace(/^﻿/, '') !== '---') return 1;
  for (let i = 1; i < ls.length && ls[i] !== '---'; i++) if (/^repo:/.test(ls[i])) return i + 1;
  return 1;
}

function slices(ctx) {
  const rel = workspaceRel(ctx.root, ctx.cfg);
  let workspace;
  try {
    workspace = readWorkspace(ctx.root, ctx.cfg);
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    return [{ file: rel, line: 1, message: e.message }];
  }
  const names = new Set((workspace?.repos ?? []).map((r) => r.name));
  const byRel = new Map(ctx.docs.map((d) => [d.rel, d]));
  const out = [];
  for (const f of findSliceFiles(ctx.root, ctx.cfg)) {
    const file = toPosix(path.relative(ctx.root, f.path));
    const text = byRel.get(file)?.text;
    if (text === undefined) continue;
    // Only the two keys are read, so a slice file malformed elsewhere (the citations rule's to report)
    // is still judged on its repo.
    let data;
    try {
      data = frontMatter(text).data ?? {};
    } catch {
      continue;
    }
    const s = { id: String(data.slice ?? ''), repo: data.repo };
    if (!SLICE.test(s.id) || typeof s.repo !== 'string' || s.repo === '') continue;
    if (s.repo === '.' || names.has(s.repo)) continue;
    const why = workspace ? `, which ${rel} does not list` : '; there is no workspace file';
    out.push({ file, line: repoLine(text), message: `slice ${s.id} names repo ${s.repo}${why}` });
  }
  return out;
}

const CONTRACT = new RegExp(`^(${re('contract').source})-.*\\.md$`);
// Text that names someone: anything but spaces and punctuation.
const namesSomeone = (text) => /[\p{L}\p{N}]/u.test(text);

function contracts(ctx) {
  const dir = toPosix(path.relative(ctx.root, ctx.paths.contracts));
  const out = [];
  for (const doc of ctx.docs) {
    if (path.posix.dirname(doc.rel) !== dir) continue;
    const m = CONTRACT.exec(path.posix.basename(doc.rel));
    if (!m) continue;
    const said = { produces: false, consumes: false };
    for (const seg of keyedText(doc.text)) {
      const kind = partyOf(seg.key);
      if (kind && namesSomeone(seg.text)) said[kind] = true;
    }
    if (!said.produces) out.push({ file: doc.rel, line: 1, message: `${m[1]} names no producer` });
    if (!said.consumes) out.push({ file: doc.rel, line: 1, message: `${m[1]} names no consumer` });
  }
  return out;
}

export function run(ctx) {
  return [...slices(ctx), ...contracts(ctx)];
}

export default { id, blocking, ratchet, run };
