---
slice: P3/S-17
name: Graph builder
repo: .
group: A
runbook: no
requirements: [REQ-4.1, REQ-4.2, REQ-4.3, REQ-4.4, REQ-4.8]
decisions: [D-04, D-11, D-13, D-23, D-44, D-45, D-46]
---

## Done when

1. `slicekit graph` writes graph.json under the graph directory with `schemaVersion` 1, `builtAt` (the committer date of `sha`), `defaultBranch`, `sha`, `repos`, `nodes` and `edges`; every node kind of REQ-4.1 plus `verdict` and every edge kind appears on the fixture repository, each node with its `from` and each edge with its `at`; a graph that fails `validateGraph` is not written and the command exits 1 with `graph: schema: <first problem>` (REQ-4.1).
2. A file whose path matches `testFiles` gets a `test` node, and each of its lines holding a known REQ ID a `covers` edge at `<path>:<line>`; no other non-markdown file is opened, so a repository of Java sources gains no node or edge from them (REQ-4.3, REQ-4.8).
3. A second run walks only the commits after the recorded tips and reads only files whose hash changed, printing `commits walked 1 of <n>` after one new commit; the result is byte-identical to `graph --full`, also after a slice branch is deleted; `git status --porcelain` lists nothing under the graph directory; the gate job of the workflow template runs `graph` before it uploads the graph (REQ-4.4, D-23).
4. Pull requests are fetched once each through `getHost` and cached under the graph directory; with `gh` missing and no cache the build writes every other node and prints `pull requests skipped: gh not found`; with the host failing it uses the cache and marks each pull request it could not refresh `stale: true` (REQ-4.2).
5. `loadGraph`, `indexGraph`, `nodeLine`, `renderTree` and `queryCommand` exist for S-18, S-19 and S-20; a full build of the 10,000-commit fixture finishes in under 30 seconds; the README's scope line says the graph is built and is not a code graph (REQ-4.8).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `graph/build.test.js » every node kind and edge kind on the fixture repository` | happy | REQ-4.1 |
| `graph/build.test.js » a slice naming a requirement gets an implements edge with the slice file's path and line` | happy | REQ-4.1 |
| `graph/build.test.js » an edge between kinds the schema does not allow is refused and graph.json is not written` | negative | REQ-4.1 |
| `graph/build.test.js » a doc naming an ID that is not in the graph drops the edge with a warning` | negative | REQ-4.1 |
| `graph/build.test.js » a test naming a requirement gets a covers edge with its file and line` | happy | REQ-4.3 |
| `graph/build.test.js » Java sources produce no node or edge` | negative | REQ-4.8 |
| `graph/build.test.js » a second run walks only the new commit and leaves git status clean` | happy | REQ-4.4 |
| `graph/build.test.js » an incremental build is byte-identical to a full build, after a new commit and a deleted branch` | happy | REQ-4.4 |
| `graph/build.test.js » two full builds from the same inputs are byte-identical` | happy | REQ-4.4 |
| `graph/build.test.js » pull requests are fetched once and then read from the cache` | happy | REQ-4.2 |
| `graph/build.test.js » with gh not found the build skips pull requests and says so` | negative | REQ-4.2 |
| `graph/build.test.js » with the host unreachable pull requests come from the cache marked stale` | negative | REQ-4.2 |
| `graph/build.test.js » a query with no graph built says to run slicekit graph` | negative | REQ-4.4 |
| `graph/perf.test.js » a 10,000-commit repository builds in under thirty seconds` | happy | REQ-4.4 |
| `workflow.test.js » the gate builds the graph before uploading it` | happy | REQ-4.4 |
| `readme.test.js » the scope line says the graph is built from IDs and git and is not a code graph` | happy | REQ-4.8 |

## Expected changes

`src/graph/{schema,tests,docs,kitfiles,git-walk,prs,build,load,render}.js`, `src/cli/{graph,query}.js`, `src/cli/index.js`, `src/config.js`, `templates/workflow/slicekit.yml`, `.github/workflows/slicekit.yml`, `test/fixtures/golden/workflow/`, `README.md`, `test/helpers/graph-fixture.js`, tests.

## Tasks

### Task 1: The schema and the test-file matcher

**Files:** Create `src/graph/schema.js`, `src/graph/tests.js`, `test/graph/schema.test.js`. Modify `src/config.js`, `test/config.test.js`.

