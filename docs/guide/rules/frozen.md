# Check rule: frozen

On a slice branch, a test of the evaluation set stays as it was at the red commit.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `frozen <file>:<line> <message>`.

## What fails

- `frozen test changed after red: <path>`.
- `red commit <sha> of <slice> is not in this repository`.
- A state file that is not valid JSON at the tip, or frozen tests that name a path outside the repository.

## When it judges

On a slice branch whose state file records a red commit. The tip judged is `HEAD`, or under `--ci` the pull request's head. The state file, the red commit, the slice file and the tests are read from git objects, never the working tree, so a file hidden with `assume-unchanged` or `skip-worktree` is judged by its committed content. A slice file changed in a commit of the slice branch after the red commit lifts the freeze, as `build amend` does. `freezeTests` set to `false` in the config turns the rule off.

## How to clear a finding

Restore the test. When the test itself is wrong, a person agrees, the slice file records the amendment, and `build amend <id> --test <path> --reason <r>` unfreezes it.

## The failure it prevents

An agent that cannot make a failing test pass edits the test until it does, and the slice merges green while the behaviour the evaluation set asked for was never built.
