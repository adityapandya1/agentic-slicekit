---
slice: P5/S-50
name: Examples follow the version, and the review leftovers of Phase 5
repo: .
group: D
runbook: yes
requirements: [REQ-5.5, REQ-5.6, REQ-2.9, REQ-2.14]
decisions: [D-90, D-93, D-94, D-95]
---

## Done when

1. When a sync sets a version it re-renders each folder under `examples/` that holds rendered files, as `update --yes` would in that folder, and its pull request carries those files; `check --ci` on a sync pull request accepts an example file only where it equals a fresh render at that version, and any other change to it is one finding naming the file. The kit's own examples are rendered at the version `package.json` holds, so `test/examples.test.js` passes on the default branch (REQ-5.5, D-95).
2. `branch release <slug>` asks the git host about every existing `release/<slug>-<n>` branch as well as `release/<slug>`: an open pull request on any of them refuses, naming the pull request and its branch, and no further slug is named (issue #152, REQ-2.9).
3. The line `audit context` prints for the candidates it does not show names a command that prints them and reserves no report file: `audit context <area> --all` given with `--no-report` prints the context alone, and the line names that form with the kit's command prefix (issue #157, REQ-2.14).
4. With the migrated config as the only uncommitted change, `slicekit branch` switches to a branch that already holds the migrated config by dropping its own copy of the change first, where the two contents are equal, and refuses with one line naming the two files' difference where they are not (issue #162, D-94). The release procedure's `pr open` step names the config in its paths when the release branch carries a migrated config, so it is committed there (issue #164, D-94). The guide's `branch` page says what D-93 and D-94 say about a migrated config (issue #163, REQ-5.6).
5. The runbook says that a sync re-renders the examples and what a finding on an example file in a sync pull request means; `slicekit check` gives `0 findings` (REQ-5.5, D-95).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `release-version-examples.test.js » a sync that sets a version re-renders each example at it` | happy | REQ-5.5 |
| `release-version-examples.test.js » a sync pull request whose example file differs from a fresh render fails, naming the file` | negative | REQ-5.5 |
| `commands/release.test.js » branch release refuses when a numbered release branch has an open pull request` | negative | REQ-2.9 |
| `ops-audit-units.test.js » audit context with --all and --no-report prints every candidate and reserves no report` | happy | REQ-2.14 |
| `cli.test.js » branch drops a migrated config that the target branch already holds, and refuses one that differs` | negative | REQ-5.6 |
| `briefs.test.js » the release procedure commits a carried config` | happy | REQ-2.9 |

## Expected changes

`src/release-version.js`, `src/state/sync.js`, `src/check/rules/sync-release.js`, `src/cli/branch.js`, `src/cli/audit.js`, `src/audit.js`, `templates/instructions/commands/release.md`, `templates/instructions/commands/audit.md`, `docs/guide/commands/branch.md`, `docs/guide/commands/audit.md`, `docs/guide/README.md`, `docs/runbook.md`, `examples/fullstack/`, `examples/data/`, tests.

## Tasks

### Task 1: The sync re-renders the examples

**Files:** Create `test/release-version-examples.test.js`. Modify `src/release-version.js`, `src/state/sync.js`, `src/check/rules/sync-release.js`, `docs/runbook.md`, `examples/fullstack/`, `examples/data/`.

- [ ] **Step 1: Failing tests** — the two `release-version-examples.test.js` tests above, on a fixture repository that holds an example with rendered files, with a fixture host; no test reaches the network.
- [ ] **Step 2: Run** `node --test test/release-version-examples.test.js` → FAIL.
- [ ] **Step 3: Implement** in `applyRelease`: after the kit's own files, each folder under `examples/` that holds a rendered directory is rendered at the new version with the code `update --yes` uses; `syncPaths` carries what changed there; the sync-release rule recomputes with the same function. Then render the kit's two examples at the version `package.json` holds.
- [ ] **Step 4: Run** the same, `node --test test/examples.test.js test/release-version.test.js test/release-version-order.test.js` → PASS.
- [ ] **Step 5: Commit** `fix(release): a sync re-renders the examples at the version it sets`.

### Task 2: The release branch and its open pull request

**Files:** Modify `src/cli/branch.js`, `templates/instructions/commands/release.md`, `test/commands/release.test.js`, `test/briefs.test.js`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the test this slice adds to `test/commands/release.test.js` and the one it adds to `test/briefs.test.js`.
- [ ] **Step 2: Run** `node --test test/commands/release.test.js test/briefs.test.js` → FAIL.
- [ ] **Step 3: Implement** the host question for each numbered release branch, and the config path in the procedure's `pr open` step.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `fix(release): one open release pull request per phase, and a carried config is committed`.

### Task 3: The migrated config across branches, and the audit hint

**Files:** Modify `src/cli/branch.js`, `src/cli/audit.js`, `src/audit.js`, `templates/instructions/commands/audit.md`, `docs/guide/commands/branch.md`, `docs/guide/commands/audit.md`, `docs/guide/README.md`, `test/cli.test.js`, `test/ops-audit-units.test.js`.

- [ ] **Step 1: Failing tests** — the `cli.test.js` test and the `ops-audit-units.test.js` test above.
- [ ] **Step 2: Run** `node --test test/cli.test.js test/ops-audit-units.test.js` → FAIL.
- [ ] **Step 3: Implement** the comparison before the switch, the `--no-report` option and the hint line; bring the two guide pages and the index in step.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `fix: a migrated config across branches, and the audit hint reserves no report`.
