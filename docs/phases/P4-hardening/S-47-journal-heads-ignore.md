---
slice: P4/S-47
name: Init un-ignores the journal heads log
repo: .
group: K
runbook: no
requirements: [REQ-1.1, REQ-3.8]
decisions: [D-89]
---

## Done when

1. `init` appends a rule that un-ignores `.slicekit/journal-heads.log` after its journal un-ignores, once, and counts the rooted spelling of that rule as already present, so a `*.log` rule no longer makes the sync job's `git add` refuse the heads log (REQ-1.1, REQ-3.8).
2. An un-ignore rule for the heads log or the journal counts as present only when git does not ignore the path after `init`: when a later rule such as `*.log` overrides an existing one, `init` appends the un-ignores again at the end (REQ-1.1).
3. In a repository whose `.gitignore` holds `*.log`, after `init`, git ignores neither a journal file nor `.slicekit/journal-heads.log`, and still ignores a journal lock (REQ-1.1).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `init-heads-ignore.test.js » init un-ignores the journal heads log after a *.log rule` | happy | REQ-1.1 |
| `init-heads-ignore.test.js » init adds the heads log rule once in either spelling` | negative | REQ-1.1 |
| `init-heads-ignore.test.js » init appends the un-ignores again when a later *.log rule overrides them` | negative | REQ-1.1 |

## Expected changes

`src/init.js`, `test/init.test.js`, tests.

## Tasks

### Task 1: The ignore rule

**Files:** Modify `src/init.js`, `test/init.test.js`; create `test/init-heads-ignore.test.js`.

- [ ] **Step 1: Failing tests** — the three tests above.
- [ ] **Step 2: Implement**: one more entry in `IGNORE_RULES` after `!.slicekit/journal/*.log`; the existing gitignore expectations in `test/init.test.js` gain the line; after writing, `git check-ignore` on the heads log and a journal file decides whether the un-ignores are appended again.
- [ ] **Step 3: Run** `node --test test/init-heads-ignore.test.js test/init.test.js` → PASS.
- [ ] **Step 4: Commit** `fix(init): un-ignore the journal heads log`.
