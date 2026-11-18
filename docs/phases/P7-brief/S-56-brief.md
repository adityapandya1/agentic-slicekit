---
slice: P7/S-56
name: Brief
repo: .
group: A
runbook: no
requirements: [REQ-2.15, REQ-1.7, REQ-1.1, REQ-2.2, REQ-5.8, REQ-5.7]
decisions: [D-99]
---

## Done when

1. `slicekit brief start <slug>`, then `brief ask --topic <t> --question <q>` and `brief answer --answer <a>` for each topic of REQ-2.15 in its order, then `brief done`, write `<docsRoot>/brief/<slug>.md` with the seven headings of REQ-2.15 in their order, each answer once under its heading and no other text. `brief ask` refuses with exit 1 a topic out of order, and a question while the last one has no answer; `brief answer --unknown` writes the topic under `## Open questions` and under no other heading (REQ-2.15, D-99).
2. `brief done` refuses with exit 1, and commits nothing, on the default branch or a protected branch, while a heading is missing from the brief, and when a file under `<docsRoot>/spec/` appeared or changed since `brief start`. Otherwise it commits the brief alone on the current branch and its last stdout line is `/slicekit intake <docsRoot>/brief/<slug>.md`; the scenario of REQ-2.15 (`payments-retry`, success measures unknown) passes as written. The pre-edit hook denies an edit to the brief session file in the worktree's git directory, as it denies the intake interview's (REQ-2.15).
3. `slicekit stage require brief` exits 0 with `ready: brief` when every file under `<docsRoot>/brief/` other than `.keep` has the seven headings, and exits 1 naming the file and the first missing heading otherwise, or `no brief under <docsRoot>/brief/` when there is none. `stage require intake`, and every stage after it, gives on a repository with no brief what it gave before: the brief is not one of `STAGES` (REQ-1.7, D-99).
4. `slicekit init` lays down `<docsRoot>/brief/.keep`; the layout rule reports a missing `<docsRoot>/brief/` folder; `slicekit check` on the kit's own repository gives `0 findings` with `docs/brief/.keep` committed. `slicekit intake snapshot docs/brief/<slug>.md` takes a brief as it takes any file, and the intake procedure says a brief is a valid source (REQ-1.1, REQ-2.2).
5. `slicekit instructions --command brief` prints the procedure of REQ-2.15 with the CLI steps above; `/slicekit-brief` and `/slicekit brief` reach it, and `.claude/commands/slicekit-brief.md` is rendered by `slicekit update`. The pages `docs/guide/commands/brief.md` and `docs/guide/slash/brief.md` exist and the guide index's Pages section links them; the README's "What it covers" table has a Brief row; `node scripts/guide-html.js --check` exits 0 (REQ-5.8, REQ-5.7).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `brief.test.js » a scripted interview writes the seven sections in order with each answer once` | happy | REQ-2.15 |
| `brief.test.js » an unknown answer is written under Open questions and not under its topic` | negative | REQ-2.15 |
| `brief.test.js » brief ask refuses a topic out of order and a second question before an answer` | negative | REQ-2.15 |
| `brief.test.js » brief done refuses when a spec file changed during the interview` | negative | REQ-2.15 |
| `brief.test.js » brief done commits the brief and prints the intake command as its last line` | happy | REQ-2.15 |
| `stage.test.js » stage require brief names the file and the first missing section` | negative | REQ-1.7 |
| `stage.test.js » stage require intake does not read the brief folder` | happy | REQ-1.7 |
| `check/layout.test.js » a missing brief folder is a layout finding` | negative | REQ-1.1 |
| `commands/intake.test.js » a brief is snapshotted as an intake source` | happy | REQ-2.2 |
| `user-guide.test.js » the brief command and procedure have pages` | happy | REQ-5.8 |

## Expected changes

`src/brief.js`, `src/cli/brief.js`, `src/cli/index.js`, `src/stage.js`, `src/cli/stage.js`, `src/paths.js`, `src/init.js`, `src/check/rules/layout.js`, `src/hooks/pre-edit.js`, `src/instructions.js`, `templates/instructions/commands/brief.md`, `templates/instructions/commands/intake.md`, `templates/claude-code/commands/slicekit-brief.md`, `templates/claude-code/commands/slicekit.md`, `templates/claude-code/manifest.json`, `templates/docs/brief/.keep`, `docs/brief/.keep`, `.claude/commands/slicekit-brief.md`, `.claude/commands/slicekit.md`, `docs/guide/commands/brief.md`, `docs/guide/slash/brief.md`, `docs/guide/README.md`, `docs/guide/slicekit-guide.html`, `README.md`, tests.

## Tasks

### Task 1: The interview and its file

**Files:** Create `src/brief.js`, `src/cli/brief.js`, `test/brief.test.js`. Modify `src/cli/index.js`, `src/paths.js`, `src/hooks/pre-edit.js`.

- [ ] **Step 1: Failing tests** — the five `brief.test.js` tests above, on a fixture repository on a spec branch, the interview driven by the CLI with `SLICEKIT_NOW` set. No test reaches the network.
- [ ] **Step 2: Run** `node --test test/brief.test.js` → FAIL.
- [ ] **Step 3: Implement** the session at `<git-dir>/slicekit/brief.json` (slug, spec file digests, pending question, topics asked), the seven sections as one exported list, the answer writer and `brief done`'s refusals and commit, reusing the work-branch test of `src/intake.js`. Add the session file to `kitOwned`.
- [ ] **Step 4: Run** the same and `node --test test/hooks/pre-edit.test.js test/commands/intake.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(brief): the brief interview and its file`.

### Task 2: The stage and the layout

**Files:** Modify `src/stage.js`, `src/cli/stage.js`, `src/init.js`, `src/check/rules/layout.js`, `test/stage.test.js`, `test/check/layout.test.js`. Create `templates/docs/brief/.keep`, `docs/brief/.keep`.

- [ ] **Step 1: Failing tests** — the two `stage.test.js` tests and the `test/check/layout.test.js` test above.
- [ ] **Step 2: Run** `node --test test/stage.test.js test/check/layout.test.js` → FAIL.
- [ ] **Step 3: Implement** `stage require brief` from the section list of Task 1, outside `STAGES`; the `brief/.keep` destination in `TEMPLATE_DEST`; `brief` in the layout rule's folders.
- [ ] **Step 4: Run** the same, `node --test test/init.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(stage): the optional brief stage and its folder`.

### Task 3: The procedure, the slash command and the pages

**Files:** Create `templates/instructions/commands/brief.md`, `templates/claude-code/commands/slicekit-brief.md`, `docs/guide/commands/brief.md`, `docs/guide/slash/brief.md`. Modify `src/instructions.js`, `templates/instructions/commands/intake.md`, `templates/claude-code/commands/slicekit.md`, `templates/claude-code/manifest.json`, `docs/guide/README.md`, `README.md`, `test/commands/intake.test.js`, `test/user-guide.test.js`.

- [ ] **Step 1: Failing tests** — `commands/intake.test.js » a brief is snapshotted as an intake source` and `user-guide.test.js » the brief command and procedure have pages`.
- [ ] **Step 2: Run** `node --test test/commands/intake.test.js test/user-guide.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Implement** the procedure (one topic per question in the order of REQ-2.15, `branch spec <slug>` first, the CLI steps, the last line), the slash command file and its manifest entry, `brief` in `PROCEDURES`, the line in the intake procedure that a brief is a valid source, the two pages, the index's Pages rows and the README's Brief row. Run `node bin/slicekit.js update` and `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(brief): /slicekit brief and its pages`.
