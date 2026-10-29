---
slice: P2/S-28
name: 0.1.2: what a first npm install needs
repo: .
group: H
runbook: yes
requirements: [REQ-1.1, REQ-5.7, REQ-5.8]
decisions: [D-41]
---

## Done when

1. `init` adds `node_modules/` to the ignore rules it owns, after the kit's own rules, so a project that followed the README's npm install and then ran `git add -A` stages nothing under `node_modules/`; a `.gitignore` that already ignores it in any of `node_modules`, `node_modules/`, `/node_modules` or `/node_modules/` gets no second line (review H-5 of P2/S-26).
2. The npm helper of the package test passes an argument holding a space or a double quote quoted when it runs through the Windows shell, so the install test passes from a temporary folder whose path holds a space (issue #24, review H-1 of P2/S-26).
3. The runbook's "Releasing a preview" deprecates both name holders' placeholders, `slicekit@0.0.0-stage` and `slicekit@0.0.1`, after the first preview (review H-4 of P2/S-26).
4. `package.json` carries `0.1.2` and the kit's own rendered files are re-rendered for it; `slicekit check` gives `0 findings`. Publishing stays the author's, after merge.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `init.test.js » init ignores node_modules once, after the kit's rules` | happy | REQ-1.1 |
| `init.test.js » a gitignore that already ignores node_modules in any spelling gets no second line` | negative | REQ-1.1 |
| `init.test.js » init keeps a CRLF ignore or attributes file CRLF` | happy | REQ-1.1 |
| `package.test.js » an npm argument with a space reaches npm whole` | happy | REQ-5.7 |
| `package.test.js » package.json is 0.1.2, links the repository and has no dependencies` | happy | REQ-5.7 |
| `runbook.test.js » the release deprecates both placeholders` | happy | REQ-5.8 |

## Expected changes

`src/init.js`, `package.json`, `.claude/`, `.slicekit/rendered/`, `docs/runbook.md`, `test/init.test.js`, `test/package.test.js`, `test/runbook.test.js`, tests.

## Tasks

### Task 1: The ignore rule, the quoting and the release steps

**Files:** Modify `src/init.js`, `test/init.test.js`, `test/package.test.js`, `docs/runbook.md`, `test/runbook.test.js`, `package.json`.

- [ ] **Step 1: Failing tests** — the five tests above. The quoting test calls the helper with `npm --version` preceded by a `--prefix` argument naming a temporary folder with a space in its name, and expects exit 0.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** Done when 1 to 4; run `node bin/slicekit.js update --yes`.
- [ ] **Step 4: Run** `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `fix(P2/S-28): ignore node_modules, quote npm arguments on Windows, deprecate both placeholders`.
