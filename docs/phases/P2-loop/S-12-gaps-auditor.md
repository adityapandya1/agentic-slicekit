---
slice: P2/S-12
name: `/slicekit gaps` and the auditor
repo: .
group: B
runbook: no
requirements: [REQ-2.4, REQ-1.4, REQ-1.11]
decisions: [D-17, D-20]
---

## Done when

1. `slicekit gaps add` writes a `G-<n>` row of one of the five classes (`missing`, `unsupported`, `contradiction`, `unknown`, `unrequested`), and `slicekit gaps close` closes it with a D row or a REQ that exists (REQ-2.4).
2. `slicekit gaps scan` writes the rows a script can find: each "Not yet known" section of the platform, observability and runbook files, each Open decision, each REQ resting on an Open decision, and each interface named at intake with no contract, naming the intake line; a second scan adds nothing (REQ-1.11, REQ-1.4).
3. The `/slicekit gaps` procedure spawns the auditor with the spec as claims and the intake and decisions as evidence, closes every row with the human, and opens the pull request; the auditor brief and the procedure pass the brief lint.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/gaps.test.js » each of the five gap classes is written as a G row` | happy | REQ-2.4 |
| `commands/gaps.test.js » an interface named at intake and in no contract is a missing row naming the intake line` | negative | REQ-2.4 |
| `commands/gaps.test.js » close refuses a decision that does not exist` | negative | REQ-2.4 |
| `commands/gaps.test.js » a Not yet known section is an unknown row` | happy | REQ-1.11 |
| `commands/gaps.test.js » a REQ resting on an Open row is an unknown row` | negative | REQ-1.4 |
| `commands/gaps.test.js » scan run twice adds no duplicate row` | negative | REQ-2.4 |
| `commands/gaps.test.js » the procedure and the auditor brief pass the brief lint` | happy | REQ-2.4 |

## Expected changes

`src/gaps.js`, `src/cli/gaps.js`, `templates/instructions/commands/gaps.md`, `templates/instructions/agents/auditor.md`, tests.

## Tasks

### Task 1: `gaps add` and `gaps close`

**Files:** Create `src/gaps.js`, `src/cli/gaps.js`, `test/commands/gaps.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes (S-09): `readDecisions` from `src/decisions.js`, `reqBlocks` from `src/stage.js`.
- `CLASSES = ['missing','unsupported','contradiction','unknown','unrequested']`; `class GapError extends Error` with `code` 1 or 2.
- `readGaps(text) → {rows: [{id, n, cls, where, what, closedBy, line}], next}` from the table `# | Class | Where | What | Closed by` (the init template's `gaps.md`); `next` as `readDecisions` computes it, with `G-`.
- `addGap(root, cfg, {cls, where, what}) → {id, added}`: an unknown class → code 2 `unknown class '<c>'; one of missing, unsupported, contradiction, unknown, unrequested`; a line break in a field → code 2 `<field> must be one line`; `|` written as `\|`; a row with the same class, where and what → that row's ID and `added: false`.
- `closeGap(root, cfg, id, {decision, req}) → {id, closedBy}`: exactly one of the two (else code 2); the decision must be a row of `decisions.md` (code 2 `unknown decision D-<n>`), the REQ a heading of the spec (code 2 `unknown requirement <REQ>`); an unknown G-ID → code 2; a closed row → code 1 `<G-ID> is closed by <x>`. Writes the ID into `Closed by`, which is what the `gap-scan` stage reads (`src/stage.js`).
- CLI `gaps add --class <c> --where <w> --what <t>` prints the G-ID; `gaps close <G-ID> (--decision D-<n> | --req <REQ>)` prints `<G-ID> closed by <x>`. `subcommands = ['scan','add','close']` (scan lands in Task 2).

- [ ] **Step 1: Failing tests** — `each of the five gap classes is written as a G row`: one `gaps add` per class → `G-1` to `G-5`, each row's Class cell is its class, and `gaps add --class vague` exits 2. `close refuses a decision that does not exist`: `gaps close G-1 --decision D-77` exits 2 with `unknown decision D-77` and the row stays open; with a real D row it prints `G-1 closed by D-01`, and closing it again exits 1. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/gaps.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(gaps): gap rows and how each closes`.

### Task 2: `gaps scan`

**Files:** Modify `src/gaps.js`, `src/cli/gaps.js`, `test/commands/gaps.test.js`.

**Interfaces:**
- Consumes (S-09): `interfacesWithoutContract`, `readDecisions` from `src/decisions.js`; `reqBlocks` from `src/stage.js`.
- `scanGaps(root, cfg) → [{id, added}]`, through `addGap`, so a second run adds nothing. Candidates, in this order:
  1. `unknown`, where `<docsRoot>/<file>:<line>`, what `<section> not yet known`: each `##` section of `platform.md`, `observability.md` and `runbook.md` whose body is the single line `Not yet known`.
  2. `unknown`, where `<docsRoot>/decisions.md:<line>`, what `<D-ID> is open: <question>`: each Open-table row.
  3. `unknown`, where `<file>:<line>` of the REQ heading (from `reqBlocks`), what `<REQ> rests on open <D-ID>`: each REQ whose `Cites:` names an Open-table row (REQ-1.4), its citations read with `citedRefs` (`src/check/rules/citations.js`), the reader `check` and `spec verify` use.
  4. `missing`, where the interface's intake line (its `Named at` source; the decision row's line when it has none), what `interface <name> named at intake has no contract`.
