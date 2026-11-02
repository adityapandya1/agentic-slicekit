---
slice: P4/S-37
name: Guards refuse what they cannot parse
repo: .
group: A
runbook: no
requirements: [REQ-3.2, REQ-2.1, REQ-3.14]
decisions: [D-19, D-66, D-77, D-83]
---

## Done when

1. In every session, `pre-bash` denies `eval "git commit -m x"`, `sh -c "git push"`, `bash -c 'git commit'`, `node -e "require('child_process').execSync('git commit')"`, `python -c "import os; os.system('git push')"`, `perl -e` and `ruby -e` naming `git` or `gh`, each with "cannot judge this command" and the rule (REQ-3.2).
2. In every session and on every branch (D-83), `pre-bash` denies a git command whose subcommand, ref or remote comes from a variable or a command substitution: `B=main; git push origin HEAD:$B`, `X=push; git $X --force`, `git push origin "$(git branch --show-current)"` (REQ-3.2).
3. `pre-bash` denies a command that writes a test file frozen for the active slice by `>`, `>>`, `tee`, `sed -i`, `cp`, `mv` or `rm`, naming the file and the slice; reading the file (`cat`, `grep`) stays allowed (REQ-3.2, REQ-3.3).
4. Commands the loop runs today still pass: `node --test <file>`, `npm test`, `node bin/slicekit.js <command>`, a literal `git status`, `git diff` and `git log` from a subagent, and `node -e` code that names neither `git` nor `gh` (REQ-3.2).
5. In every session, `pre-bash` denies a `gh api` call that writes to a repository's rulesets, rules or branch protection (`-X`/`--method` other than GET, or `-f`, `-F`, `--field`, `--raw-field` or `--input` without `-X GET`); a read of the same path passes. The header of `src/hooks/pre-bash.js` says the guard is a check that can be bypassed and names the host rules as the control (REQ-3.14, REQ-2.1).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `hooks/pre-bash.test.js » git through eval, a shell's -c or an interpreter's inline code is denied in every session` | negative | REQ-3.2 |
| `hooks/pre-bash.test.js » a git ref or subcommand from a variable or substitution is denied on any branch` | negative | REQ-3.2 |
| `hooks/pre-bash.test.js » a Bash write to a frozen test is denied, naming the file and slice` | negative | REQ-3.2 |
| `hooks/pre-bash.test.js » the commands the loop runs still pass` | happy | REQ-3.2, REQ-2.1 |
| `hooks/pre-bash.test.js » a gh api write to rulesets or branch protection is denied and a read passes` | negative | REQ-3.14 |

## Expected changes

`src/hooks/pre-bash.js`, `src/hooks/paths.js`, `test/hooks/pre-bash.test.js`.

## Tasks

### Task 1: Unjudgeable commands

**Files:** Modify `src/hooks/pre-bash.js`, `test/hooks/pre-bash.test.js`.

- [ ] **Step 1: Failing tests** — the first, second, fourth and fifth tests above.
- [ ] **Step 2: Run** `node --test test/hooks/pre-bash.test.js` → FAIL.
- [ ] **Step 3: Implement** an `unjudgeable(command)` check run before the existing rules, in every session and on every branch (D-83): a `git`/`gh` word whose next words hold `$` or a backtick; `eval`; `sh`, `bash`, `zsh`, `pwsh` or `cmd` with `-c` or `/c` whose argument names `git` or `gh`; `node -e`/`--eval`, `python -c`, `perl -e`, `ruby -e` whose code names `git` or `gh`. Update the header comment.
- [ ] **Step 4: Run** the same → PASS.

### Task 2: Bash writes to frozen tests

**Files:** Modify `src/hooks/pre-bash.js`, `src/hooks/paths.js`.

- [ ] **Step 1: Failing test** — the third test above.
- [ ] **Step 2: Implement** with the frozen list `pre-edit` already reads from the active slice's state file; the write forms are a redirection target, a `tee` argument, `sed -i`'s file, `cp`/`mv`'s destination and `rm`'s arguments.
- [ ] **Step 3: Run** `node --test test/hooks/pre-bash.test.js test/hooks/pre-edit.test.js` → PASS.
- [ ] **Step 4: Commit** `feat(hooks): pre-bash refuses what it cannot judge and Bash writes to frozen tests`.
