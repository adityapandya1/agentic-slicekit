---
slice: P4/S-21
name: Runbook rule and `/slicekit release`
repo: .
group: A
runbook: yes
requirements: [REQ-3.7, REQ-2.9]
decisions: [D-12, D-19, D-21, D-54, D-55]
---

## Done when

1. `slicekit check` has a `runbook` rule: on a slice branch whose slice says `runbook: yes` and whose state is `draft-pr` or later and not `merged` or `released`, a pull request body (CI event or `SLICEKIT_PR_BODY`) whose Runbook line does not begin `no operational change`, on a branch that changed no `##` section of the runbook, is one finding at the slice file's `runbook:` line; with no body the rule does not judge (REQ-3.7, D-55).
2. `build pr` and the rule share `runbookVerdict`: a change above the first `##` heading, or only trailing whitespace, no longer satisfies `build pr` (REQ-3.7).
3. `slicekit release P<n>` on a `release/<slug>` branch at the default branch's tip refuses, naming each slice, while a slice of the phase is not `merged` or fails the runbook judgement, and when the record exists; it writes nothing when it refuses (REQ-2.9).
4. Otherwise it writes the release record `P<n>.md` with the default branch's SHA and that commit's date, every REQ the phase's slices implement, every pull request, the decisions in each body's Decisions section and the runbook's Rollback section; sets each slice `released`; rewrites `BUILD.md`; prints the record's path; two clones at one commit write the same bytes (REQ-2.9, D-54).
5. `slicekit instructions --command release P<n>` prints a procedure with no `git` or `gh` command that cuts the branch, runs the release and opens a `[release] P<n>` pull request through `pr open`; `ci-title` and `ci-body` accept a `[release] ` title as they accept `[plan] `; the kit's runbook says how to release a phase and its Rollback section is filled (REQ-2.9, D-21).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `check/runbook.test.js » a runbook flag with no runbook section changed is a finding` | negative | REQ-3.7 |
| `check/runbook.test.js » a changed runbook section passes` | happy | REQ-3.7 |
| `check/runbook.test.js » a body whose Runbook line begins no operational change passes` | happy | REQ-3.7 |
| `check/runbook.test.js » a change above the first section heading is not a section change` | negative | REQ-3.7 |
| `check/runbook.test.js » with no pull request body the rule does not judge` | negative | REQ-3.7 |
| `commands/release.test.js » refuses while a slice of the phase is not merged, naming it` | negative | REQ-2.9 |
| `commands/release.test.js » refuses a merged slice that fails the runbook judgement, naming it` | negative | REQ-2.9 |
| `commands/release.test.js » refuses off a release branch at the default branch's tip` | negative | REQ-2.9 |
| `commands/release.test.js » writes the release record and sets each slice released` | happy | REQ-2.9 |
| `commands/release.test.js » the record is byte-identical from two clones at the same commit` | happy | REQ-2.9 |
| `commands/release.test.js » the graph's shipped answers from the record` | e2e | REQ-2.9 |
| `check/ci-title.test.js » a [release] title is exempt` | happy | REQ-3.7 |
| `briefs.test.js » the release procedure names no git or gh command` | negative | REQ-2.9 |

## Expected changes

`src/runbook.js`, `src/check/rules/runbook.js`, `src/build/pr.js`, `src/release.js`, `src/cli/release.js`, `src/cli/branch.js`, `src/cli/index.js`, `src/check/ci-event.js`, `templates/instructions/commands/release.md`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The runbook judgement and its check rule

**Files:** Create `src/runbook.js`, `src/check/rules/runbook.js`, `test/check/runbook.test.js`. Modify `src/build/pr.js`, `test/pr.test.js`.

