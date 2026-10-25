---
slice: P2/S-11
name: `/slicekit specify`
repo: .
group: B
runbook: no
requirements: [REQ-2.3, REQ-1.3]
decisions: [D-07, D-15, D-17]
---

## Done when

1. `slicekit spec verify` exits 1 on an incomplete earlier stage, on a REQ whose `Cites:` names nothing that exists (telling the writer to use a clarification marker instead), and on an interface row from intake with no contract citing it; otherwise it prints the REQ, contract and marker counts (REQ-2.3, REQ-1.3).
2. The `/slicekit specify` procedure writes one spec file per capability in the REQ-1.3 shape and one contract per interface named at intake, runs `spec verify` and `check`, and opens the `[spec] <program name>` pull request through `slicekit pr open` (C-1, D-07).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/specify.test.js » one spec file per capability and one contract per interface named at intake` | happy | REQ-2.3 |
| `commands/specify.test.js » a claim no intake sentence or decision supports is written as a clarification marker, not guessed` | negative | REQ-2.3 |
| `commands/specify.test.js » an interface with no contract is a finding naming its decision row` | negative | REQ-2.3 |
| `commands/specify.test.js » verify refuses while clarify is not done` | negative | REQ-1.3 |
| `commands/specify.test.js » the procedure passes the brief lint` | happy | REQ-2.3 |

## Expected changes

`src/spec-verify.js`, `src/cli/spec.js`, `templates/instructions/commands/specify.md`, tests.

## Tasks

### Task 1: `spec verify`: stage and support

**Files:** Create `src/spec-verify.js`, `src/cli/spec.js`, `test/commands/specify.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes (S-09): `reqBlocks` from `src/stage.js`; `readDecisions` from `src/decisions.js`. From Phase 1: `programStage`. <!-- slicekit:pending P2/S-09 -->
- `unsupportedReqs(root, cfg) → [{req, file, line}]`: a REQ block whose `Cites:` entries name no D row present in `decisions.md` and no file that exists under `<docsRoot>/intake/` (an entry resolves against the spec file's directory, then the root).
- `verifySpec(root, cfg) → {findings: [{file, line, message}], counts: {reqs, contracts, markers}, markers: [{file, line, text}]}`. Findings, in order: each blocker of `programStage(root, cfg, {upTo: 'specify'})` when it stops before `specify`, as `-:0 <stage> not done: <blocker>`; each unsupported REQ as `<REQ> cites nothing that exists; write [NEEDS CLARIFICATION: <question>] instead of a guess`; the interfaces without a contract (Task 2). A `[NEEDS CLARIFICATION: …]` marker is listed, never a finding: specify may leave them, plan refuses them (S-13).
- CLI `spec verify`: exit 0 and first line `spec verified: <r> REQ, <c> contracts, <m> clarification markers`, then one `<file>:<line> <marker>` per marker; exit 1 and one `<file>:<line> <message>` per finding. `subcommands = ['verify']`.

- [ ] **Step 1: Failing tests** — `a claim no intake sentence or decision supports is written as a clarification marker, not guessed`: a spec file with REQ-1.1 citing D-01 (present) and REQ-1.2 whose `Cites:` names D-99, which does not exist → exit 1, one finding naming REQ-1.2 and holding `write [NEEDS CLARIFICATION`; replacing REQ-1.2's claim with a marker and citing the snapshot → exit 0 and the marker is listed. `verify refuses while clarify is not done`: the spec cites D-02, an Open row → exit 1 with `clarify not done: D-02 is Open and cited by the spec`. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/specify.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(spec): verify the spec's support before review`.

### Task 2: Contracts for every interface named at intake

**Files:** Modify `src/spec-verify.js`, `test/commands/specify.test.js`.

**Interfaces:**
- Consumes (S-09): `interfacesWithoutContract` from `src/decisions.js` (the register S-10 writes through `intake answer --interface`). <!-- slicekit:pending P2/S-09 -->
- Each row of `interfacesWithoutContract` is a `verifySpec` finding at its line in `decisions.md`: `interface <name> (<D-ID>) has no contract under <docsRoot>/spec/contracts/`.
- `counts.contracts` is the number of `.md` files under `<docsRoot>/spec/contracts/`.

- [ ] **Step 1: Failing tests** — `one spec file per capability and one contract per interface named at intake`: two capability files holding three REQs, decisions with two interface rows, and two contracts each citing one → exit 0, `spec verified: 3 REQ, 2 contracts, 0 clarification markers`. `an interface with no contract is a finding naming its decision row`: a third interface row `Interface: orders topic` (`--source docs/intake/x.md:12`) → exit 1 with `decisions.md:<line> interface orders topic (D-<n>) has no contract under docs/spec/contracts/`.
- [ ] **Step 2: Run** `node --test test/commands/specify.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(spec): one contract per interface named at intake`.

### Task 3: The `/slicekit specify` procedure

**Files:** Create `templates/instructions/commands/specify.md`. Modify `test/commands/specify.test.js`.

**Interfaces:**
- Consumes (S-09): `briefProblems`; `{{cli}} stage require`, `{{cli}} branch spec`, `{{cli}} pr open`.
- Steps, in order: (1) `{{cli}} stage require clarify`; (2) `{{cli}} branch spec <slug>`, the intake's branch; (3) read every snapshot under `<docsRoot>/intake/` and `decisions.md`; (4) write `<docsRoot>/spec/<capability>.md`, one capability per file, each requirement in the REQ-1.3 shape (heading, SHALL sentences, a GIVEN/WHEN/THEN scenario, `Cites:` naming the snapshot or D rows, `Enforced by:`), and write `[NEEDS CLARIFICATION: <question>]` wherever no intake sentence or decision supports a claim; (5) write `<docsRoot>/spec/contracts/C-<n>-<name>.md` for each interface `spec verify` lists, naming producer, consumers and operations, citing its D row; (6) `{{cli}} spec verify` until it exits 0, then `{{cli}} check`; (7) write the body (`**Done when:**`, `**Proof:**` with the two summary lines, `**Decisions:**`) to a file outside the repository and run `{{cli}} pr open --title "[spec] <program name>" --body-file <file> --commit "docs(spec): <program name>" --paths <docsRoot>/spec,<docsRoot>/decisions.md`; (8) print the pull request line and say that merging it approves the spec (D-07).

- [ ] **Step 1: Failing test** — `the procedure passes the brief lint`: `briefProblems(text, {kind: 'command'})` is `[]`, and the text holds `stage require clarify`, `spec verify`, `[NEEDS CLARIFICATION` and `pr open --title "[spec]`.
- [ ] **Step 2: Run** `node --test test/commands/specify.test.js` → FAIL.
- [ ] **Step 3: Write** the procedure.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(spec): the /slicekit specify procedure`.
