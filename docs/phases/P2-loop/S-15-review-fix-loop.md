---
slice: P2/S-15
name: Reviewer, fixer, the loop cap, should-haves
repo: .
group: D
runbook: yes
requirements: [REQ-2.6, REQ-2.11, REQ-2.10, REQ-2.12]
decisions: [D-09, D-18, D-35]
---

## Done when

1. `slicekit build verdict <id> <file>` refuses a verdict with any shape problem, moves it into the slice worktree as `.slicekit/reviews/P<n>-S-<nn>-r<k>.md`, commits it, records `in-review`, and prints the next step: `fix`, `ask`, `ci` or `stuck` (REQ-2.11, REQ-2.6 step 6).
2. At most two in-loop rounds: a blocker that survives round two records `changes-requested`, the pull request stays draft and its "Reviewer blocked" line names the blocker, and a third in-loop verdict is refused (step 7, D-18).
3. `build decline <id> <H-n>` opens one tracker issue titled `[P<n>/S-<nn>] H-<n>: <what is wrong>` with the verdict excerpt through C-2 and lists it under "Should-haves declined" (step 8, D-09).
4. `build finish <id>` marks the pull request ready for review, waits for CI on the head, puts the run link in "Proof" and records `ci-green` on success (step 9).
5. The reviewer and fixer briefs and the build procedure's steps 6 to 9 pass the brief lint.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/review-loop.test.js » each round writes a verdict file` | happy | REQ-2.11 |
| `commands/review-loop.test.js » a blocker that survives round two stops at changes-requested` | negative | REQ-2.6 |
| `commands/review-loop.test.js » a verdict with a finding not verified is refused` | negative | REQ-2.11 |
| `commands/review-loop.test.js » a third in-loop verdict is refused` | negative | REQ-2.6 |
| `commands/review-loop.test.js » a declined should-have becomes one issue and a body line` | happy | REQ-2.6 |
| `commands/review-loop.test.js » finish records ci-green only when CI succeeds on the head` | negative | REQ-2.6 |
| `tracker.test.js » the fixture tracker opens, finds and comments` | happy | REQ-2.6 |
| `commands/review-loop.test.js » the reviewer, fixer and build briefs pass the brief lint` | happy | REQ-2.12 |

## Expected changes

`src/build/{verdict,decline,finish}.js`, `src/cli/build.js`, `src/adapters/tracker/`, `src/adapters/githost/github.js`, `docs/spec/contracts/C-2-tracker.md`, `docs/adapters.md`, `docs/runbook.md`, `templates/instructions/commands/build.md`, `templates/instructions/agents/{reviewer,fixer}.md`, tests.

## Tasks

### Task 1: The tracker adapter (C-2)

**Files:** Create `src/adapters/tracker/{index,github-issues,fixture}.js`, `test/tracker.test.js`, `test/fixtures/tracker/issues.json`. Modify `src/adapters/githost/github.js` (export `gh`), `docs/spec/contracts/C-2-tracker.md`, `docs/adapters.md`, `docs/runbook.md`.

