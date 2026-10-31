---
slice: P4/S-23
name: `/slicekit ops` and `/slicekit audit`
repo: .
group: B
runbook: no
requirements: [REQ-2.13, REQ-2.14]
decisions: [D-13, D-19, D-20, D-57, D-58]
---

## Done when

1. `slicekit ops context "<symptom>"` prints, first, the next free report path under .slicekit/reports, then the files the symptom's words name (a word over fifty files reported as too broad), `slicekit history` for those files, the runbook and observability paths and the last release record; with no file named and no `--path` it exits 1 saying so (REQ-2.13, D-57).
2. `slicekit audit context [area]` prints the next free report path and each claim in the area (each REQ block, each runbook `##` section) with its `<file>:<line>`, the files it names and its candidate commits: those that touched a named file after the claim's heading line last changed (REQ-2.14, D-58).
3. `slicekit ops check <report>` and `slicekit audit check <report>` exit 1 with one `<report>:<line> <message>` per problem: a missing section, an unknown slice or pull request, a cited `<file>:<line>` that does not exist, an action marked by no one, a status other than `holds`, `drifted` or `unverifiable`, a `drifted` row whose commit is not one of its claim's candidates (REQ-2.13, REQ-2.14).
4. On the fixture with a seeded regression, the ops context for "billing returns 500 after the release" lists the billing slices and their pull requests, and the audit context lists the runbook's health claim with the commit that broke it as a candidate; after both commands and both checks, `git status --porcelain` is empty (REQ-2.13, REQ-2.14).
5. `slicekit instructions --command ops` and `--command audit` print procedures with no `git` or `gh` command; the ops agent's tools are `Read, Grep, Glob`; init ignores .slicekit/reports (REQ-2.13, D-19, D-57).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/ops.test.js » the report lists the slices and pull requests that touched the named files, and nothing else changes` | happy | REQ-2.13 |
| `commands/ops.test.js » a word that matches more than fifty files is reported as too broad` | negative | REQ-2.13 |
| `commands/ops.test.js » a symptom naming no file exits 1 and asks for --path` | negative | REQ-2.13 |
| `commands/ops.test.js » ops check refuses an action no one may take and a slice that does not exist` | negative | REQ-2.13 |
| `commands/audit.test.js » a runbook claim a later commit made false is drifted, with that commit` | negative | REQ-2.14 |
| `commands/audit.test.js » the context lists each claim in the area with the files it names` | happy | REQ-2.14 |
| `commands/audit.test.js » audit check refuses a drifted row whose commit is not a candidate` | negative | REQ-2.14 |
| `commands/audit.test.js » audit check passes a report of holds, drifted and unverifiable rows, and nothing else changes` | happy | REQ-2.14 |
| `briefs.test.js » the ops and audit procedures name no git or gh command` | negative | REQ-2.13 |
| `render-all.test.js » the ops agent's tools are Read, Grep and Glob` | happy | REQ-2.13 |

## Expected changes

`src/reports.js`, `src/ops.js`, `src/audit.js`, `src/cli/ops.js`, `src/cli/audit.js`, `src/cli/index.js`, `src/paths.js`, `src/init.js`, `.gitignore`, `templates/instructions/commands/ops.md`, `templates/instructions/commands/audit.md`, `templates/instructions/agents/ops.md`, `templates/instructions/agents/auditor.md`, `templates/claude-code/agents/ops.md`, `.claude/agents/ops.md`, `test/helpers/ops-fixture.js`, tests.

## Tasks

### Task 1: The fixture and the report helpers

**Files:** Create `test/helpers/ops-fixture.js`, `src/reports.js`. Modify `src/paths.js`, `src/init.js`, `.gitignore`, `test/init.test.js`.

**Interfaces:**
- `kitPaths(root, cfg).reports` is `<root>/.slicekit/reports`. Init's ignore rules gain the line .slicekit/reports/, and so does the kit's own ignore file.
- `nextReport(root, cfg, kind) → rel`: `.slicekit/reports/<kind>-<k>.md` with `k` one above the highest of that kind there, else 1; it creates the directory and nothing else.
- `reportSections(text) → Map<lower-case heading, {line, lines: [{text, line}]}>` for the `##` sections outside fenced blocks; `reportTable(text, heading) → [{cells, line}]` for the first table in that section, header row dropped.
- `opsRepo() → {root, host, cleanup}`: `makeRepo` and `makeRemote`; a spec with REQ-1.1 (billing) and REQ-1.2 (health); a runbook whose `## Health` section says ``GET /health answers `ok` (`src/health.js`)`` and whose `## Known failure modes and the first thing to check` names `src/billing/`; an `observability.md`; phase P1 with S-01 (billing, `src/billing/charge.js`, `src/billing/refund.js`) and S-02 (health, `src/health.js`), each merged through pull requests 1 and 2 in a fixture host directory, released with `slicekit release P1` (P4/S-21); then the seeded regression, a commit `fix: health answers up` on `main` under `Slice: P1/S-03` changing `src/health.js` to answer `up`; 60 files under `src/release/` so the word `release` is too broad; then `slicekit graph`. <!-- slicekit:example -->

