import fs from 'node:fs';
import path from 'node:path';
import { GitHostError, GitHostNotFound } from './errors.js';
import { assertDate, assertSha } from '../../evidence.js';
import { redact } from '../../redact.js';
import {
  assertBranch,
  assertLabel,
  assertLabelColor,
  assertPrNumber,
  assertTitle,
  decidedSlicekitRun,
  filterMergedSince,
  mapBranchRules,
  mapJobs,
  mapPullRequest,
  pickBranchPullRequest,
  reduceRuns,
  RULESET_NAME,
  rulesetRules,
} from './gh-json.js';

// The test seam for C-1 (05 REQ-5.2): a directory of gh-shaped JSON files.
//   pr-<n>.json          what `gh pr view <n> --json ...` prints
//   merged-since.json    what `gh pr list --state merged --json ...` prints (an array)
//   ci-<sha>.json        what `gh run list --commit <sha> --json ...` prints (an array)
//   jobs-<id>.json       what `gh run view <id> --json jobs` prints, for slicekitRun
//   label-error.txt, label-create-error.txt   gh refusing `pr edit`, `label create`
//   label-calls.jsonl    written: one line per label call, in order
//   pr-create-error.txt  gh refusing `pr create`
//   pr-calls.jsonl       written: `{op, ...input}` per pull request write (open, update, ready, draft)
//   branch-rules-<branch>.json   what `gh api repos/{o}/{r}/rules/branches/<branch>` prints (an array,
//                        `[]` for no rules; missing: the rules cannot be read); `/` is written `%2F`
//   branch-<branch>.json what `gh api repos/{o}/{r}/branches/<branch>` prints (missing: no classic protection)
//   branch-rules-error.txt   gh refusing the rules read (no token, no network)
//   codeowners.json      `{path, text}`, the CODEOWNERS file GitHub reads (missing: none)
//   ruleset-apply-error.txt  gh refusing the ruleset write
//   ruleset-calls.jsonl  written: `{branch, rules}` per ruleset write; the rules are also added to
//                        branch-rules-<branch>.json, so a later read sees them
// openPullRequest writes pr-<n>.json (n one above the highest there, else 1); updatePullRequestBody,
// markReady and markDraft rewrite it, so a later getPullRequest or pullRequestForBranch sees the change.
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
  if (refusal !== undefined) throw new GitHostError(`${call} failed: ${redact(refusal)}`, { stderr: refusal });
}

const record = (dir, call) => fs.appendFileSync(path.join(dir, 'label-calls.jsonl'), `${JSON.stringify(call)}\n`);
const recordPr = (dir, call) => fs.appendFileSync(path.join(dir, 'pr-calls.jsonl'), `${JSON.stringify(call)}\n`);

// The numbers of the pull requests the fixture holds, ascending.
function prNumbers(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    throw new GitHostError(`git host fixture ${dir}: ${e.message}`);
  }
  return names
    .map((n) => /^pr-(\d+)\.json$/.exec(n)?.[1])
    .filter((n) => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

const prFile = (dir, n) => path.join(dir, `pr-${n}.json`);
const writePr = (dir, raw) => fs.writeFileSync(prFile(dir, raw.number), `${JSON.stringify(raw, null, 2)}\n`);
function readPr(dir, n) {
  const raw = readJson(prFile(dir, n));
  if (raw === undefined) throw new GitHostNotFound(`pull request ${n} not found`);
  return raw;
}

const branchFile = (dir, kind, branch) => path.join(dir, `${kind}-${branch.replace(/\//g, '%2F')}.json`);

export function fixtureHost(dir) {
  return {
    kind: 'fixture',
    readBranchRules(branch) {
      assertBranch(branch);
      refuse(dir, 'branch-rules-error.txt', 'gh api');
      const rules = readJson(branchFile(dir, 'branch-rules', branch));
      if (rules === undefined) throw new GitHostError(`git host fixture ${dir}: no branch-rules-${branch}.json`);
      return mapBranchRules(rules, readJson(branchFile(dir, 'branch', branch)) ?? null);
    },
    readCodeowners() {
      const got = readJson(path.join(dir, 'codeowners.json'));
      if (got === undefined) return null;
      if (typeof got?.path !== 'string' || typeof got?.text !== 'string') throw new GitHostError('git host fixture codeowners.json: needs {path, text}');
      return { path: got.path, text: got.text };
    },
    applyBranchRules(branch, rules) {
      assertBranch(branch);
      refuse(dir, 'ruleset-apply-error.txt', 'gh api');
      fs.appendFileSync(path.join(dir, 'ruleset-calls.jsonl'), `${JSON.stringify({ branch, rules })}
`);
      const file = branchFile(dir, 'branch-rules', branch);
      const now = readJson(file) ?? [];
      const added = rulesetRules(rules).map((r) => ({ ...r, ruleset_source_type: 'Repository', ruleset_source: 'fixture', ruleset_id: RULESET_NAME }));
      fs.writeFileSync(file, `${JSON.stringify([...now, ...added], null, 2)}
`);
      return { id: null, name: RULESET_NAME, created: true };
    },
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
    // As the GitHub host (decidedSlicekitRun): ci-<sha>.json narrowed to the slicekit workflow's
    // pull_request runs, each completed one's jobs read from jobs-<databaseId>.json (none when the file
    // is missing), newest first until one is decided.
    slicekitRun(sha) {
      assertSha(sha);
      return decidedSlicekitRun(readJson(path.join(dir, `ci-${sha}.json`)) ?? [], (run) => {
        if (!Number.isInteger(run.databaseId)) throw new GitHostError('git host fixture: a slicekit run with no databaseId');
        return mapJobs(readJson(path.join(dir, `jobs-${run.databaseId}.json`)));
      });
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
    openPullRequest({ branch, base, title, body, draft }) {
      assertBranch(branch);
      assertBranch(base);
      assertTitle(title);
      refuse(dir, 'pr-create-error.txt', 'gh pr create');
      const number = (prNumbers(dir).at(-1) ?? 0) + 1;
      const url = `https://example.test/pull/${number}`;
      const isDraft = Boolean(draft);
      const text = String(body ?? '');
      writePr(dir, { number, url, state: 'OPEN', isDraft, headRefName: branch, baseRefName: base, title, body: text, headRefOid: null, labels: [] });
      recordPr(dir, { op: 'openPullRequest', branch, base, title, body: text, draft: isDraft });
      return { number, url };
    },
    updatePullRequestBody(n, body) {
      assertPrNumber(n);
      const raw = readPr(dir, n);
      const text = String(body ?? '');
      writePr(dir, { ...raw, body: text });
      recordPr(dir, { op: 'updatePullRequestBody', number: n, body: text });
    },
    markReady(n) {
      assertPrNumber(n);
      const raw = readPr(dir, n);
      writePr(dir, { ...raw, isDraft: false });
      recordPr(dir, { op: 'markReady', number: n });
    },
    markDraft(n) {
      assertPrNumber(n);
      const raw = readPr(dir, n);
      writePr(dir, { ...raw, isDraft: true });
      recordPr(dir, { op: 'markDraft', number: n });
    },
    // As the GitHub host: the open pull requests with that head, a fork's (isCrossRepository) dropped.
    pullRequestForBranch(branch, { base } = {}) {
      assertBranch(branch);
      const open = prNumbers(dir)
        .map((n) => readJson(prFile(dir, n)))
        .filter((raw) => raw?.state === 'OPEN');
      return pickBranchPullRequest(open, branch, base);
    },
  };
}
