---
slice: P3/S-18
name: Queries
repo: .
group: B
runbook: no
requirements: [REQ-4.5, REQ-4.3]
decisions: [D-11, D-13, D-46]
---

## Done when

1. `slicekit trace <REQ>` prints the requirement's `nodeLine`, then as a tree each slice that implements it with its pull requests and its commits newest first, each commit with the files it touched, then each test that covers it with the line; `slicekit trace --file <path>` prints the file, then each slice whose commits touched it with the requirements it implements and the decisions that slice or those requirements cite (REQ-4.5).
2. `slicekit history <path> [<path>…]` prints one line per slice whose commits touched a path (a directory matches every file under it), newest first by that slice's newest such commit, as `<slice>  PR #<n>  <verdict>  released <P>` or `unreleased`, with `no pull request` and `no verdict` when there is none; commits in no slice are not listed (REQ-4.5's scenario).
3. `slicekit uncovered` prints three counted sections, `requirements with no covering test`, `tests naming no requirement` and `commits on <default> with no slice trailer` (merge commits left out); `slicekit shipped P<n>` prints the release record's path, its requirements and its pull requests with their URLs, and exits 1 with `P<n> has no release record` when there is none (REQ-4.5).
4. Each of the four takes `--json` and prints one JSON document; an unknown ID or path exits 2 with `<what> is not in the graph`; trace, trace --file, history, uncovered, shipped and `status --json` each answer in under two seconds on the 10,000-commit fixture. `status` is P1/S-03's command and already meets REQ-4.5's status row (`--json`, `--sync`, `--write`); this slice only times it (REQ-4.5).
5. On a slice branch, `slicekit check` reports `<file>:1 test file names no requirement (REQ-4.3)` for each file the branch adds or modifies whose path matches `testFiles` and whose content at the branch tip holds no REQ ID; deleted files and the default branch are not judged; under `--ci` the pull request's head is judged, as the trailer rule judges it (REQ-4.3, D-11).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `graph/queries.test.js » trace prints the slices, tests, commits, pull requests and files under a requirement as a tree` | happy | REQ-4.5 |
| `graph/queries.test.js » trace --file prints the requirements, decisions and slices above a file` | happy | REQ-4.5 |
| `graph/queries.test.js » history lists the slices that touched a path, newest first, with verdict and release` | happy | REQ-4.5 |
| `graph/queries.test.js » uncovered lists requirements with no test, tests naming no requirement and commits with no slice trailer` | happy | REQ-4.5 |
| `graph/queries.test.js » shipped lists the requirements and pull requests of a release with links` | happy | REQ-4.5 |
| `graph/queries.test.js » each query prints one JSON document with --json` | happy | REQ-4.5 |
| `graph/queries.test.js » a requirement or path not in the graph exits 2 naming it` | negative | REQ-4.5 |
| `graph/queries.test.js » shipped for a phase with no release record is refused` | negative | REQ-4.5 |
| `graph/queries.test.js » a path written with backslashes or a leading ./ finds the same file` | negative | REQ-4.5 |
| `graph/queries-perf.test.js » each query answers in under two seconds on a 10,000-commit repository` | happy | REQ-4.5 |
| `check/citations.test.js » a new test file on a slice branch naming no requirement is a finding` | negative | REQ-4.3 |
| `check/citations.test.js » a changed test file that names a requirement is not a finding` | happy | REQ-4.3 |
| `check/citations.test.js » test files are not judged on the default branch or when deleted` | negative | REQ-4.3 |

## Expected changes

`src/graph/{trace,history,uncovered,shipped}.js`, `src/cli/{trace,history,uncovered,shipped}.js`, `src/cli/index.js`, `src/check/rules/citations.js`, `src/check/rules/trailer.js`, `src/check/ci-event.js`, tests.

## Tasks

### Task 1: `trace`

