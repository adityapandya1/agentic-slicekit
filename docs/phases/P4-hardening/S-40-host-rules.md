---
slice: P4/S-40
name: The git host's rules on the default branch
repo: .
group: G
runbook: yes
requirements: [REQ-3.14]
decisions: [D-70, D-77, D-81, D-84, D-88]
---

## Done when

1. C-1 gains `readBranchRules`, `readCodeowners` and `applyBranchRules`, implemented in `src/adapters/githost/github.js` through `gh api` against the host the `origin` remote names (never a hard-coded github.com), and in `fixture.js` (REQ-3.14).
2. A new check rule `host-rules` reads the repository rulesets that apply to the default branch and fails naming each rule missing: a pull request required; at least one approval, from a code owner when CODEOWNERS exists; the kit's CI checks required; force push refused. A repository with classic branch protection only is told to move to a ruleset (REQ-3.14, D-84).
3. When the host cannot be reached or the token may not read the rules, the rule fails under `--ci` and otherwise prints `host rules not checked` without blocking (D-81).
4. `slicekit init --protect` applies only the missing rules as one ruleset named `slicekit` through `applyBranchRules` and prints each rule it set; without `--protect`, init changes no host setting; a test asserts `applyBranchRules` has one caller (REQ-3.14).
5. `docs/runbook.md` says a human runs `init --protect` from their own terminal with admin rights, and that the git host login the agent session uses must have no admin rights on the repository (REQ-3.14, D-88).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `check/host-rules.test.js » a default branch with every rule passes` | happy | REQ-3.14 |
| `check/host-rules.test.js » each missing rule is a finding naming it` | negative | REQ-3.14 |
| `check/host-rules.test.js » unreadable rules fail in CI and warn outside it` | negative | REQ-3.14 |
| `init.test.js » init --protect applies only the missing rules and prints them` | happy | REQ-3.14 |
| `init.test.js » init without --protect calls no host write` | negative | REQ-3.14 |
| `check/host-rules.test.js » applyBranchRules has one caller, init --protect` | negative | REQ-3.14 |

Amended (independent review B-1, author's decision): the required checks are `gate` and `checks`, never a command job's matrix names, so `check/host-rules.test.js` names those two checks.

## Expected changes

`src/adapters/githost/github.js`, `src/adapters/githost/fixture.js`, `src/check/rules/host-rules.js`, `src/init.js`, `src/cli/init.js`, `docs/adapters.md`, `docs/runbook.md`, `test/fixtures/githost/`, tests.

## Tasks

### Task 1: The host operations

**Files:** Modify `src/adapters/githost/github.js`, `src/adapters/githost/fixture.js`, `docs/adapters.md`, `test/fixtures/githost/`.

- [ ] **Step 1: Implement** `readBranchRules(branch)` from `GET repos/{owner}/{repo}/rules/branches/{branch}` (rulesets only, D-84); `readCodeowners()` from the three paths GitHub reads; `applyBranchRules(branch, rules)` as one repository ruleset named `slicekit`. The host and repository come from the origin remote as the other operations do.

### Task 2: The rule

**Files:** Create `src/check/rules/host-rules.js`, `test/check/host-rules.test.js`.

- [ ] **Step 1: Failing tests** — the three check tests above.
- [ ] **Step 2: Implement**; the required check names are the jobs `renderWorkflow` writes.
- [ ] **Step 3: Run** `node --test test/check/host-rules.test.js` → PASS.

### Task 3: init --protect

**Files:** Modify `src/init.js`, `src/cli/init.js`, `docs/runbook.md`, `test/init.test.js`.

- [ ] **Step 1: Failing tests** — the two init tests above.
- [ ] **Step 2: Implement**; run `node --test test/init.test.js` → PASS.
- [ ] **Step 3: Commit** `feat(check): verify the host's branch rules; init --protect applies them`.
