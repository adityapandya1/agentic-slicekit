---
slice: P3/S-20
name: Workspace and contracts
repo: .
group: B
runbook: no
requirements: [REQ-4.6, REQ-4.5]
decisions: [D-13, D-15, D-47, D-48]
---

## Done when

1. In a program repository whose workspace file (`kitPaths(root, cfg).workspace`) lists `{name, path or url, defaultBranch}` entries, `slicekit graph` walks every entry whose `path` is a git repository on disk as it walks the program repository, prefixing its file and test nodes `<name>/`, naming its pull requests `pull-request:<name>#<n>` and adding `repo:<name>`; each other entry is printed as `repo <name> not reached: <reason>` and the build goes on (REQ-4.6, D-15).
2. A workspace file that is not JSON, has no `repos` array, repeats a name, uses the name `.`, gives neither `path` nor `url`, or lacks `defaultBranch` stops `graph` with exit 1 and `<workspace file>: <problem>`.
3. `slicekit impact <REQ, C-n, slice or path> [--json]` prints `contracts:`, `slices:` (each with its `repo` and how it relates: `implements`, `touched <k> shared files`, `produces C-n` or `consumes C-n`), `files:` and `repos:`; for a contract produced by a slice in one repository and consumed by a slice in another, both slices and both repositories are listed; an unknown target exits 2 with `<target> is not in the graph`; it answers in under two seconds on the 10,000-commit fixture (REQ-4.6's scenario, REQ-4.5).
4. A new check rule, `workspace`, reports `slice <id> names repo <r>, which <workspace file> does not list` (or `…; there is no workspace file`) for a slice whose `repo` is neither `.` nor a workspace entry, and `<C-n> names no producer` or `<C-n> names no consumer` for a contract whose `**Producer:**` or `**Consumer:**`/`**Consumers:**` text is missing or empty (REQ-4.6's Enforced by).
5. The kit's own repository, with no workspace file and its three contracts as they stand, gives `node bin/slicekit.js check` 0 findings.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `graph/workspace.test.js » impact on a contract lists its producer and consumer slices and both repositories` | happy | REQ-4.6 |
| `graph/workspace.test.js » files of a workspace repository are prefixed with its name` | happy | REQ-4.6 |
| `graph/workspace.test.js » a listed repository that is not on disk is reported` | negative | REQ-4.6 |
| `graph/workspace.test.js » a workspace file repeating a name is refused` | negative | REQ-4.6 |
| `graph/workspace.test.js » impact on a path lists the slices and contracts that share it` | happy | REQ-4.5 |
| `graph/workspace.test.js » impact on a target not in the graph exits 2 naming it` | negative | REQ-4.5 |
| `graph/impact-perf.test.js » impact answers in under two seconds on a 10,000-commit repository` | happy | REQ-4.5 |
| `check/workspace.test.js » a slice whose repo is not a workspace entry is a finding` | negative | REQ-4.6 |
| `check/workspace.test.js » a contract naming no consumer is a finding` | negative | REQ-4.6 |
| `check/workspace.test.js » slices on . and on a listed repository, and contracts naming both sides, pass` | happy | REQ-4.6 |

## Expected changes

`src/graph/{workspace,impact,build}.js`, `src/cli/{impact,graph}.js`, `src/cli/index.js`, `src/check/rules/workspace.js`, tests.

## Tasks

### Task 1: Reading the workspace and building across it

**Files:** Create `src/graph/workspace.js`, `test/graph/workspace.test.js`. Modify `src/graph/build.js`, `src/cli/graph.js`.

**Interfaces:**
- Consumes (S-17): `buildGraph` with its `repos` option, `defaultRef`, `GraphError`; `graphRepo` from the graph fixture helper; `makeRepo` from `test/helpers/tmp-repo.js`; `getHost` (C-1).
- In `workspace.js`: `readWorkspace(root, cfg) → {repos: [{name, path, url, defaultBranch}]} | null`: `null` when the file is absent; otherwise each problem of Done-when 2 throws `GraphError` code 1 `<rel>: <problem>`, the problems worded `not valid JSON: <message>`, `repos must be an array`, `repos[<i>].name must be a name of letters, digits, . _ or -, and not .`, `repos[<i>].name <n> is listed twice`, `repos[<i>] gives neither path nor url`, `repos[<i>].defaultBranch must be a branch name`. `reachRepos(root, workspace, env) → {reached: [{name, root, defaultBranch, host}], unreached: [{name, reason}]}`: `path` resolves against the program root; the reasons are `<path> does not exist`, `<path> is not a git repository`, `no path; <url> is not on disk` and `the default branch <b> is not present`. `host` is `getHost(cfg, env, <repo root>)`; when `SLICEKIT_GITHOST_FIXTURE` is set it is the fixture host of `<fixture>/<name>`, and of a directory that is absent a host whose every call throws `GitHostError('no fixture for <name>')`.
- `buildGraph`'s `repos` gain what S-17 left to this slice: pull request numbers read from each repository's merge commit subjects only (state files live in the program repository), its pull request nodes keyed `<name>#<n>` with the cache file `pr-<name>-<n>.json`, `in` file→repo and test→repo to `repo:<name>`, and `graph.repos` listing `{name, sha}` for each reached repository after `.`. A commit in a workspace repository whose Slice trailer names a program slice gets `in` commit→slice as in the program repository.
- CLI `graph`: reads the workspace, passes the reached repositories to `buildGraph`, and prints one `repo <name> not reached: <reason>` line per unreached one after the counts.

- [ ] **Step 1: Failing tests** — `files of a workspace repository are prefixed with its name`: a program repository from `graphRepo()` and a second repository `orders` beside it, listed with a relative `path`, holding a commit with `Slice: P1/S-01` that touches `src/o.js` → the graph has `file:orders/src/o.js` with `in` to `repo:orders`, the commit has `in` to `slice:P1/S-01`, and `graph.repos` is `[{name: '.', …}, {name: 'orders', …}]`. `a listed repository that is not on disk is reported`: an entry `billing` with a `path` that does not exist and one with only a `url` → exit 0, stdout lines `repo billing not reached: <path> does not exist` and `repo <name> not reached: no path; <url> is not on disk`, and every node of the program repository present. `a workspace file repeating a name is refused`: exit 1, stderr naming `is listed twice`, graph.json not written. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/graph/workspace.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `node --test test/graph/build.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(graph): build across the repositories of a workspace`.

### Task 2: `impact`

**Files:** Create `src/graph/impact.js`, `src/cli/impact.js`, `test/graph/impact-perf.test.js`. Modify `src/cli/index.js`, `test/graph/workspace.test.js`.

**Interfaces:**
- Consumes (S-17): `queryCommand`, `indexGraph` and its `find`, `nodeLine`; `bigRepo`.
- In `impact.js`: `impact(index, target) → {contracts, slices, files, repos}`. The start set: for a requirement, the slices that implement it; for a contract, the contract; for a slice, the slice; for a path, its file nodes (a directory matches every file under it). The start files are the start set's files (the files touched by its slices' commits); the start contracts are the start set's contracts (the contracts its slices produce or consume). `slices` are every slice that implements the requirement, touched a start file or produces or consumes a start contract, each `{id, repo, relations}` with relations from `implements`, `touched <k> shared files`, `produces C-n`, `consumes C-n`, sorted by id; `files` the start files, path order; `contracts` the start contracts, id order; `repos` the distinct names of the listed slices' `repo` attributes and the listed files' repositories, sorted. Nothing found for the target → `GraphError` code 2 `<target> is not in the graph`.
- CLI `impact <target> [--json]`: four headed sections in the order of Done-when 3, each item on its own line indented two spaces (`<slice>  repo <r>  <relations joined by ", ">` for slices), `repos: <a>, <b>` last.

- [ ] **Step 1: Failing tests** — `impact on a contract lists its producer and consumer slices and both repositories`: a program repository with contract C-2 whose `**Producer:**` names P1/S-04 and whose `**Consumers:**` names P1/S-09, S-04 with `repo: orders` and S-09 with `repo: billing`, both workspace repositories on disk → `impact C-2` lists `P1/S-04  repo orders  produces C-2`, `P1/S-09  repo billing  consumes C-2` and `repos: billing, orders`. `impact on a path lists the slices and contracts that share it`: two slices touching one file, one producing C-2 → `impact <that path>` lists both slices with `touched 1 shared files` and C-2 under `contracts:`. `impact on a target not in the graph exits 2 naming it`: `impact C-9` → exit 2, stderr `slicekit: C-9 is not in the graph`. <!-- slicekit:example --> `impact answers in under two seconds on a 10,000-commit repository`: `bigRepo()`, `graph`, then `impact REQ-1.1` and `impact src` through `runCli` → each exits 0 within 2,000 ms.
- [ ] **Step 2: Run** `node --test test/graph/workspace.test.js test/graph/impact-perf.test.js` → FAIL.
- [ ] **Step 3: Implement**; register `impact`.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(impact): what shares files or contracts with a target, across repositories`.

### Task 3: The `workspace` check rule

**Files:** Create `src/check/rules/workspace.js`, `test/check/workspace.test.js`.

**Interfaces:**
- Consumes: `readWorkspace` (Task 1); `findSliceFiles`, `parseSliceFile`; the context's docs and `paths.contracts`.
- Rule `{id: 'workspace', blocking: true, ratchet: false, run(ctx) → finding[]}`. A workspace file that `readWorkspace` refuses is one finding at that file, line 1, with its message. For each slice file: `repo` is `.`, or names an entry → nothing; else the finding of Done-when 4 at the line of `repo:`. For each contract file `C-<n>-*.md` in the contracts directory: the text after `**Producer:**`, up to the next `**<Key>:**` or blank line, must hold a non-space character, else `<C-n> names no producer` at line 1; the same for `**Consumer:**` or `**Consumers:**`, else `<C-n> names no consumer`. A slice address in that text is what the graph draws an edge for (S-17); a party outside the program, such as the agent tool of C-3, is named in words (proposed decision 5 of the phase file).

- [ ] **Step 1: Failing tests** — `a slice whose repo is not a workspace entry is a finding`: a slice with `repo: orders` and a workspace listing only `billing` → one finding naming `orders`; with no workspace file → the `there is no workspace file` form. `a contract naming no consumer is a finding`: a contract with a `**Producer:**` line and no consumer line → `C-1 names no consumer`. `slices on . and on a listed repository, and contracts naming both sides, pass`: no finding; and `node bin/slicekit.js check` in the kit itself reports `0 findings`.
- [ ] **Step 2: Run** `node --test test/check/workspace.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(check): slices name a workspace repository; contracts name both sides`.