**Files:** Create `src/graph/trace.js`, `src/cli/trace.js`, `test/graph/queries.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes (S-17): `queryCommand` (the query shell), `indexGraph` and its `find`, `nodeLine`, `renderTree`, `GraphError`; `graphRepo` and the fixture host from the graph fixture helper.
- In `trace.js`: `traceRequirement(index, id) → {node, children}`: children are each slice with an `implements` edge to it (slice order), each slice's children its pull requests (`in` edges into the slice) then its commits (`in` edges into the slice, newest `date` first, then SHA), each commit's children its `touched` files (path order); after the slices, each test with a `covers` edge to it, labelled `test <path>:<line>` from the edge's `at`. `traceFile(index, path) → {node, children}`: the file's commits (`touched` edges into it) give their slices, each listed once (slice order); under each slice the requirements it implements and the decisions it cites, and under each requirement the decisions it cites.
- CLI `trace <REQ-…>` or `trace --file <path>`, each with `--json`; both or neither → exit 2 with the usage. `--json` prints the tree as `{id, kind, label, from, at?, children}`.

- [ ] **Step 1: Failing tests** — a repository from `graphRepo()`, `graph` run once. `trace prints the slices, tests, commits, pull requests and files under a requirement as a tree`: `trace REQ-1.3` → the first line is `requirement REQ-1.3 <title>`; a line `  slice P1/S-01 <name> (merged)`, under it `    pull request #1 <url>` and `    commit <sha7> <subject>`, under that `      file src/a.js`; a line `  test test/a.test.js:3`. `trace --file prints the requirements, decisions and slices above a file`: `trace --file src/a.js` → `file src/a.js`, `  slice P1/S-01 …`, `    requirement REQ-1.3 …`, `      decision D-1`. `a requirement or path not in the graph exits 2 naming it`: `trace REQ-9.9` → exit 2, stderr `slicekit: REQ-9.9 is not in the graph`; `trace --file nope.js` → exit 2 naming `nope.js`. `a path written with backslashes or a leading ./ finds the same file`: `trace --file src\a.js` and `trace --file ./src/a.js` print what `trace --file src/a.js` prints. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/graph/queries.test.js` → FAIL.
- [ ] **Step 3: Implement**; register `trace` in the command table.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(trace): the tree under a requirement and above a file`.

### Task 2: `history`

**Files:** Create `src/graph/history.js`, `src/cli/history.js`. Modify `src/cli/index.js`, `test/graph/queries.test.js`.

**Interfaces:**
- In `history.js`: `history(index, paths) → [{slice, pr, verdict, release, sha, date}]`. A path matches the file node of that path and every file node under it as a directory (`<p>/` prefix). For each slice reached from those files through `touched` then `in`, `sha` and `date` are its newest commit that touched a matching path; `pr` the number of its pull request (`in` into the slice; the highest number when several), else `null`; `verdict` the `verdict` attribute of its verdict with the highest round, else `null`; `release` the release its pull request is `released-in`, else `null`. Sorted by `date` descending, then `sha`. Any path that matches no file node → `GraphError` code 2 `<path> is not in the graph`.
- CLI `history <path> [<path>…] [--json]`: one line per entry, `<slice>  PR #<n>  <verdict>  released <P>`, with `no pull request`, `no verdict` and `unreleased` in place of the missing parts; no path → exit 2 with the usage.

- [ ] **Step 1: Failing test** — `history lists the slices that touched a path, newest first, with verdict and release`: a repository written in the test with `makeRepo`: slices P1/S-03 and P1/S-07 whose commits touch `src/billing/a.js`, S-03's commit the newer; state files naming PR 14 and PR 21; verdict files `P1-S-03-r1.md` and `P1-S-07-r1.md`, both `Verdict: APPROVE`; a release record P1 naming #14; the fixture host with `pr-14.json` and `pr-21.json`; one commit in no slice touching `src/billing/b.js`. `history src/billing` → exactly two lines, `P1/S-03  PR #14  APPROVE  released P1` then `P1/S-07  PR #21  APPROVE  unreleased`. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/graph/queries.test.js` → FAIL.
- [ ] **Step 3: Implement**; register `history`.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(history): the slices and pull requests that touched a path`.

### Task 3: `uncovered` and `shipped`

**Files:** Create `src/graph/uncovered.js`, `src/graph/shipped.js`, `src/cli/uncovered.js`, `src/cli/shipped.js`. Modify `src/cli/index.js`, `test/graph/queries.test.js`.

**Interfaces:**
- In `uncovered.js`: `uncovered(index) → {requirements, tests, commits}`: requirements with no `covers` edge into them (id order); test nodes with no `covers` edge out (path order); commit nodes with `default: true`, `merge: false` and no `in` edge to a slice (newest first).
- In `shipped.js`: `shipped(index, phase) → {release, requirements, pullRequests}`: the release node `release:<phase>` (none → `GraphError` code 1 `<phase> has no release record`; a phase that is not a phase node → code 2 `<phase> is not in the graph`); its pull requests are those `released-in` it (number order); its requirements those the pull requests' slices implement (id order).
- CLI `uncovered [--json]` prints `requirements with no covering test: <n>`, `tests naming no requirement: <n>` and `commits on <default> with no slice trailer: <n>`, each followed by its items indented two spaces (`nodeLine`, and the source for requirements). CLI `shipped P<n> [--json]` prints `<phase> <release record path>`, `requirements: <n>` with each `REQ-… <title>  <from>`, then `pull requests: <n>` with each `#<n> <title> <url>`.

