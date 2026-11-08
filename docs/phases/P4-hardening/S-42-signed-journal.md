---
slice: P4/S-42
name: The journal is tied to signed commits
repo: .
group: I
runbook: yes
requirements: [REQ-3.8]
decisions: [D-32, D-36, D-71, D-89]
---

## Done when

1. C-1 gains `getCommit(sha) → {verified, signer}` and `getRun(id) → {workflow, headSha, actor, conclusion}`, in `github.js` through `gh api` and in `fixture.js` (REQ-3.8).
2. Under `--ci`, the journal rule fails naming each commit of the pull request that changes a journal file and whose signature the host does not verify, with "journal commits must be signed" (REQ-3.8, D-71).
3. Under `--ci`, the rule recomputes each line `.slicekit/journal-heads.log` gains from git and `getRun`, the same function the sync job writes with, and fails naming the line when one differs, when the file is not append-only against the default branch, or when a pull request that is not a sync pull request changes it; outside CI it adds nothing to what it checks today (REQ-3.8, D-89). <!-- slicekit:example -->
4. The sync job adds one line per journal file changed by the merge to `.slicekit/journal-heads.log` in its pull request: the file, its last hash, the merge commit, and the run id, workflow and actor from the run's environment (REQ-3.8). <!-- slicekit:example -->
5. The header of `src/journal.js` says the chain has no key and the actor field proves nothing; `docs/runbook.md` says how to sign commits (REQ-3.8).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `journal.test.js » an unsigned commit that changes a journal file fails the rule in CI` | negative | REQ-3.8 |
| `journal.test.js » a signed commit that changes a journal file passes` | happy | REQ-3.8 |
| `journal.test.js » outside CI the rule does not read signatures` | happy | REQ-3.8 |
| `journal.test.js » a journal-heads line that differs from the recomputed line fails in CI` | negative | REQ-3.8 |
| `journal.test.js » a journal-heads change from a pull request that is not a sync pull request fails in CI` | negative | REQ-3.8 |
| `workflow.test.js » the sync job writes a journal-heads line per changed journal file` | happy | REQ-3.8 |

## Expected changes

`src/check/rules/journal.js`, `src/journal.js`, `src/cli/journal.js`, `src/cli/index.js`, `src/adapters/githost/github.js`, `src/adapters/githost/fixture.js`, `src/workflow.js`, `.github/workflows/slicekit.yml`, `test/fixtures/golden/workflow/`, `docs/runbook.md`, tests.

## Tasks

### Task 1: getCommit and the rule

**Files:** Modify `src/adapters/githost/github.js`, `src/adapters/githost/fixture.js`, `src/check/rules/journal.js`, `src/journal.js`, `test/journal.test.js`.

- [ ] **Step 1: Failing tests** — the five journal tests above.
- [ ] **Step 2: Implement**; the commits are `git log --format=%H <merge base>..HEAD -- .slicekit/journal`.
- [ ] **Step 3: Run** `node --test test/journal.test.js` → PASS.

### Task 2: journal-heads in the sync pull request

**Files:** Modify `src/workflow.js`, `test/workflow.test.js`, `test/fixtures/golden/workflow/`, `.github/workflows/slicekit.yml`, `docs/runbook.md`.

- [ ] **Step 1: Failing test** — the workflow test above.
- [ ] **Step 2: Implement** as a `slicekit journal heads <merge sha>` step before the sync commit; regenerate the kit's workflow.
- [ ] **Step 3: Run** `node --test test/workflow.test.js` → PASS; `node bin/slicekit.js workflow --check` → no drift.
- [ ] **Step 4: Commit** `feat(journal): journal commits are signed; the sync pull request records each journal's last hash`.
