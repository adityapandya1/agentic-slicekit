import fs from 'node:fs';
import path from 'node:path';
import { GitHostError, GitHostNotFound } from './errors.js';
import { assertDate, assertSha } from '../../evidence.js';
import { assertLabel, assertLabelColor, assertPrNumber, filterMergedSince, mapPullRequest, reduceRuns } from './gh-json.js';

// The test seam for C-1 (05 REQ-5.2): a directory of gh-shaped JSON files.
//   pr-<n>.json          what `gh pr view <n> --json ...` prints
//   merged-since.json    what `gh pr list --state merged --json ...` prints (an array)
//   ci-<sha>.json        what `gh run list --commit <sha> --json ...` prints (an array)
//   label-error.txt, label-create-error.txt   gh refusing `pr edit`, `label create`
//   label-calls.jsonl    written: one line per label call, in order
// A missing file is what the real host says for "not there"; an unreadable one is a host failure.
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw new GitHostError(`git host fixture ${file}: ${e.message}`);
  }
}

// Throws what gh would when the fixture holds a refusal for this call.
function refuse(dir, file, call) {
  let refusal;
  try {
    refusal = fs.readFileSync(path.join(dir, file), 'utf8').trim();
  } catch (e) {
    if (e.code !== 'ENOENT') throw new GitHostError(`git host fixture ${dir}: ${e.message}`);
  }
  if (refusal !== undefined) throw new GitHostError(`${call} failed: ${refusal}`, { stderr: refusal });
}

const record = (dir, call) => fs.appendFileSync(path.join(dir, 'label-calls.jsonl'), `${JSON.stringify(call)}\n`);

export function fixtureHost(dir) {
  return {
    kind: 'fixture',
    getPullRequest(n) {
      assertPrNumber(n);
      const raw = readJson(path.join(dir, `pr-${n}.json`));
      if (raw === undefined) throw new GitHostNotFound(`pull request ${n} not found`);
      return mapPullRequest(raw);
    },
    listMergedSince(isoDate) {
      const since = assertDate(isoDate);
      return filterMergedSince(readJson(path.join(dir, 'merged-since.json')) ?? [], since);
    },
    ciStatus(sha) {
      assertSha(sha);
      return reduceRuns(readJson(path.join(dir, `ci-${sha}.json`)) ?? []);
    },
    setLabel(n, name, present) {
      assertPrNumber(n);
      assertLabel(name);
      refuse(dir, 'label-error.txt', 'gh pr edit');
      record(dir, { number: n, name, present: Boolean(present) });
    },
    ensureLabel(name, { color, description }) {
      assertLabel(name);
      assertLabelColor(color);
      assertLabel(description);
      refuse(dir, 'label-create-error.txt', 'gh label create');
      record(dir, { create: name, color, description });
    },
  };
}
