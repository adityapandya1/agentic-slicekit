---
slice: P2/S-27
name: Faster git hooks, and the Windows test time
repo: .
group: H
runbook: no
requirements: [REQ-3.9]
decisions: [D-42]
---

## Done when

1. The protected-branch check every slicekit git hook carries reads `.slicekit/config.json` with shell built-ins only (`read` and `case`) when the branch can be decided from the file's text: a branch other than `main` whose quoted name does not appear in the file, in a file holding no `\u` escape, is not protected, and no `node` runs. Every other case (the branch is `main`, its quoted name appears, the file holds a `\u` escape, or the branch name holds a `"`) reads the file with `node` as before. The block stays byte for byte the same in all three hooks.
2. `prepare-commit-msg` finds the slice from the branch the check already read, with shell built-ins instead of `git symbolic-ref` and `sed`, and stamps the same `Slice: P<n>/S-<nn>` as before; a branch the check did not read (under `ALLOW_PROTECTED_COMMIT=1`) is read once.
3. What the hooks refuse and stamp does not change: every test in `test/githooks.test.js` passes unchanged, and new tests pin the fast path: a commit on a slice branch the config does not name starts no `node` (a stand-in `node` first on `PATH` leaves a mark when it runs) and is stamped; a branch listed in `protectedBranches` is still refused; a config naming the branch only through a `\u` escape still refuses it.
4. On Windows the hooked commit costs at most half what it cost before, measured by the timing test of Task 2 as the median of five commits with the hooks against five without, printed and not asserted (machines differ); the slice's Proof gives the numbers before and after, and the Windows `cmd-test` time of the slice's CI run against the 40.7 minutes of main's last run before it (D-42).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `githooks.test.js » a commit on a slice branch the config does not name starts no node and is stamped` | happy | REQ-3.9 |
| `githooks.test.js » a branch listed in protectedBranches is still refused` | negative | REQ-3.9 |
| `githooks.test.js » a branch named only through a \u escape in the config is still refused` | negative | REQ-3.9 |
| `githooks.test.js » every hook carries the same protected-branch check` | happy | REQ-3.9 |
| `githooks-time.test.js » a hooked commit and a plain commit are timed and printed` | happy | REQ-3.9 |

## Expected changes

`templates/githooks/`, `.githooks/`, `test/githooks.test.js`, `test/githooks-time.test.js`, tests.

## Tasks

### Task 1: The fast path in the protected-branch check

**Files:** Modify `templates/githooks/pre-commit`, `templates/githooks/pre-merge-commit`, `templates/githooks/prepare-commit-msg`, `test/githooks.test.js`. Re-render `.githooks/` with `node bin/slicekit.js update --yes`.

- [ ] **Step 1: Failing tests** — the three new `githooks.test.js` tests. The fast-path test puts a stand-in `node` first on `PATH` that writes a mark file and exits 1, and asserts the mark is absent afterwards.
- [ ] **Step 2: Run** `node --test test/githooks.test.js` → FAIL.
- [ ] **Step 3: Implement** the check of Done when 1 in all three hooks, identical.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `perf(githooks): decide the protected branch without node when the config's text settles it`.

### Task 2: The slice stamp without a second branch read, and the measurement

**Files:** Modify `templates/githooks/prepare-commit-msg`. Create `test/githooks-time.test.js`.

- [ ] **Step 1: Failing test** — the timing test prints `hooked <ms> plain <ms>` and asserts only that both ran.
- [ ] **Step 2: Implement** Done when 2.
- [ ] **Step 3: Run** `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`; note the timings for Proof.
- [ ] **Step 4: Commit** `perf(githooks): stamp the slice from the branch already read`.