**Interfaces:**
- In `schema.js`: `SCHEMA_VERSION = 1`. `NODE_KINDS`: `intake, decision, requirement, gap, contract, phase, slice, test, commit, pull-request, file, release, runbook-section, repo, verdict`. `EDGE_KINDS`, kind → allowed `[fromKind, toKind]` pairs: `cites` requirement→decision, requirement→intake, slice→decision, gap→decision, gap→requirement, decision→decision, runbook-section→slice, runbook-section→requirement, runbook-section→decision; `covers` test→requirement; `implements` slice→requirement; `touched` commit→file; `in` commit→slice, slice→phase, file→repo, test→repo, pull-request→slice, verdict→slice; `reviewed-by` pull-request→verdict; `released-in` pull-request→release; `produces` and `consumes` slice→contract.
- `nodeId(kind, key) → '<kind>:<key>'`. Keys: intake the file name; decision `D-<n>`; requirement `REQ-<s>.<n>`; gap `G-<n>`; contract `C-<n>`; phase `P<n>`; slice `P<n>/S-<nn>`; test and file the POSIX path relative to the repository (a workspace repository's prefixed `<name>/`, S-20); commit the 40-hex SHA; pull-request the number (a workspace repository's `<name>#<n>`, S-20); release `P<n>`; runbook-section `<path>#<heading slug>`; repo the name, `.` for the program repository; verdict the file stem, `P<n>-S-<nn>[i]-r<k>`.
- `class GraphError extends Error` with `code` 1 or 2.
- `validateGraph(graph) → string[]`, empty when valid, in a stable order: `schemaVersion is <v>, not 1`; `node <id> has kind <k>, which is not a node kind`; `node <id> does not start with <kind>:`; `node <id> has no from`; `duplicate node <id>`; `edge <kind> from <a> to <b> has no at`; `edge kind <k> is not an edge kind`; `edge <kind> runs from <fromKind> to <toKind>, which <kind> does not allow`.
- `serializeGraph(graph) → string`: top-level keys in the order `schemaVersion, builtAt, defaultBranch, sha, repos, nodes, edges`; nodes sorted by `id`, edges by `from`, `kind`, `to`, `at`, by code-unit comparison; a node's keys `id, kind, label, from`, then its other keys sorted; an edge's `kind, from, to, at`; one node or edge per line, as `JSON.stringify` of that one object; the file ends with a newline.
- In `tests.js`: `DEFAULT_TEST_FILES` (proposed decision 3 of the phase file: three regular expression sources); `isTestFile(rel, cfg) → boolean` against `cfg.testFiles ?? DEFAULT_TEST_FILES`; `reqMentions(text) → [{req, line}]`, every `REQ-<s>.<n>` per line, 1-based lines counted on `\n` so a CRLF file numbers the same; `testFiles(repoRoot, cfg) → rel[]`, `git ls-files -z` filtered by `isTestFile`, sorted.
- `validateConfig` accepts an optional `testFiles`: an array of strings each compiling as a `RegExp`, else `testFiles[<i>]: <message>`. `defaultConfig` does not add it.

