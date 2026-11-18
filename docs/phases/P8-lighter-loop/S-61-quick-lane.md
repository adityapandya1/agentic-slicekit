---
slice: P8/S-61
name: Quick lane
repo: .
group: D
runbook: no
requirements: [REQ-2.5, REQ-1.5, REQ-3.7, REQ-2.6, REQ-5.8]
decisions: [D-103, D-101, D-102, D-97]
---

## Done when

1. `parseSliceFile` reads an optional front-matter field `lane` whose one allowed value is `quick`; any other value is a slice-file error naming the field. A slice file without it parses as before (REQ-1.5, D-103).
2. The `lane` rule reports a slice marked `lane: quick` whose Expected changes name a path under `src/`, `bin/` or `templates/`, and, on that slice's branch, one whose changes against the default branch reach one of those folders, each finding naming the slice and the path. The scenario of REQ-1.5 (`lane: quick`, a branch that changes `src/init.js`) passes as written; a slice with no lane is never a finding (REQ-3.7, D-103).
3. A quick slice has one in-loop review round: `build verdict` on its round one with a blocker sets `changes-requested`, prints what is stuck and names no second in-loop round, and the scenario of REQ-2.5 passes as written; the independent review of REQ-2.8 is still required before `ready`. A slice with no lane keeps two rounds (REQ-2.6, REQ-2.5).
4. The plan procedure says a quick slice gets one combined plan step, its slice file written and merged in one `[plan]` pull request, and when the plan may mark a slice quick; the build procedure says a quick slice has one in-loop round. Both are printed by `slicekit instructions --command plan` and `--command build` (REQ-2.5, D-103).
5. `docs/guide/rules/lane.md` exists and the index's Check rules table links it; the pages of P8/S-59 and P8/S-60 say what those slices changed: `commands/review.md` and `slash/review.md` the independent round budget, `commands/build.md` and `slash/build.md` amendments and freezing by name, `commands/hook.md` the pre-edit rules, `rules/frozen.md` the per-test finding. `node scripts/guide-html.js --check` exits 0 and `slicekit check` gives `0 findings` (REQ-5.8, D-97, D-101, D-102). <!-- slicekit:pending P8/S-61 -->

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `slicefile.test.js » lane quick is read and another lane value is refused` | negative | REQ-1.5 |
| `check/lane.test.js » a quick slice whose branch changes a file under src is a finding naming the path` | negative | REQ-3.7 |
| `check/lane.test.js » a quick slice that expects only docs is no finding` | happy | REQ-3.7 |
| `lane-rounds.test.js » a quick slice's round-one blocker stops the loop with no second reviewer` | negative | REQ-2.6 |
| `lane-rounds.test.js » a slice with no lane keeps two in-loop rounds` | happy | REQ-2.6 |
| `instructions.test.js » the plan procedure describes the quick lane's combined plan step` | happy | REQ-2.5 |
| `user-guide.test.js » the lane rule has a page and the review page names the independent round budget` | happy | REQ-5.8 |

## Expected changes

`src/slicefile.js`, `src/check/rules/lane.js`, `src/build/verdict.js`, `templates/instructions/commands/plan.md`, `templates/instructions/commands/build.md`, `docs/guide/rules/lane.md`, `docs/guide/README.md`, `docs/guide/commands/review.md`, `docs/guide/slash/review.md`, `docs/guide/commands/build.md`, `docs/guide/slash/build.md`, `docs/guide/commands/hook.md`, `docs/guide/rules/frozen.md`, `docs/guide/slicekit-guide.html`, tests.

## Tasks

### Task 1: The field and the rule

**Files:** Create `src/check/rules/lane.js`, `test/check/lane.test.js`. Modify `src/slicefile.js`, `test/slicefile.test.js`.

- [ ] **Step 1: Failing tests** — the `slicefile.test.js` and two `test/check/lane.test.js` tests above. <!-- slicekit:pending P8/S-61 -->
- [ ] **Step 2: Run** `node --test test/slicefile.test.js test/check/lane.test.js` → FAIL.
- [ ] **Step 3: Implement** the field and the rule, which is blocking and not a ratchet; the branch's changes are read from git objects, as the `frozen` rule reads them.
- [ ] **Step 4: Run** the same and `node --test test/check/` → PASS.
- [ ] **Step 5: Commit** `feat(check): the lane rule`.

### Task 2: One in-loop round for a quick slice

**Files:** Create `test/lane-rounds.test.js`. Modify `src/build/verdict.js`.

- [ ] **Step 1: Failing tests** — the two `lane-rounds.test.js` tests above.
- [ ] **Step 2: Run** `node --test test/lane-rounds.test.js` → FAIL.
- [ ] **Step 3: Implement** the in-loop round count from the slice's lane, in every place `LOOP_ROUNDS` is read.
- [ ] **Step 4: Run** the same, `node --test test/commands/review-loop-1.test.js test/commands/review-loop-2.test.js test/commands/review-loop-3.test.js test/review-budget.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(build): one in-loop round for a quick slice`.

### Task 3: The procedures and the pages

**Files:** Create `docs/guide/rules/lane.md`. Modify `templates/instructions/commands/plan.md`, `templates/instructions/commands/build.md`, `docs/guide/README.md`, the six pages of Done when 5, `docs/guide/slicekit-guide.html`, `test/instructions.test.js`, `test/user-guide.test.js`.

- [ ] **Step 1: Failing tests** — the `instructions.test.js` and `user-guide.test.js` tests above.
- [ ] **Step 2: Run** `node --test test/instructions.test.js test/user-guide.test.js` → FAIL.
- [ ] **Step 3: Implement** the procedure lines and the pages; run `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `docs: the quick lane, the review budget and freezing by name in the guide`.

## Notes

S-61 itself changes `src/` and `templates/`, so it is not a quick slice. `docs/guide/rules/lane.md` is a new document under the docs root; after P8/S-60 the pre-edit guard allows it because Expected changes names it. <!-- slicekit:pending P8/S-61 -->