**Interfaces:**
- Consumes: `git` and `GitError` from `src/git.js`; `getSection` from `src/prbody.js`; `branchTip`, `readCiEvent` from `src/check/ci-event.js`; `findSliceFiles`, `parseSliceFile` from `src/slicefile.js`; `readSlice` from `src/state/index.js`; `kitPaths`; `sliceFromBranch` from `src/ids.js`.
- `NO_CHANGE = 'no operational change'`.
- `runbookRel(root, cfg) → string`, the runbook's POSIX path relative to the root (`runbook.md` when `docsRoot` is `.`).
- `mergeBase(root, cfg, tip = 'HEAD') → sha`, against `refs/remotes/origin/<defaultBranch>` when it exists, else `refs/heads/<defaultBranch>`; moved from `build pr`'s `runbookChanged`.
- `runbookSections(root, rel, base, tip) → string[]`: the `##` headings whose section holds a line that `git diff --unified=0 --ignore-space-at-eol <base> <tip> -- <rel>` adds or removes. Removed lines are placed with the base's file (`git show <base>:<rel>`, empty when absent), added lines with the tip's. A line above the first `##` heading belongs to no section; a heading line belongs to its own section. Sorted, unique.
- `runbookVerdict({flag, sections, body, rel}) → null | string`: `null` when `flag` is false, `sections` is non-empty, or `getSection(body, 'Runbook')` trimmed begins `no operational change`; else `runbook: the slice says runbook: yes, <rel> changed no section, and the Runbook line does not begin "no operational change"`. `body` may be `null`; then only the first two tests count.
- Rule `runbook`, `blocking: true`, `ratchet: false`. `run(ctx)`: `branchTip(ctx)`; the branch's slice; its slice file's `runbook` flag; its state from `readSlice` is one of `draft-pr`, `in-review`, `changes-requested`, `ci-green`, `ready`; `readCiEvent(ctx.env)` gives a body. Any of these missing → `[]`. Else `runbookVerdict` with `runbookSections(root, rel, mergeBase(root, cfg, tip), tip)`; a message becomes `{file: <slice file rel>, line: <line of runbook:>, message}`.
- `build pr`: `runbookChanged` is removed; the refusal is `runbookVerdict({flag: slice.runbook, sections, body: <the Runbook line given or kept>, rel})`, and the body's Runbook line says `changed: <rel> (<sections joined by ", ">)` when sections changed.

- [ ] **Step 1: Failing tests** — in a repository built with `makeRepo` holding a slice `P1/S-01` with `runbook: yes`, its state at `draft-pr`, a runbook with `# Runbook`, `## Rollback` and `## Alerts`, on branch `slice/P1-S-01-a`: `a runbook flag with no runbook section changed is a finding` (a code-only commit, `SLICEKIT_PR_BODY` with `**Runbook:** see docs`) → one finding at the slice file's `runbook:` line; `a changed runbook section passes` (one line added under `## Alerts`); `a body whose Runbook line begins no operational change passes`; `a change above the first section heading is not a section change` (only the `#` line edited) → the finding; `with no pull request body the rule does not judge` (no event, no `SLICEKIT_PR_BODY`) → `[]`. In `test/pr.test.js`: `build pr` refuses a runbook-flagged slice that changed only the `#` line.
- [ ] **Step 2: Run** `node --test test/check/runbook.test.js test/pr.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(check): the runbook rule, one judgement shared with build pr`.

### Task 2: The release record

**Files:** Create `src/release.js`, `src/cli/release.js`, `test/commands/release.test.js`. Modify `src/cli/index.js`, `src/cli/branch.js`, `test/branch.test.js`.