- [ ] **Step 1: Failing tests** — in the new schema test file: `validateGraph` on a graph with an `implements` edge from a commit to a requirement returns `edge implements runs from commit to requirement, which implements does not allow`; `serializeGraph` of the same graph with nodes and edges given in two orders gives one string; in `test/config.test.js`: `testFiles: ["("]` is refused naming `testFiles[0]`. `isTestFile` holds for `a.test.js`, `pkg/a_test.go`, `test_a.py`, `src/BillingTest.java` and not for `src/Billing.java` or `test/helpers/x.js`. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/graph/schema.test.js test/config.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(graph): the schema and which files are tests`.

### Task 2: Fragments from the docs, the kit's files and git

**Files:** Create `src/graph/docs.js`, `src/graph/kitfiles.js`, `src/graph/git-walk.js`, `test/helpers/graph-fixture.js`, `test/graph/build.test.js`.

**Interfaces:**
- Consumes: `kitPaths`; `readDecisions` from `src/decisions.js`; `parseSliceFile`, `parsePhaseFile`, `findSliceFiles`, `phaseOfDir` from `src/slicefile.js`; `citedRefs` from `src/check/rules/citations.js`; `headings`, `tables`, `prose` from `src/markdown.js`; `parseVerdict` from `src/verdict.js`; `parseLine` from `src/journal.js`; `verdictFilePattern`, `re` from `src/ids.js`; `git` from `src/git.js`.
- A fragment is `{nodes, edges}`; a node may be a patch, `{id, patch: true, …attributes}`, merged into the node of that id at assembly and dropped when there is none.
- In `docs.js`: `docFragment(root, cfg, rel, text) → fragment`, chosen by where `rel` sits: the decisions file (a `decision` per row at its line; `cites` decision→decision for each other `D-<n>` in the row); a spec file (a `requirement` per `##` or `###` REQ heading, label the heading's title; `cites` from its `Cites:` entries through `citedRefs`); the gaps file (a `gap` per row; `cites` to each `D-<n>` and REQ in the row); a contract file `C-<n>-*.md` (a `contract`, label the first heading; `produces` from each slice address in the `**Producer:**` text and `consumes` from each in the `**Consumers:**` or `**Consumer:**` text, each text running to the next `**<Key>:**` or blank line, at the line of the address); a phase file (a `phase`); a slice file (a `slice` with `name`, `group`, `repo`; `in` slice→phase and `implements` for each of `requirements` and `cites` for each of `decisions`, each at the line of that front-matter key); an intake file other than a sidecar (an `intake`); a release record `P<n>.md` (a `release`; its `#<n>` mentions are returned as `prRefs: [{number, at}]`); the runbook (a `runbook-section` per `##` heading; `cites` to each slice, REQ and D ID in the section).
- In `kitfiles.js`: `stateFragment(rel, text)`, a patch on the slice with `state`, `mergedAt` and `history: [{to, at}]`, plus `prRefs` with the pull request's number, its `headSha` as `key`, and `at` the line of `"number"`; `verdictFragment(rel, text)`, a `verdict` with `verdict`, `head`, `independent`, `round`, and `in` verdict→slice at `<rel>:1`; `journalFragment(rel, text)`, `cites` slice→decision for each line's `decisions=` with the line as `at`.
- In `git-walk.js`: `defaultRef(repoRoot, branch) → {ref, sha}`, `refs/heads/<branch>` else `refs/remotes/origin/<branch>`, else `GraphError` code 1 `the default branch <branch> is not present here; fetch it`; `refTips(repoRoot, branch) → [{ref, sha}]`, the default branch first, then `refs/heads/slice/*` and `refs/remotes/origin/slice/*` sorted; `walkCommits(repoRoot, {include, exclude}) → [{sha, parents, date, subject, slices, files}]`, one `git -c core.quotePath=false log --no-renames --name-only -z` with the Slice trailers read by git as the trailer rule does, merges listing no files; `reachable(repoRoot, shas) → Set<sha>` from `git rev-list`; `webUrl(repoRoot) → string | null`, the https form of an `origin` on GitHub (`git@github.com:o/r.git` and `https://github.com/o/r.git` both give `https://github.com/o/r`). <!-- slicekit:example -->
- `graphRepo() → {root, fixture, cleanup}` in the graph fixture helper: a repository built with `makeRepo` holding a spec, decisions, gaps, a contract naming a producer and a consumer slice, intake with its sidecar, a phase with two slices, state files (one with PR 1), a verdict file, a journal file, a release record naming #1, a runbook, `test/a.test.js` naming a REQ, a CRLF test file, `src/Billing.java` naming a REQ in a comment, commits with Slice trailers on `main` and one on a `slice/` branch, and a fixture host directory with `pr-1.json`. <!-- slicekit:example -->

