---
slice: P5/S-49
name: Release version fixes
repo: .
group: S
runbook: no
requirements: [REQ-5.5]
decisions: [D-90, D-92]
---

## Done when

1. A sync sets a version for every merged slice that no `CHANGELOG.md` section on the default branch names and whose own merge did not set the version, whichever merge the sync runs on (D-92). When a slice merges before the sync pull request of a version-setting merge is merged, the later sync sets the next version with a section naming only the later slice; the version-setting slice is not named again and gets no second version (issue #141, REQ-5.5).
2. When a sync pull request that sets a version is merged after a second slice merged, the sync on that merge sets the next version with a section naming the second slice, so no merged slice is left without a version and a changelog line (issue #143, REQ-5.5, D-90).
3. A slice merged before the newest merge that set the version by hand, or before the commit that turned `release.auto` on when there is none, is never named and never counted; a sync with no slice left to version sets no version and adds no section (D-92).
4. `status --sync --write` sets a version only when HEAD is the tip of the default branch. On any other branch or commit it writes the state and `BUILD.md` as before, leaves `package.json`, `CHANGELOG.md` and the rendered files as they were, and prints `version not set: HEAD is not the tip of <default branch>` on stderr (issue #142, REQ-5.5).
5. The amendment line for `test/runbook.test.js` in `docs/phases/P5-ops/S-48-automatic-releases.md` says what the test checks since commit a29f581: the last five changelog versions, and that the newest section equals the version in `package.json` (issue #140). `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `release-version-order.test.js » a slice merged before a version-setting merge's sync is merged gets the next version alone` | happy | REQ-5.5 |
| `release-version-order.test.js » a sync pull request merged after a second slice merged sets a version for that slice` | happy | REQ-5.5 |
| `release-version-order.test.js » a slice the changelog names, or merged before the hand-set version, is not versioned again` | negative | REQ-5.5 |
| `release-version-order.test.js » status --sync --write off the default branch's tip sets no version` | negative | REQ-5.5 |
| `release-version-order.test.js » a sync merge whose slice was already recorded merged is not taken for a hand-set version` | negative | REQ-5.5 |
| `release-version-order.test.js » a sync pull request squash-merged under an edited subject is not taken for a hand-set version` | negative | REQ-5.5 |

Amended (author's standing instruction, 2026-11-15): `test/release-version-order.test.js` gains the test of the last row, the merge order of review B-1 of round 1.

Amended (author's standing instruction, 2026-11-15): `test/release-version-order.test.js` gains the test `a sync pull request squash-merged under an edited subject is not taken for a hand-set version` (negative, REQ-5.5), the merge order of review B-2 of round 2.

## Expected changes

`src/release-version.js`, `src/state/sync.js`, `src/cli/status.js`, `src/check/rules/sync-release.js`, `docs/phases/P5-ops/S-48-automatic-releases.md`, tests.

## Tasks

### Task 1: The changelog is the record

**Files:** Create `test/release-version-order.test.js`. Modify `src/release-version.js`, `src/state/sync.js`, `src/check/rules/sync-release.js`.

- [ ] **Step 1: Failing tests** — the first three tests above, each on a fixture repository with a fixture host (`SLICEKIT_GITHOST_FIXTURE`), built with the helpers `test/release-version.test.js` uses; the merge orders are the ones the independent verdict of P5/S-48 ran (`.slicekit/reviews/P5-S-48i-r3.md`, H-4 and H-6). No test reaches the network.
- [ ] **Step 2: Run** `node --test test/release-version-order.test.js` → FAIL.
- [ ] **Step 3: Implement** in `releaseFor`: the slices to version are the merged slices no changelog section at the merge names, less those whose own merge set the version, less those merged before the floor of D-92. The test on the sync's own merge goes. The sync-release rule recomputes with the same function, so a sync pull request is still judged against what CI computes.
- [ ] **Step 4: Run** the same and `node --test test/release-version.test.js` → PASS; the five tests of P5/S-48 pass unchanged.
- [ ] **Step 5: Commit** `fix(release): a sync versions every merged slice the changelog does not name`.

### Task 2: Only on the default branch's tip

**Files:** Modify `src/cli/status.js`, `test/release-version-order.test.js`.

- [ ] **Step 1: Failing test** — the fourth test above: on a slice branch with `release.auto` true, `status --sync --write` exits 0, prints the stderr line, and `git status --porcelain` lists neither `package.json` nor `CHANGELOG.md`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the guard before `applyRelease`; the sync job runs on the default branch's merge commit, so CI is unchanged.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(release): status --sync --write sets a version only on the default branch's tip`.

### Task 3: The amendment record

**Files:** Modify `docs/phases/P5-ops/S-48-automatic-releases.md`.

- [ ] **Step 1:** Rewrite the one amendment line for `test/runbook.test.js` as Done when 5 says; change nothing else in that file.
- [ ] **Step 2:** `node bin/slicekit.js check` → `0 findings`.
- [ ] **Step 3: Commit** `docs(P5/S-48): the amendment line says what the changelog test checks`.
