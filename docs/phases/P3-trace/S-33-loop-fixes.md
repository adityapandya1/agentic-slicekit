---
slice: P3/S-33
name: Build and review loop fixes
repo: .
group: C
runbook: no
requirements: [REQ-2.6, REQ-2.8, REQ-2.12, REQ-3.11]
decisions: [D-43, D-49, D-53]
---

## Done when

1. A new step, `slicekit build config <id> [--worktree <p>]`, commits the worktree's changed `.slicekit/config.json` alone as `chore(slicekit): <id> config` with the `Slice: <id>` trailer and prints `<sha7> config`, or `nothing to commit` when the config is unchanged. It runs from the states `build render` runs from. It refuses with `slice <id> does not name .slicekit/config.json in its Expected changes` when the slice file at HEAD does not list that path, and with `.slicekit/config.json: <problem>` when the worktree's config does not load. `build commit` accepts such a commit when its subject, its trailer and its one file match and the slice file at that commit names the config. A config changed in the worktree is still refused by `build commit`, and the message now ends `; run slicekit build config <id>`. A separate step, as `build render` is, was chosen over letting `build commit` take the config: `build commit` keeps its rule of never committing a kit file (issue #51, D-53).
2. In a commit reachable from the default branch (`origin/<defaultBranch>`, or the local branch when there is no origin), the kit-file guard of `build commit` judges only this slice's own state file and verdicts. So a merge of main that brings another slice's render commit, a version bump or a config change is no longer refused with `was changed in <sha> outside the kit`. A commit there that changes this slice's own state file or verdicts is still refused: the default branch never carries them while the slice is open, and its tip is a ref a clone can move (issue #32, D-53).
3. The guard judges merge commits as well, by their kit files against the first parent. A kit file outside the D-43 set passes only when its content equals what a parent on the default branch holds, and this slice's own state file and verdicts never change in a merge. Any other is refused with `<file> was changed in <sha7>, a merge, outside the kit; only build commands write it`, whether the resolution edited it or took it whole from another branch. A merge of main that takes main's kit files passes as before. A commit with no parent has its own files judged (issue #31, D-53).
4. `build verdict --worktree <p>`, and every other step that takes `--worktree`, refuses a review worktree at `review start`'s path whose HEAD is detached with `<p> is the review worktree of <id> on a detached HEAD; run slicekit review start <n> to move it to the pull request's head`. `<n>` is the pull request number recorded in that worktree's state file, or `<PR>` when none is recorded. A detached worktree is not accepted as the review worktree, because `build verdict` pushes the review branch. The review procedure already starts each new round with `review start` (issue #61).
5. `slicekit instructions <role> <id> --worktree <p>` reads the slice file, the cited requirements and the decisions from `<p>`, through `<p>`'s own config, whenever `<p>` holds that slice's file. So a reviewer is briefed on the text under review. When `<p>` holds no file for the slice, they are read from the session root as today (issue #56).
6. `reduceRuns` groups runs by `workflowDatabaseId` and event when every run carries a `workflowDatabaseId`, and otherwise by workflow name and event as before, so two workflow files that share a display name are judged apart. The GitHub host asks `gh run list` for `workflowDatabaseId` and `startedAt` as well (issue #41).
7. The newest run of a group, in `reduceRuns` and in the choice of the slicekit run, is the one with the latest `startedAt`, with `createdAt` used for a run that has no `startedAt`. A re-run moves `startedAt` and leaves `createdAt` alone, so an older run re-run to success after a newer run failed is the commit's answer. `startedAt` was chosen over the `attempt` field, which counts the attempts of one run and cannot order two runs (issue #42).
8. `slicekitRun(sha)` returns the newest slicekit pull_request run of the commit whose team command jobs were decided, `passed` or `failed` by `commandJobsVerdict`. Runs still in progress, and runs whose command jobs were all skipped or cancelled, are passed over. So on an `edited` event, or on a re-run of all jobs, a head that passed before is its own base and the push is `bookkeeping`, and the current run, which is still in progress, is never the answer. The GitHub host and the fixture host share this choice through one function in `gh-json.js` (issue #52).
9. A test drives `build finish` and `status --sync` through the fixture host with CI records that carry `workflowName` and `event`, a cancelled older run and a successful newer run of the same workflow, and both commands read success (issue #43).
10. `slicekitRun` on the GitHub host is tested with an injected `exec`, the way `ciStatus` and the label calls are. The test pins the `gh run list` arguments (`--commit`, `--workflow slicekit.yml`, `--event pull_request`, `--limit 20`, the field list), the `gh run view <id> --json jobs` call, and the refusal `gh run list printed a run with no databaseId` (issue #53).
11. `test/commands/review.test.js` and `test/commands/review-loop.test.js` are each split into three files, and the module hook goes: `scripts/test-parts-hook.js`, `test-parts-loader.js` and `test-parts-wrapper.js` are deleted, `SPLIT` leaves `scripts/test-shard.js`, and the weight table names the six files. Each new file holds a run of the old file's tests in order, with every test name kept word for word and appearing once across the three files. Each file starts with a comment naming the requirements its tests check. Splitting the files was chosen over guarding the hook's counting convention, because it leaves nothing to keep in step (issue #55). <!-- slicekit:example -->

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `build-config.test.js » build config commits the config alone when the slice names it, and build commit accepts it` | happy | REQ-2.6 |
| `build-config.test.js » build config refuses a slice that does not name the config, and a config that does not load` | negative | REQ-2.6 |
| `build-commit-merge.test.js » a merge of main bringing another slice's render and config commits passes build commit` | happy | REQ-2.6 |
| `build-commit-merge.test.js » a merge whose resolution edits this slice's state file is refused at build commit` | negative | REQ-2.6 |
| `build-commit-merge.test.js » a merge that takes this slice's state file from an orphan branch is refused at build commit` | negative | REQ-2.6 |
| `review-worktree.test.js » build verdict on a detached review worktree names review start and the pull request` | negative | REQ-2.8 |
| `review-worktree.test.js » the reviewer brief with --worktree quotes the slice file the worktree holds` | happy | REQ-2.12 |
| `ci-runs.test.js » two workflow files with one name are judged apart by their workflow id` | negative | REQ-2.6 |
| `ci-runs.test.js » an older run re-run to success after a newer run failed is the answer` | happy | REQ-2.6 |
| `ci-runs-host.test.js » build finish and status --sync read the newest run of each workflow from the fixture host` | happy | REQ-2.6 |
| `ci-bookkeeping-walk.test.js » an edited event on a head that passed is bookkeeping, passing over the run in progress` | happy | REQ-3.11 |
| `ci-bookkeeping-walk.test.js » a head whose runs are all in progress or skipped walks on to its parent` | negative | REQ-3.11 |
| `github-slicekit-run.test.js » slicekitRun asks gh for the slicekit workflow's pull_request runs and views the chosen one` | happy | REQ-3.11 |
| `github-slicekit-run.test.js » a run with no databaseId is refused` | negative | REQ-3.11 |
| `test-shard.test.js » every test file runs whole in exactly one shard` | happy | REQ-3.11 |

## Expected changes

`src/build/config.js`, `src/build/commit.js`, `src/build/worktree.js`, `src/cli/build.js`, `src/instructions.js`, `src/adapters/githost/gh-json.js`, `src/adapters/githost/github.js`, `src/adapters/githost/fixture.js`, `src/cli/ci.js` (its header comment), `templates/instructions/commands/build.md`, `scripts/test-shard.js`, `scripts/test-parts-hook.js`, `scripts/test-parts-loader.js`, `scripts/test-parts-wrapper.js`, `test/commands/review.test.js`, `test/commands/review-loop.test.js`, tests. <!-- slicekit:example -->

## Tasks

### Task 1: The kit-file guard and `build config`

**Files:** Create `src/build/config.js` (`configSlice`). Modify `src/build/commit.js` (`forgedKitChange`: the range leaves out the default branch's commits, merges are judged by their `--cc` files, the config commit is accepted; `commitWork`'s refusal names `build config`), `src/cli/build.js` (the `config` subcommand and the usage line), `templates/instructions/commands/build.md` (one paragraph beside `build render`'s). Create `test/build-config.test.js` and `test/build-commit-merge.test.js`.

- [ ] **Step 1: Failing tests**: the four tests above, on a temporary repository with a slice worktree. The merge cases merge a main that carries another slice's render commit and a config change, and, for the refusal, merge with `--no-commit`, edit this slice's state file and commit (issue #31's reproduction).
- [ ] **Step 2: Implement**; run `node --test test/build-config.test.js test/build-commit-merge.test.js test/build-amend.test.js test/build-render.test.js` → PASS.
- [ ] **Step 3: Commit** `fix(P3/S-33): build config, and the kit-file guard after a merge of main`.

### Task 2: The review worktree and the brief

**Files:** Modify `src/build/worktree.js` (`findWorktree`: the detached review worktree refusal), `src/instructions.js` (`renderBrief` reads the slice, requirements and decisions from the worktree when it holds the slice file). Create `test/review-worktree.test.js`.

- [ ] **Step 1: Failing tests**: the two tests above. The first moves a review worktree with `git checkout --detach <sha>` and runs `build verdict --worktree`. The second amends Done when 1 in the worktree's slice file only, and the brief quotes the amended text; it also amends there a requirement and a decision the slice cites, and the brief quotes those.
- [ ] **Step 2: Implement**; run `node --test test/review-worktree.test.js test/instructions.test.js` → PASS.
- [ ] **Step 3: Commit** `fix(P3/S-33): the review worktree on a detached head, and the brief read from the worktree`.

### Task 3: CI runs

**Files:** Modify `src/adapters/githost/gh-json.js` (`reduceRuns`' group key and newest pick, and one choice of the decided slicekit run that both hosts call), `src/adapters/githost/github.js` (`RUN_FIELDS` and `SLICEKIT_RUN_FIELDS` gain `workflowDatabaseId` and `startedAt`, and `slicekitRun` views runs newest first until one is decided), `src/adapters/githost/fixture.js` (the same choice over `ci-<sha>.json` and `jobs-<id>.json`), `src/cli/ci.js` (the header comment). Create `test/ci-runs-host.test.js` and `test/github-slicekit-run.test.js`; add to `test/ci-runs.test.js` and `test/ci-bookkeeping-walk.test.js`.

- [ ] **Step 1: Failing tests**: the six tests above. `github-slicekit-run.test.js` records each `exec` call and answers from canned JSON, as `test/ready-label.test.js` does.
- [ ] **Step 2: Implement**; run `node --test test/ci-runs.test.js test/ci-runs-host.test.js test/ci-bookkeeping-walk.test.js test/github-slicekit-run.test.js test/ready-label.test.js test/sync.test.js` → PASS.
- [ ] **Step 3: Commit** `fix(P3/S-33): CI runs grouped by workflow id, ordered by start, and the walk past a run in progress`.

### Task 4: The test split without a hook

**Files:** Split `test/commands/review.test.js` and `test/commands/review-loop.test.js` into three files each, with their shared setup in `test/helpers/review-fixture.js`. Delete `scripts/test-parts-hook.js`, `scripts/test-parts-loader.js` and `scripts/test-parts-wrapper.js`. Modify `scripts/test-shard.js` (no `SPLIT`, no `--import` of the hook; weights for the six files, about a third of each old weight) and `test/test-shard.test.js`. <!-- slicekit:example -->

- [ ] **Step 1: Failing test**: `every test file runs whole in exactly one shard`. Across shards 1/3 to 3/3 every file appears once and no shard is given a file part. It fails while `SPLIT` exists.
- [ ] **Step 2: Implement**. Compare the sorted list of test names over the six new files with the two old files' list: it must be the same.
- [ ] **Step 3: Run** `SLICEKIT_SHARD=1/3 npm run test:shard`, `2/3` and `3/3`, then `npm run test:shard` unset, and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 4: Commit** `test(P3/S-33): split the two review test files and drop the parts hook`.