- CLI `gaps scan` prints `<G-ID> <class> <what>` per added row, or `no new gaps`.

- [ ] **Step 1: Failing tests** — `a Not yet known section is an unknown row`: `observability.md` with "Not yet known" under `## Alert routes` → `unknown` row whose What is `Alert routes not yet known`. `a REQ resting on an Open row is an unknown row`: REQ-1.1 citing an Open D-02 → `REQ-1.1 rests on open D-02`. `an interface named at intake and in no contract is a missing row naming the intake line`: an interface row `Interface: orders topic` with source `docs/intake/2026-01-01-req.md:12` and no contract → a `missing` row whose Where is `docs/intake/2026-01-01-req.md:12` and whose What names `orders topic`. `scan run twice adds no duplicate row`: the second run prints `no new gaps` and the table has the same rows.
- [ ] **Step 2: Run** `node --test test/commands/gaps.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(gaps): scan for the gaps a script can find`.

### Task 3: The `/slicekit gaps` procedure and the auditor brief

**Files:** Create `templates/instructions/commands/gaps.md`. Modify `templates/instructions/agents/auditor.md`, `test/commands/gaps.test.js`.

**Interfaces:**
- Consumes (S-09): `briefProblems`; `{{cli}} stage require`, `{{cli}} branch gaps`, `{{cli}} decide add`, `{{cli}} pr open`, `{{cli}} instructions auditor`.
- Procedure steps, in order: (1) `{{cli}} stage require spec-review`; (2) `{{cli}} branch gaps <slug>`; (3) `{{cli}} gaps scan`; (4) spawn the auditor with the output of `{{cli}} instructions auditor` and the claims (`<docsRoot>/spec/`) and evidence (the snapshots under `<docsRoot>/intake/` and `decisions.md`); (5) for each open row, ask the human one question, offering choices where they exist; record the answer with `{{cli}} decide add` and close the row with `{{cli}} gaps close <G-ID> --decision <D-ID>`, or change the REQ and close it with `--req <REQ>`; (6) `{{cli}} stage require gap-scan` must print `ready: gap-scan`, then `{{cli}} check`; (7) `{{cli}} pr open --title "[spec] <program name>: gaps" --body-file <file> --commit "docs(spec): gaps" --paths <docsRoot>/spec,<docsRoot>/decisions.md`.
- The auditor brief gains a `## Gaps` section: the five classes with one sentence each (as REQ-2.4 defines them); every gap carries a citation on both sides, the claim's `<file>:<line>` as Where and the evidence's `<file>:<line>` (or `no evidence`) in What; each gap is recorded with `{{cli}} gaps add` (a CLI call, not git) and the report lists the G-IDs it added; the auditor changes no spec, decision or code.

- [ ] **Step 1: Failing test** — `the procedure and the auditor brief pass the brief lint`: `briefProblems` is `[]` for both (kind command and kind agent), the procedure holds `gaps scan`, `gaps close` and `stage require gap-scan`, and the brief names all five classes.
- [ ] **Step 2: Run** `node --test test/commands/gaps.test.js` → FAIL.
- [ ] **Step 3: Write** the procedure and the brief section.
- [ ] **Step 4: Run** the same, `node --test test/briefs.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(gaps): the /slicekit gaps procedure and the auditor's gap mode`.
