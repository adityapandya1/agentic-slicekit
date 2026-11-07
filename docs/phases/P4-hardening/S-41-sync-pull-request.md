---
slice: P4/S-41
name: The sync job opens a pull request
repo: .
group: H
runbook: yes
requirements: [REQ-3.11]
decisions: [D-12, D-78, D-80]
---

## Done when

1. `slicekit sync open` pushes the state, `BUILD.md` and `.slicekit/journal-heads.log` change to `sync/<short sha of the merge commit>`, opens a pull request titled `[sync] state after <short sha>` with a Done when, Proof and Decisions body through C-1 `openPullRequest`, then starts the workflow on that branch through a new C-1 operation `dispatchWorkflow` (REQ-3.11, D-78, D-80). <!-- slicekit:example -->
2. The generated sync job runs `slicekit status --sync --write` then `slicekit sync open`; it never pushes to the default branch and never sets `ALLOW_PROTECTED_COMMIT`; its permissions are `contents: write`, `pull-requests: write` and `actions: write` only (REQ-3.11).
3. When nothing changed, `sync open` opens nothing; when a pull request for that sync branch is open, it opens no second one (REQ-3.11).
4. The workflow accepts `workflow_dispatch`; in a dispatched run, `check --ci` reads the title and body of the open pull request for the branch through `pullRequestForBranch`, and the ci-title and ci-body rules accept a `[sync]` title with a Done when, Proof and Decisions body (REQ-3.11).
5. The kit's own `.github/workflows/slicekit.yml` is regenerated with `slicekit workflow --write`, and `workflow --check` passes (REQ-3.11).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `sync.test.js » sync open pushes a sync branch, opens a [sync] pull request and dispatches the workflow` | happy | REQ-3.11 |
| `sync.test.js » sync open opens nothing when nothing changed or a sync pull request is open` | negative | REQ-3.11 |
| `workflow.test.js » the sync job never pushes to the default branch or sets ALLOW_PROTECTED_COMMIT` | negative | REQ-3.11 |
| `check/ci-title.test.js » a dispatched run on a sync branch reads its pull request and accepts a [sync] title` | happy | REQ-3.11 |
| `check/ci-body.test.js » a [sync] body without Proof fails` | negative | REQ-3.11 |

Amendment, `test/sync.test.js`: the body-section regex in the happy test was written in a template literal that drops its backslashes, so it threw "Nothing to repeat"; the backslashes are doubled. The test's name and what it asserts stay the same.

## Expected changes

`src/cli/sync.js`, `src/cli/index.js`, `src/state/sync.js`, `src/adapters/githost/github.js`, `src/adapters/githost/fixture.js`, `src/check/ci-event.js`, `src/workflow.js`, `.github/workflows/slicekit.yml`, `test/fixtures/golden/workflow/`, `docs/runbook.md`, tests.

## Tasks

### Task 1: sync open

**Files:** Create `src/cli/sync.js`. Modify `src/cli/index.js`, `src/state/sync.js`, `src/adapters/githost/github.js`, `src/adapters/githost/fixture.js`, `test/sync.test.js`.

- [ ] **Step 1: Failing tests** — the two sync tests above.
- [ ] **Step 2: Implement** `dispatchWorkflow(file, ref)` as `gh workflow run <file> --ref <ref>`; `sync open` commits with `ALLOW_PROTECTED_COMMIT` unset on the new branch, pushes it, and calls `openPullRequest` and `dispatchWorkflow`.
- [ ] **Step 3: Run** `node --test test/sync.test.js` → PASS.

### Task 2: The workflow and the CI rules

**Files:** Modify `src/workflow.js`, `src/check/ci-event.js`, `test/workflow.test.js`, `test/check/ci-title.test.js`, `test/check/ci-body.test.js`, `test/fixtures/golden/workflow/`, `.github/workflows/slicekit.yml`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the other three tests above.
- [ ] **Step 2: Implement**; `node bin/slicekit.js workflow --write`.
- [ ] **Step 3: Run** `node --test test/workflow.test.js test/check/ci-title.test.js test/check/ci-body.test.js` → PASS; `node bin/slicekit.js workflow --check` → no drift.
- [ ] **Step 4: Commit** `feat(workflow): the sync job opens a [sync] pull request and dispatches its checks`.