- [ ] **Step 1: Failing tests** — `test/init.test.js`: init's ignore file holds the line .slicekit/reports/. A report helper test in the ops test file: `nextReport` gives `ops-1.md`, then `ops-2.md` once `ops-1.md` exists.
- [ ] **Step 2: Run** `node --test test/init.test.js test/commands/ops.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(ops): the reports directory and the ops fixture`.

### Task 2: `slicekit ops`

**Files:** Create `src/ops.js`, `src/cli/ops.js`, `test/commands/ops.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes: `loadGraph`, `indexGraph`, `normalisePath` from `src/graph/load.js`; `history`, `historyLine` from `src/graph/history.js`; `keyOf` from `src/graph/schema.js`; Task 1.
- `BROAD = 50`.
- `symptomFiles(index, symptom, paths = []) → {files, words: [{word, files}], broad: [{word, count}], unmatched}`: words are the runs of `[A-Za-z0-9]` of three or more characters, lower-cased, unique, in order; a word names each `file` node one of whose path segments (split on `/`, `.`, `-`, `_`), lower-cased, equals it; a word naming more than `BROAD` files goes to `broad` and names none; a word naming none goes to `unmatched`. Each `--path` names the files `history` would match for it; a path matching none is `GraphError` code 2 `<p> is not in the graph`. `files` is the sorted union.
- `opsContext(root, cfg, symptom, {paths}) → {report, symptom, files, broad, unmatched, history, runbook, observability, lastRelease}`: `report` from `nextReport(root, cfg, 'ops')`; `history` from `history(index, files)`; `lastRelease` the release record with the highest phase number, else `null`; paths repository-relative.
- `opsReportProblems(root, index, rel, text) → string[]`, each `<rel>:<line> <message>`: the sections `Likely slices and pull requests`, `First checks` and `Proposed actions`, each present and holding a line; every slice address in the first a `slice` node, every `#<n>` a `pull-request` node; every `<file>:<line>` in `First checks` a file that exists with at least that many lines; every list item in `Proposed actions` ending `(anyone)`, `(on-call)` or `(owner: <name>)`; a `Skipped:` and a `Not checked:` line.
- CLI `ops context <symptom> [--path <p>]… [--json]` prints the report path, then `symptom: <text>`, one `file: <path>` line per file, `too broad: <word> (<n> files)`, `no file: <words joined by ", ">`, `history:` and each `historyLine`, `runbook: <rel>`, `observability: <rel>`, `last release: <rel or none>`. No file and no `--path` → exit 1 `the symptom names no file in the graph; name one with --path <path>`. No graph → S-17's `no graph at …; run slicekit graph`. `ops check <report>` prints each problem and exits 1, else `ok <report>` and exits 0. `ops` is `{run, usage, subcommands: ['context', 'check']}`.

- [ ] **Step 1: Failing tests** — on `opsRepo()`: `the report lists the slices and pull requests that touched the named files, and nothing else changes`: `ops context "billing returns 500 after the release"` → exit 0, line 1 `.slicekit/reports/ops-1.md`, the two billing files, a history line for `P1/S-01` with `PR #1` and `released P1`, no line for `P1/S-02`, `last release: docs/releases/P1.md`; then a report written to that path with the three sections passes `ops check`; `git status --porcelain` is empty. `a word that matches more than fifty files is reported as too broad`: the same run prints `too broad: release (60 files)`. `a symptom naming no file exits 1 and asks for --path`: `ops context "everything is slow"` → exit 1; with `--path src/health.js` → exit 0. `ops check refuses an action no one may take and a slice that does not exist`: a report naming `P1/S-09` and an action line with no marker → exit 1, one line each. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/ops.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(ops): slicekit ops context and ops check`.

### Task 3: `slicekit audit`

**Files:** Create `src/audit.js`, `src/cli/audit.js`, `test/commands/audit.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes: Task 1; `reqBlocks` from `src/stage.js`; `headings`, `lines`, `prose` from `src/markdown.js`; `git` from `src/git.js`; the graph loader and index as Task 2.
- `auditClaims(root, cfg, index, area) → [{id, where, title, files, since, candidates}]`, in spec order then runbook order. A spec claim is a REQ block (`id` the REQ ID, `where` its heading's `<file>:<line>`); a runbook claim is a `##` section (`id` `runbook#<slug>`, slug as the graph's runbook-section key). `area` absent → all; a REQ prefix (`REQ-2`) → the REQs it starts; a spec file stem (`02-commands-agents-loop`) → that file's; `runbook` → the runbook's; a path → the claims whose `files` hold it or a file under it; anything else is code 2 `<area> names no claim`. `files`: the code spans and link targets in the claim's text that name a `file` node, or a directory holding one, sorted. `since`: `{sha, date}` of `git blame --porcelain -L <line>,<line> -- <file>` on the heading line. `candidates`: the commits that touched one of `files` with a committer date after `since.date`, newest first, each `{sha, date, subject}`.
- `auditContext(root, cfg, area) → {report, claims}`, `report` from `nextReport(root, cfg, 'audit')`.
- `auditReportProblems(root, rel, text, claims) → string[]`: a table under `## Claims` with the columns Claim, Where, Evidence, Found at, Status, Commit. Each row: Claim one of `claims`' ids and Where its `where`; Status one of `holds`, `drifted`, `unverifiable`; for `drifted`, Commit a SHA prefix of seven or more hex characters of one of that claim's candidates, else `<rel>:<line> drifted <id> names <commit>, which is not a commit that touched its files after it was written`; for `unverifiable`, Evidence non-empty; for `holds` and `drifted`, Found at a `<file>:<line>` that exists or a command in backticks. A `Skipped:` and a `Not checked:` line.
- CLI `audit context [area] [--json]` prints the report path, then per claim `<id> <where> <title>`, `  files: …` and `  candidate <sha7> <date> <subject>` lines. `audit check <report> [area]` checks against the claims of the same area. `audit` is `{run, usage, subcommands: ['context', 'check']}`.

