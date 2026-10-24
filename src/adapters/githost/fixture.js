import fs from 'node:fs';
import path from 'node:path';
import { GitHostError, GitHostNotFound } from './errors.js';
import { assertDate, assertSha } from '../../evidence.js';
import { assertPrNumber, filterMergedSince, mapPullRequest, reduceRuns } from './gh-json.js';

// The test seam for C-1 (05 REQ-5.2): a directory of gh-shaped JSON files.
//   pr-<n>.json          what `gh pr view <n> --json ...` prints
//   merged-since.json    what `gh pr list --state merged --json ...` prints (an array)
//   ci-<sha>.json        what `gh run list --commit <sha> --json ...` prints (an array)
// A missing file is what the real host says for "not there"; an unreadable one is a host failure.
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw new GitHostError(`git host fixture ${file}: ${e.message}`);
  }
}

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
  };
}
