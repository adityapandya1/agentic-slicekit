---
slice: P3/S-30
name: CI judged by the newest run of each workflow
repo: .
group: B
runbook: no
requirements: [REQ-2.6]
decisions: []
---

## Done when

1. `reduceRuns` judges a commit by the newest run of each workflow and event: runs are grouped by workflow name and event, and in each group only the run with the latest `createdAt` counts. A run cancelled because a newer run of the same workflow and event replaced it no longer makes the commit fail (issue #33).
2. A newest run that is cancelled, failed or timed out still makes the commit fail, and a newest run still going makes it pending, as before. Runs that carry no workflow name or event fall back to today's rule over all of them.
3. The GitHub adapter asks `gh run list` for `workflowName` and `event` as well, and the fixture host's CI records may carry them; `build finish` and `status --sync` need no other change.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `ci-runs.test.js » a run cancelled by a newer run of the same workflow does not fail the commit` | happy | REQ-2.6 |
| `ci-runs.test.js » the newest run failing or cancelled still fails the commit` | negative | REQ-2.6 |
| `ci-runs.test.js » runs without a workflow name are judged together as before` | happy | REQ-2.6 |

## Expected changes

`src/adapters/githost/gh-json.js`, `src/adapters/githost/github.js`, `test/ci-runs.test.js`, tests.

## Tasks

### Task 1: The newest run per workflow and event

**Files:** Modify `src/adapters/githost/gh-json.js` (reduceRuns), `src/adapters/githost/github.js` (RUN_FIELDS gains workflowName and event). Create `test/ci-runs.test.js`.

- [ ] **Step 1: Failing tests** — the three tests above, calling `reduceRuns` with run lists: a cancelled older run and a successful newer run of the same workflow and event gives `success` with the newer run's url; a newest run `cancelled` or `failure` gives `failure`; runs with no workflowName keep today's result.
- [ ] **Step 2: Implement**; run `node --test test/ci-runs.test.js test/sync.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 3: Commit** `fix(P3/S-30): CI judged by the newest run of each workflow`.