**Interfaces:**
- Consumes: Task 1; `getHost` from `src/adapters/githost/index.js`; `listSlices`, `readSlice`, `setState` from `src/state/index.js`; `renderBuild` from `src/state/build.js`; `findSliceFiles`, `parseSliceFile`, `parsePhaseFile` from `src/slicefile.js`; `reqBlocks` from `src/stage.js`; `readDecisions` from `src/decisions.js`; `getSection` from `src/prbody.js`; `currentBranch`, `git`, `commitExists` from `src/git.js`; `headings`, `lines` from `src/markdown.js`.
- `class ReleaseError extends Error` with `code` 1 (refused) or 2 (usage, unknown phase).
- `releaseBlockers(root, cfg, phase, host) → string[]`, in slice order: `<id> is <state>, not merged`; `<id> has no recorded pull request`; and for a merged slice with `runbook: yes`, the body of `host.getPullRequest(n)` is judged, then, unless it passes, the sections between `mergeBase(root, cfg, headSha)` and the state's `pr.headSha` when `commitExists`, else `<id>: commit <sha7> of #<n> is not here; fetch it or give the pull request body a Runbook line`. A failed verdict is `<id> (#<n>): <runbookVerdict message>`. A phase with no slice file is `ReleaseError` code 2 `<phase> is not a phase`.
- `renderRelease(root, cfg, phase, {host, sha}) → string`, LF endings, ending in one newline:
  - `# Release <phase> — <phase title>` (the phase file's `#` heading after the dash), a blank line, `Default branch: <defaultBranch> at <sha>, committed <committer date in ISO 8601 UTC>.`
  - `## Requirements delivered`: `- <REQ> <REQ title> (<slice ids>)`, REQs in numeric order.
  - `## Pull requests`: `- #<n> <title> <url>, merged <mergedAt>`, by number.
  - `## Decisions`: `- <D-n> <question> (#<n>, …)` for each `D-<n>` in the bodies' Decisions sections that `decisions.md` holds, by number; else `None.`
  - `## Rollback`: `From <runbook rel>:<line of ## Rollback>:`, a blank line, then the section's lines each prefixed `> `; no such section → `The runbook has no ## Rollback section.`
- `writeRelease(root, cfg, phase, {host, dryRun = false}) → {rel, text, slices}`: refuses (code 1) unless the current branch is a `release/<slug>` branch and `HEAD` equals `refs/remotes/origin/<defaultBranch>` (else the local branch): `release runs on a release branch at the tip of <defaultBranch>; run slicekit branch release <slug>`; refuses when the record exists: `<rel> exists; a phase is released once`; refuses with the blockers joined by newlines. With `dryRun` it returns the text and writes nothing. Else it writes the record through a temporary name and a rename, calls `setState(root, cfg, id, 'released', {release: rel})` for each slice, then writes `BUILD.md` from `renderBuild`.
- CLI `release P<n> [--dry-run]`: success prints the record's path, then `released <id>` per slice (with `--dry-run`, the text); a refusal prints `slicekit: <line>` per line to stderr. The host is `getHost(cfg, env, root)`.
- `slicekit branch release <slug>` cuts `release/<slug>` as it cuts `plan/<slug>`.

- [ ] **Step 1: Failing tests** — the release test file builds a repository with `makeRepo` and `makeRemote`, a phase P1 with two slices, their states and a fixture host directory holding pull requests 1 and 2 (bodies with `**Decisions:** D-02` and `**Runbook:** no operational change: docs only`), on `release/p1` at `origin/main`. `refuses while a slice of the phase is not merged, naming it`: S-02 at `ready` → exit 1, stderr names `P1/S-02 is ready, not merged`, no record, both state files unchanged. `refuses a merged slice that fails the runbook judgement, naming it`: S-01 `runbook: yes`, body `**Runbook:** see below`, head commit present and changing no section → exit 1 naming `P1/S-01 (#1)`. `refuses off a release branch at the default branch's tip`: on `main` → exit 1; on `release/p1` one commit ahead → exit 1. `writes the release record and sets each slice released`: exit 0, stdout line 1 is the record's path, the record holds `#1`, `#2`, `D-02`, the REQs of both slices and the runbook's Rollback text; both states `released`; `BUILD.md` regenerated. `the record is byte-identical from two clones at the same commit`: two clones, `--dry-run` in each → equal stdout. `the graph's shipped answers from the record`: after release, `graph` then `shipped P1` lists both pull requests.
- [ ] **Step 2: Run** `node --test test/commands/release.test.js test/branch.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(release): slicekit release writes the record and sets each slice released`.

### Task 3: The procedure, the `[release]` title and the kit's runbook

**Files:** Create `templates/instructions/commands/release.md`. Modify `src/check/ci-event.js`, `test/check/ci-title.test.js`, `test/check/ci-body.test.js`, `test/briefs.test.js`, `docs/runbook.md`, `test/runbook.test.js`.

**Interfaces:**
- `EXEMPT_TITLE = /^\[(spec|plan|release)\] /`, so `ci-title`, `ci-body`, `ready-label` and `pr open` treat a release pull request as a plan one: opened ready, three body sections.
- The procedure, `{{args}}` the phase: (1) `{{cli}} release {{args}} --dry-run`; a refusal is printed to the human with its lines, and the procedure stops; (2) `{{cli}} branch release <phase in lower case>`; (3) `{{cli}} release {{args}}`; (4) `{{cli}} check` until `0 findings`; (5) a body file outside the repository with `**Done when:** every slice of <phase> released`, `**Proof:**` the check summary line, `**Decisions:**` the record's Decisions lines or `none`; (6) `{{cli}} pr open --title "[release] {{args}}" --body-file <file> --commit "docs(release): {{args}}" --paths <docsRoot>/releases/{{args}}.md,.slicekit/state,BUILD.md`; (7) print the pull request line, and say that the release does not deploy (D-12).
- The kit's runbook: a new section `## Recording a release` (the procedure in the human's words: when to run it, what it refuses, that merging the pull request is the release) and `## Rollback` filled: revert the pull request on GitHub for a change not yet published; for a published version, `## Rolling back a bad version on npm`.

- [ ] **Step 1: Failing tests** — `a [release] title is exempt` in `test/check/ci-title.test.js`; a `[release]` body with only the three sections passes `ci-body`; `the release procedure names no git or gh command` through the brief lint in `test/briefs.test.js`, and `instructions --command release P1` exits 0; `test/runbook.test.js`: `## Rollback` is not `Not yet known` and `## Recording a release` names `slicekit release`.
- [ ] **Step 2: Run** `node --test test/check/ci-title.test.js test/check/ci-body.test.js test/briefs.test.js test/runbook.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(release): the release procedure and the [release] title; the runbook says how`.