- [ ] **Step 1: Failing tests** — on `opsRepo()`: `the context lists each claim in the area with the files it names`: `audit context runbook` → the `runbook#health` claim with `files: src/health.js` and the failure-modes claim with `src/billing`. `a runbook claim a later commit made false is drifted, with that commit`: the health claim's candidates hold the seeded commit; a report marking it `drifted` with that commit's SHA passes `audit check`. `audit check refuses a drifted row whose commit is not a candidate`: the same row naming the commit of P1/S-01 → exit 1 with the message above. `audit check passes a report of holds, drifted and unverifiable rows, and nothing else changes`: one row of each → exit 0, and `git status --porcelain` is empty. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/audit.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(audit): slicekit audit context and audit check`.

### Task 4: The procedures, the briefs and the ops agent's tools

**Files:** Create `templates/instructions/commands/ops.md`, `templates/instructions/commands/audit.md`. Modify `templates/instructions/agents/ops.md`, `templates/instructions/agents/auditor.md`, `templates/claude-code/agents/ops.md`, `.claude/agents/ops.md`, `test/briefs.test.js`, `test/render-all.test.js`, `test/fixtures/golden/`.

**Interfaces:**
- The ops procedure, `{{args}}` the symptom: (1) `{{cli}} graph`; (2) `{{cli}} ops context {{args}}`; on exit 1, ask the human which file or service is meant and run it again with `--path`; (3) spawn **ops** with the symptom and the whole context output, telling it to read the runbook, `observability.md` and the release record it names; (4) write the agent's reply, as it is, to the report path with the Write tool; (5) `{{cli}} ops check <report>`; on findings, send them to the agent once and write its new reply; (6) print the report path and its Proposed actions section, and say that no action was taken.
- The audit procedure, `{{args}}` the area or `(none)`: (1) `{{cli}} graph`; (2) `{{cli}} audit context {{args}}`; (3) spawn **auditor** with the context output and the report path, in audit mode; (4) `{{cli}} audit check <report> {{args}}`; on findings, send them to the agent once; (5) print the path and the count of each status, and tell the human that each `drifted` row becomes a slice or a decision, by their hand.
- The ops brief: the report is the reply, with the sections `## Likely slices and pull requests`, `## First checks`, `## Proposed actions`, each action marked `(anyone)`, `(on-call)` or `(owner: <name>)`; the brief names no Write tool. The auditor brief's audit section names the `## Claims` table and its six columns, and says a `drifted` row names one of the claim's candidate commits.
- `templates/claude-code/agents/ops.md`: `tools: Read, Grep, Glob`; its body no longer says the agent reports and the command commits, since ops writes nothing. The kit's own copy is re-rendered with `node bin/slicekit.js build render P4/S-23`.

- [ ] **Step 1: Failing tests** — `the ops and audit procedures name no git or gh command` (the brief lint over both procedures and both briefs); `instructions --command ops "x"` and `--command audit` exit 0; `the ops agent's tools are Read, Grep and Glob` in the rendered `.claude/agents/ops.md` for every shape.
- [ ] **Step 2: Run** `node --test test/briefs.test.js test/render-all.test.js test/instructions.test.js` → FAIL.
- [ ] **Step 3: Implement**; regenerate the golden render files; `node bin/slicekit.js build render P4/S-23`.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(ops): the ops and audit procedures; ops reads and writes nothing`.