**Interfaces:**
- `getTracker(cfg, env = process.env, root = process.cwd())`: `SLICEKIT_TRACKER_FIXTURE` set → `fixtureTracker(dir)`; `cfg.tracker.kind === 'github-issues'` → `githubIssues(env, root)`; else `TrackerError('unsupported tracker: <kind>')`.
- Three operations on both: `open({title, body, labels = [], slice}) → {id, url}`; `comment(id, body)`; `find(slice, finding) → {id, url} | null`, the issue whose title begins `[<slice>] <finding>:`. None closes an issue.
- GitHub: `gh issue create --title <t> --body-file - [--label <l>]…` (the id is the number in the printed URL's `/issues/<n>`); `gh issue comment <n> --body-file -`; `gh issue list --state all --search "<slice> <finding> in:title" --json number,url,title --limit 50`, then the title test above. Spawned through `gh` from `src/adapters/githost/github.js`, exported for this.
- Fixture: `issues.json` holds `[{number, url, title, body, labels, comments}]`; `open` appends one with `url` `https://example.test/issues/<n>` and is refused when `issue-create-error.txt` exists; `comment` appends to `comments`; each write appends `{op, …input}` to `issue-calls.jsonl`.

- [ ] **Step 1: Failing test** — `the fixture tracker opens, finds and comments`: on a temp copy of `test/fixtures/tracker/`, `open` returns id 1 and its URL, `find('P2/S-15', 'H-1')` finds it, `find('P2/S-15', 'H-2')` is null, `comment` adds one comment, and `issue-calls.jsonl` has two lines. Also `the GitHub tracker reads the number from the url` through the `exec` seam. <!-- slicekit:pending P2/S-15 -->
- [ ] **Step 2: Run** `node --test test/tracker.test.js` → FAIL.
- [ ] **Step 3: Implement.** Remove the pending marker from C-2's producer line and from the tracker paragraph of `docs/adapters.md`, and describe the adapter there; under "Dependencies and their owners" in `docs/runbook.md`, add that declined should-haves become GitHub issues through `gh`, which needs permission to open issues in the repository.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(tracker): GitHub Issues behind C-2`.

### Task 2: `build verdict`

**Files:** Create `src/build/verdict.js`, `test/commands/review-loop.test.js`. Modify `src/cli/build.js`.

**Interfaces:**
- Consumes: `parseVerdict`, `verdictProblems` (`src/verdict.js`); `findWorktree`, `recordState`, `commitBookkeeping` (S-14); `pushBranch` (S-09).
- `recordVerdict(root, cfg, host, id, file, {worktree, independent = false}) → {round, blockers, shouldHaves, roundsUsed, next}`. Refusals, nothing moved or recorded: any `verdictProblems` → code 1, one line `verdict <file>: <problem>` each; a file name other than `<P-S>-r<k>.md` for this slice → code 2 `a verdict of <id> is named <P-S>-r<k>.md`; `k` other than the slice's verdict count plus one → code 1 `the next verdict of <id> is round <k'>, not <k>`.
- Then: moves the file into `<worktree>/.slicekit/reviews/<name>`, commits it with `commitBookkeeping(wt, id, 'verdict r<k>', …)`, records `in-review` with `{verdict: {round: k, path, blockers, independent}}`, and pushes.
- `roundsUsed` counts the slice's verdicts with `independent` false; `blockers` and `shouldHaves` are the `B-` and `H-` IDs. `next`: blockers and `roundsUsed < 2` → `fix`; no blockers and should-haves → `ask`; neither → `ci`. (Task 3 adds `stuck`.)
- CLI `build verdict <id> <file> [--worktree <p>]` prints `next: <step>`, then `blockers: <ids or none>`, `should-haves: <ids or none>`, `rounds: <used> of 2`; on `ask` with `roundsUsed` 2 it adds `fix: not available after round 2; decline or leave for the independent review`.

- [ ] **Step 1: Failing tests** — `each round writes a verdict file`: a slice at `draft-pr` (built with S-14's steps against the fixture host) and a round-1 `BLOCK` verdict with `B-1` written to the session root → exit 0, `next: fix`, the file now at `<worktree>/.slicekit/reviews/P1-S-01-r1.md` and gone from the session root, a bookkeeping commit adding it, and the state `in-review` with one verdict; after a fix push (`build commit`, `build pr`) a round-2 `APPROVE` → `next: ci` and `P1-S-01-r2.md` exists. `a verdict with a finding not verified is refused`: a finding whose "How verified" cell is empty → exit 1 with `verdict <file>: finding B-1 has no "how verified"`, the file not moved, the state unchanged.
- [ ] **Step 2: Run** `node --test test/commands/review-loop.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(build): verdict: record a review round and say what comes next`.

### Task 3: The two-round cap and "Reviewer blocked"

**Files:** Modify `src/build/verdict.js`, `test/commands/review-loop.test.js`.

**Interfaces:**
- Consumes (S-09): `getSection`, `setSection`; C-1 `getPullRequest`, `updatePullRequestBody`.
- Before anything moves: a verdict with `independent` false when `roundsUsed` is already 2 → code 1 `two review rounds used; the loop stopped (D-18)`.
- After recording: blockers and `roundsUsed` 2 → records `changes-requested`, `next: stuck`, exit 1 with `stopped: <ids> survive round 2; the pull request stays draft`.
- `reviewerBlocked(verdicts) → string` over the slice's verdict files in round order: each blocker ID of an earlier round absent from the latest → `<ID> <what is wrong> — fixed in round <k>`; on `stuck`, each latest blocker → `<ID> <what is wrong> — not fixed after round 2`; joined by `; `; none → `nothing`. After every verdict the pull request body's "Reviewer blocked" is set to it when it changed.

- [ ] **Step 1: Failing tests** — `a blocker that survives round two stops at changes-requested`: rounds 1 and 2 both `BLOCK` with `B-1` → round 2 exits 1 with `stopped: B-1 survive round 2`, the state is `changes-requested`, the fixture pull request is still a draft, and its body's "Reviewer blocked" holds `B-1` and `not fixed after round 2`. `a third in-loop verdict is refused`: a round-3 file → exit 1 with `two review rounds used`, no file moved, no state change. Also `a blocker fixed in round 2 is named as fixed`: round 1 `B-1`, round 2 `APPROVE` → `B-1 <what> — fixed in round 2`.
- [ ] **Step 2: Run** `node --test test/commands/review-loop.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(build): two review rounds, then stop with the blocker named`.

### Task 4: `build decline` and `build finish`

**Files:** Create `src/build/decline.js`, `src/build/finish.js`. Modify `src/cli/build.js`, `test/commands/review-loop.test.js`.

**Interfaces:**
- Consumes: `getTracker` (Task 1); C-1 `markReady`, `ciStatus`, `getPullRequest`, `updatePullRequestBody`; `recordState`.
- `declineFinding(root, cfg, host, tracker, id, finding, {worktree}) → {url, created}`: `finding` must be an `H-<n>` of the latest verdict (code 2 `<finding> is not a should-have of round <k>`); `tracker.find(id, finding)` returns the open issue when there is one; else `tracker.open({title: '[<id>] <finding>: <what is wrong>', body: <the finding's what, why and how verified, then "Verdict: <path> at <headSha>">, slice: id})`. The issue URL is added to "Should-haves declined" (replacing `none`) when not already there.
- `finish(root, cfg, host, id, {worktree, wait = 600, interval = 15, sleep}) → {ci}`: the latest verdict on the head must have no blockers (code 1 `<id> has open blockers; finish needs a clean verdict`); `markReady` when the pull request is a draft; polls `ciStatus(state.pr.headSha)` every `interval` seconds for up to `wait`: `success` → "Proof"'s `CI: pending` becomes `CI: <run url>`, records `ci-green` with `{ci: {status: 'success', sha}}`, pushes; `failure` → code 1 `CI failed on <sha7>: <url>`; still `pending` or `unknown` → code 1 `CI still running on <sha7>; run slicekit build finish <id> again`.
- CLI `build decline <id> <H-n> [--worktree <p>]` prints the issue URL (and `(already open)` when found); `build finish <id> [--wait <s>] [--worktree <p>]` prints `ci-green`, then the run URL. `subcommands` gains `verdict`, `decline`, `finish`.

- [ ] **Step 1: Failing tests** — `a declined should-have becomes one issue and a body line`: an `APPROVE` verdict with `H-1`; `build decline P1/S-01 H-1` twice → one `open` in `issue-calls.jsonl`, the title `[P1/S-01] H-1: <what>`, the body holding the verdict path, the second run printing `(already open)`, and "Should-haves declined" holding the URL once. `finish records ci-green only when CI succeeds on the head`: with `ci-<head>.json` failed → exit 1, state `in-review`; pending with `--wait 0` → exit 1 `CI still running`; success → `ci-green`, the fixture pull request no longer a draft, and "Proof" holding the run URL.
- [ ] **Step 2: Run** `node --test test/commands/review-loop.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(build): decline should-haves as issues; finish on green CI`.

### Task 5: The reviewer and fixer briefs, and steps 6 to 9

**Files:** Modify `templates/instructions/agents/reviewer.md`, `templates/instructions/agents/fixer.md`, `templates/instructions/commands/build.md`, `test/commands/review-loop.test.js`.

**Interfaces:**
- Consumes (S-09): `briefProblems`; `{{cli}} instructions reviewer`, `{{cli}} instructions fixer`.
- Reviewer brief gains `## Reviewing a slice`: the command gives the pull request number, the worktree, the round `k` and the verdict path; read the slice file, the change (`git diff <base>...HEAD` in the worktree, read only) and the pull request body; run the test command and `slicekit check` and quote their summary lines as "how verified"; a blocker is a Done-when check that fails, a REQ or D row the change breaks, a weakened rule or a raised baseline (REQ-3.7), a writing-rule breach in the body; everything else is a should-have; a finding that survives keeps its ID across rounds; no praise, no questions, no code.
- Fixer brief gains `## Fixing findings`: the command gives the verdict path and the finding IDs to answer; change code only for those; no new feature, no test the verdict did not ask for, no frozen test; report one line `<ID>: <what changed> (<file>)` per finding, then the `ran:` lines.
- Procedure steps 6 to 9: (6) `{{cli}} instructions reviewer <id>`, spawn the reviewer with it, the pull request number, the worktree, the round and the verdict path `.slicekit/reviews/P<n>-S-<nn>-r<k>.md`, then `{{cli}} build verdict <id> <path>`; (7) on `next: fix`, first ask about the should-haves (step 8), then spawn the fixer with `{{cli}} instructions fixer <id>`, the verdict path and the IDs, then `{{cli}} build commit <id> --message "fix: <ids>" --require-green` and `{{cli}} build pr <id> --notes <file>` (the same pull request), and go back to 6; on `next: stuck`, print the output and stop; (8) on `next: ask`, or with should-haves beside blockers, ask the human once, listing every should-have, fix or decline each; each decline is `{{cli}} build decline <id> <H-n>`; fixes go to the fixer with the blockers, and no fix is offered after round 2; (9) on `next: ci`, `{{cli}} build finish <id>`, print the result and stop: a human merges, and `/slicekit review` in a new session gives the independent verdict (S-16).

- [ ] **Step 1: Failing test** — `the reviewer, fixer and build briefs pass the brief lint`: `briefProblems` is `[]` for all three; the procedure names `build verdict`, `build decline`, `build finish`, `next: stuck` and `next: ask`; the reviewer brief holds `Verdict: BLOCK|CHANGES|APPROVE` and `How verified`; the fixer brief holds `no test the verdict did not ask for`.
- [ ] **Step 2: Run** `node --test test/commands/review-loop.test.js` → FAIL.
- [ ] **Step 3: Write** the brief sections and steps 6 to 9.
- [ ] **Step 4: Run** the same, `node --test test/briefs.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(build): the review loop, steps 6 to 9`.