- [ ] **Step 1: Failing tests** — `every node kind and edge kind on the fixture repository` (built in process through Task 3's `buildGraph` with the fixture host; this test is written now and passes after Task 3): the set of node kinds is all fifteen and of edge kinds all ten; every node has `from` and every edge `at`. `a slice naming a requirement gets an implements edge with the slice file's path and line`: the slice's `requirements: [REQ-1.3]` line is line 7 → an edge `implements` from `slice:P1/S-01` to `requirement:REQ-1.3` with `at` `docs/phases/P1-x/S-01-a.md:7`. `Java sources produce no node or edge`: no node's `from` and no edge's `at` names `src/Billing.java`. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/graph/build.test.js` → FAIL.
- [ ] **Step 3: Implement** the three modules and the fixture.
- [ ] **Step 4: Commit** `feat(graph): fragments from docs, kit files and git`.

### Task 3: The builder, the index and pull requests

**Files:** Create `src/graph/prs.js`, `src/graph/build.js`, `src/cli/graph.js`. Modify `src/cli/index.js`, `test/graph/build.test.js`.

**Interfaces:**
- Consumes: Tasks 1 and 2; `getHost` from `src/adapters/githost/index.js`; `GitHostError`, `GitHostNotFound`; `GH_NOT_FOUND` from `src/adapters/githost/github.js`.
- In `prs.js`: `prNumbers(fragments, commits) → Map<n, {key, at}>` from the fragments' `prRefs` and the subjects `Merge pull request #<n> from …` and `… (#<n>)`, the state's key first; `pullRequestNodes(refs, {host, cacheDir}) → {nodes, edges, notes, fetched, cached}`. The cache file for number n is cache/pr-<n>.json, `{key, pr}` with `pr` as `mapPullRequest` gives it without `body`. A cached `MERGED` or `CLOSED` answer is used without a call; an `OPEN` one is fetched again when its key differs. The first `GitHostError` whose message is `GH_NOT_FOUND` stops all calls and adds the note `pull requests skipped: gh not found`; any other `GitHostError` stops all calls and adds `pull requests from the cache: <message>`; after either, each number with a cached answer becomes a node with `stale: true` and each without one is left out. `GitHostNotFound` for one number adds `pull request #<n> is not on the host`. A cache file is written to a temporary name and renamed. A pull request node is `{id: pull-request:<n>, kind, label: <title>, from: '#<n>', number, url, state, mergedAt, headSha}` plus `stale` when true, with `in` pull-request→slice from the title's `[P<n>/S-<nn>]` or the state file, and `reviewed-by` to each verdict of that slice.
- In `build.js`: `buildGraph(root, cfg, {host, full = false, repos = []} = {}) → {graph, report}`. It reads the index unless `full`; walks `refTips` minus the recorded tips; keeps commit fragments `reachable` from the current tips; hashes (SHA-256) each markdown file under the docs root, each state, verdict and journal file and each `testFiles` file, and builds a fragment only for a changed hash; adds a `file` node per touched path with `in` file→repo at the oldest reachable commit that touched it, a `test` node per `testFiles` file with `in` test→repo at `<path>:1` and its `covers` edges, a `commit` node per commit (`date`, `subject`, `merge`, `default`: reachable from the default tip) with `touched` and `in` commit→slice edges at its SHA, a `repo` node `repo:.` with `web` from `webUrl`, and the pull request nodes; merges patches; drops each edge whose endpoint is not a node, adding `graph: <at> names <to>, which is not in the graph` to `report.warnings`; and validates. `repos` (S-20) are `[{name, root, defaultBranch, host}]`, walked the same way with paths prefixed `<name>/`. `report` is `{walked, commits, read, files, fetched, cached, notes, warnings}`.
- `writeGraph(root, cfg, {graph, index}) → rel`: refuses a graph with problems (`GraphError` code 1 `graph: schema: <first problem>`, nothing written); writes graph.json and index.json through a temporary name and a rename; returns the graph file's repository-relative path.
- CLI `graph [--full]`: prints the path, then `nodes <n> edges <m>`, `commits walked <k> of <n>`, `files read <k> of <n>`, `pull requests fetched <a>, from the cache <b>`, then each note; warnings go to stderr. Not a git repository → exit 2 `graph: not a git repository`. The host is `getHost(cfg, env, root)`; a `GitHostError` from `getHost` itself becomes the note `pull requests skipped: <message>`.

- [ ] **Step 1: Failing tests** — `a second run walks only the new commit and leaves git status clean`: after `init` and one `graph`, one new commit on `main` → stdout holds `commits walked 1 of <n+1>`, and `git status --porcelain` is empty. `an incremental build is byte-identical to a full build, after a new commit and a deleted branch`: graph, then a new commit and `git branch -D` of the slice branch, then `graph` and `graph --full` into two copies → the bytes are equal and no commit of the deleted branch is a node. `two full builds from the same inputs are byte-identical`. `pull requests are fetched once and then read from the cache` (a stub host counting calls): first run 1 call, second run 0. `with gh not found the build skips pull requests and says so`: a stub host whose `getPullRequest` throws `new GitHostError(GH_NOT_FOUND)` and an empty cache → no `pull-request` node, every other kind present, the note `pull requests skipped: gh not found`. `with the host unreachable pull requests come from the cache marked stale`: an open pull request cached, its state's head moved, a host throwing `GitHostError('gh pr view failed: could not connect')` → the node is present with `stale: true`. `an edge between kinds the schema does not allow is refused and graph.json is not written`: `writeGraph` with a hand-made bad edge → exit code 1 message beginning `graph: schema:`, the old graph file unchanged. `a doc naming an ID that is not in the graph drops the edge with a warning`: a slice naming an unknown REQ → no such edge, a warning naming the slice file's line.
- [ ] **Step 2: Run** `node --test test/graph/build.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(graph): incremental build, the pull request cache, slicekit graph`.

### Task 4: The loader and the query shell

**Files:** Create `src/graph/load.js`, `src/graph/render.js`, `src/cli/query.js`, `test/graph/load.test.js`. Modify `test/graph/build.test.js`.

**Interfaces:**
- In `load.js`: `graphFile(root, cfg) → absolute path`; `loadGraph(root, cfg) → graph`: absent → `GraphError` code 1 `no graph at <rel>; run slicekit graph`; another `schemaVersion` → code 1 `<rel> is schema <v>; this kit reads 1; run slicekit graph --full`. `indexGraph(graph) → {graph, node(id), byKind(kind), out(id, kind?), in(id, kind?), find(text)}`: `out` and `in` return edges in the file's order; `find` maps what a user types to a node id: a REQ, D, G or C ID, `P<n>`, `P<n>/S-<nn>`, `#<n>`, a SHA of 7 or more hex characters (unique prefix), or a path; a path is normalised (backslashes to `/`, leading `./` and trailing `/` removed) and matched as `file:<p>`; `find` returns `null` for nothing.
- In `render.js`: `nodeLine(node) → string`, one line per kind: `requirement REQ-4.1 <label>`, `slice P3/S-17 <name> (<state>)`, `test <path>`, `commit <sha7> <subject>`, `pull request #<n> <url><, stale>`, `file <path>`, `release P1`, `contract C-1 <label>`, `decision D-13`, `verdict <stem> <VERDICT>`; `renderTree(tree) → string[]` for `{node, children}`, two spaces per level, children in the order given.
- In `query.js`: `queryCommand({name, usage, options = {}, answer}) → {run, usage}`, where `answer(index, {positionals, values}) → {lines: string[], json}`. `run` parses arguments with `--json` added (bad usage → exit 2 with `usage: slicekit <usage>`), loads the config and the graph, calls `answer`, and prints `lines` or `JSON.stringify(json, null, 2)`. `answer` throws `GraphError` code 2 `<what> is not in the graph` for an unknown ID; the shell prints `slicekit: <message>` to stderr and, under `--json`, `{error}` to stdout, with the code as exit status.

- [ ] **Step 1: Failing tests** — `test/graph/load.test.js`: `find` gives the same id for `src\a.js`, `./src/a.js` and `src/a.js`; a graph file of schema 2 is refused naming `--full`. `a query with no graph built says to run slicekit graph`: a `queryCommand` built in the test, run in a repository with no graph → exit 1, stderr `slicekit: no graph at .slicekit/graph/graph.json; run slicekit graph`. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/graph/load.test.js test/graph/build.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(graph): load the graph, index it, and the query shell`.

### Task 5: CI, the README, and the 10,000-commit fixture

**Files:** Create `test/graph/perf.test.js`. Modify `test/helpers/graph-fixture.js`, `templates/workflow/slicekit.yml`, `.github/workflows/slicekit.yml`, `test/fixtures/golden/workflow/`, `README.md`, `test/workflow.test.js`, `test/readme.test.js`, `test/graph/build.test.js`.

**Interfaces:**
- `bigRepo({commits = 10_000, slices = 20, files = 500} = {}) → {root, cleanup}`: `makeRepo`, then one commit holding a spec with REQ-1.1 to REQ-1.10, decisions, one phase with `slices` slice files and their state files, then one `git fast-import --quiet` stream of `commits` commits on `main`, each changing one or two of `src/f<k>.js` and every tenth one `test/t<k>.test.js` with a line naming a REQ, each message ending `Slice: P1/S-<nn>` except every fiftieth, committer dates one minute apart from a fixed epoch, then `git checkout -f main`. Nothing is written outside the temporary directory.
- The gate job gains, after `Use the repository's git hooks` and before `slicekit check`, a step `Build the graph` running `{{cli}} graph` with `GH_TOKEN: ${{ github.token }}`, and the job's `permissions` gain `pull-requests: read`; the upload step is unchanged. The kit's own workflow and the golden file are regenerated with `slicekit workflow --write`.
- The README's scope line says, in the present tense, that the graph is built from the kit's IDs and git, and keeps the graphify line.

- [ ] **Step 1: Failing tests** — `a 10,000-commit repository builds in under thirty seconds`: `bigRepo()`, then `graph` through the CLI → exit 0 within 30,000 ms, and graph.json holds 10,001 or more commit nodes. `the gate builds the graph before uploading it`: in the rendered workflow the `Build the graph` step comes before `Upload the graph` and runs `<cli> graph`. `the scope line says the graph is built from IDs and git and is not a code graph`.
- [ ] **Step 2: Run** `node --test test/graph/perf.test.js test/workflow.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Implement**; run `node bin/slicekit.js workflow --write`.
- [ ] **Step 4: Run** the same, `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(graph): CI builds the graph; the 10,000-commit fixture`.
