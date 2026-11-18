---
slice: P7/S-57
name: Brief in the docs
repo: .
group: B
runbook: no
requirements: [REQ-5.8, REQ-5.7]
decisions: [D-99, D-98, D-97]
---

## Done when

1. The guide index's Stages table has a first row, "0. Brief (optional)", naming `/slicekit brief [<slug>]`, saying it is for a person with no requirement document and that intake does not require it, and listing its CLI steps `branch spec`, `brief start`, `brief ask`, `brief answer`, `brief done` and `stage require brief`. The paragraph above the table names `brief` as an optional stage before `intake`, and the "Intake and spec" group names the brief pages. `node scripts/guide-html.js --check` exits 0 (REQ-5.8, D-99, D-97).
2. The README's Quick start says, in one sentence after the first slash command, that a person with only an idea types `/slicekit brief` first and then the intake command it prints. The README's opening, "See it in action" and the order of its sections stay as D-98 fixed them, and the README tests pass (REQ-5.7, D-98).
3. `templates/brief/blank.md` holds the seven headings of REQ-2.15 in their order and one line under each saying what goes there, for a person who writes a brief by hand; its headings are the section list `stage require brief` checks, read from `src/brief.js`, and the `slicekit brief` page names the file (REQ-5.8, D-99). <!-- slicekit:pending P7/S-57 -->
4. `examples/backend/docs/brief/greeting.md` is a brief for the example's greeting service with all seven sections and one entry under `## Open questions`; `slicekit stage require brief` run in `examples/backend` exits 0 with `ready: brief` (REQ-5.7, D-99). <!-- slicekit:pending P7/S-57 -->
5. `docs/walkthrough.md` has a section "Optional: start from an idea" before its first step, saying that the example's brief came from `/slicekit brief` and showing `slicekit stage require brief` in a `sh` block with its output line in a `text` block; the walkthrough test runs it and passes. `slicekit check` gives `0 findings` and no pending marker naming this slice is left in `docs/` (REQ-5.7).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `user-guide.test.js » the Stages table opens with the optional brief stage and its CLI steps` | happy | REQ-5.8 |
| `brief-docs.test.js » the blank brief holds the seven sections stage require brief checks` | negative | REQ-5.8 |
| `brief-docs.test.js » the example's brief passes stage require brief` | happy | REQ-5.7 |
| `readme.test.js » Quick start names /slicekit brief for a person with only an idea` | happy | REQ-5.7 |
| `walkthrough.test.js » the optional brief step runs and prints ready: brief` | negative | REQ-5.7 |

## Expected changes

`docs/guide/README.md`, `docs/guide/commands/brief.md`, `docs/guide/slicekit-guide.html`, `README.md`, `templates/brief/blank.md`, `examples/backend/docs/brief/greeting.md`, `docs/walkthrough.md`, tests.

## Tasks

### Task 1: The guide index and the README

**Files:** Modify `docs/guide/README.md`, `docs/guide/slicekit-guide.html`, `README.md`, `test/user-guide.test.js`, `test/readme.test.js`.

- [ ] **Step 1: Failing tests** — the `user-guide.test.js` and `readme.test.js` tests above.
- [ ] **Step 2: Run** `node --test test/user-guide.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Implement** the Stages row and paragraph, the group line, the Quick start sentence; run `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same and `node --test test/guide-page.test.js` → PASS.
- [ ] **Step 5: Commit** `docs: the brief stage in the guide and the README`.

### Task 2: The blank brief and the example's brief

**Files:** Create `test/brief-docs.test.js`. Modify `docs/guide/commands/brief.md`.

- [ ] **Step 1: Failing tests** — the two `brief-docs.test.js` tests above. The section list is imported from `src/brief.js`, not copied.
- [ ] **Step 2: Run** `node --test test/brief-docs.test.js` → FAIL.
- [ ] **Step 3: Implement** the blank brief, the example's brief written from the example's intake snapshot with no requirement it does not hold, and the page's line naming the blank brief. Regenerate the web page.
- [ ] **Step 4: Run** the same and `node --test test/guide-page.test.js` → PASS.
- [ ] **Step 5: Commit** `docs: a blank brief and the example's brief`.

### Task 3: The walkthrough's first step

**Files:** Modify `docs/walkthrough.md`, `test/walkthrough.test.js`.

- [ ] **Step 1: Failing test** — `walkthrough.test.js » the optional brief step runs and prints ready: brief`, which fails while the section is missing or its `text` line is not printed.
- [ ] **Step 2: Run** `node --test test/walkthrough.test.js` → FAIL.
- [ ] **Step 3: Implement** the section.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `docs(walkthrough): an optional first step from a brief`.

## Notes

`examples/backend/docs/brief/greeting.md` and `templates/brief/blank.md` are new documents. The pre-edit guard allows a new document only under the docs root's exceptions until P8/S-60 lets one that Expected changes names through; `examples/` and `templates/` are outside the docs root, so the guard does not refuse them. <!-- slicekit:pending P7/S-57 -->