- [ ] **Step 1: Failing tests** — `uncovered lists requirements with no test, tests naming no requirement and commits with no slice trailer`: on `graphRepo()` plus a requirement no test names, a test file naming none and a commit on `main` without a trailer → each appears under its heading, and the merge commit does not. `shipped lists the requirements and pull requests of a release with links`: `shipped P1` → the release record's path, `REQ-1.3`, and `#1 <title> <url>`. `shipped for a phase with no release record is refused`: `shipped P2` with phase P2 planned and no record → exit 1 `P2 has no release record`. `each query prints one JSON document with --json`: trace, trace --file, history, uncovered and shipped with `--json` each print text that `JSON.parse` reads whole, and with an unknown ID print `{"error": …}` and exit 2.
- [ ] **Step 2: Run** `node --test test/graph/queries.test.js` → FAIL.
- [ ] **Step 3: Implement**; register `uncovered` and `shipped`.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(queries): uncovered and shipped`.

### Task 4: Two seconds on 10,000 commits

**Files:** Create `test/graph/queries-perf.test.js`.

**Interfaces:**
- Consumes (S-17): `bigRepo` from the graph fixture helper; `runCli` from `test/helpers/run-cli.js`.
- One `bigRepo()` and one `graph` in a `before`; then each of `trace REQ-1.1`, `trace --file src/f1.js`, `history src`, `uncovered`, `shipped P1` (the fixture gains a release record in this test) and `status --json` runs through `runCli`, its wall time measured with `performance.now()` around the spawn, Node's start included.

- [ ] **Step 1: Failing test** — `each query answers in under two seconds on a 10,000-commit repository`: each command exits 0 within 2,000 ms; the failure message names the command and its time.
- [ ] **Step 2: Run** `node --test test/graph/queries-perf.test.js` → FAIL until Tasks 1 to 3 are in, then PASS. A miss is fixed in the query, never by a larger budget.
- [ ] **Step 3: Commit** `test(queries): two seconds on a 10,000-commit repository`.

### Task 5: Test files name a requirement (`check`)

**Files:** Modify `src/check/ci-event.js`, `src/check/rules/trailer.js`, `src/check/rules/citations.js`, `test/check/citations.test.js`, `test/check/trailer.test.js`.

**Interfaces:**
- Consumes (S-17): `isTestFile`, `reqMentions` from the graph's test-file module.
- `branchTip(ctx) → {branch, tip} | null` moves into `ci-event.js` from the trailer rule, unchanged: under `--ci` on a pull request the branch is `GITHUB_HEAD_REF` and the tip the event's head SHA, else the current branch and `HEAD`. The trailer rule imports it; its tests pass unchanged.
- In the citations rule: `testFileFindings(ctx) → finding[]`. Only when `branchTip` gives a branch for which `sliceFromBranch` is a slice. The base is the merge base of the tip with `refs/heads/<default>`, else `refs/remotes/origin/<default>`; neither → no findings. Files from `git diff -z --name-status --no-renames <base> <tip>` with status `A` or `M` and `isTestFile` true; content from `git show <tip>:<path>`; no `reqMentions` → `{file: <path>, line: 1, message: 'test file names no requirement (REQ-4.3)'}`. `run` adds these findings to the rule's own.

- [ ] **Step 1: Failing tests** — `a new test file on a slice branch naming no requirement is a finding`: on `slice/P1-S-01-x`, a committed `test/b.test.js` with no REQ ID → one citations finding `test/b.test.js:1 test file names no requirement (REQ-4.3)`. `a changed test file that names a requirement is not a finding`: the same file with a comment naming REQ-1.1 → none. `test files are not judged on the default branch or when deleted`: the first file on `main` → none; on a slice branch that deletes it → none; `src/b.js` with no REQ ID → none. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/check/citations.test.js test/check/trailer.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`; this branch's own new test files name REQ-4.5 or REQ-4.3.
- [ ] **Step 5: Commit** `feat(check): a test file on a slice branch names a requirement`.
