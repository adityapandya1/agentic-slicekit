# Check rule: frozen

On a slice branch, a test of the evaluation set, known by its name, stays as it was at the red commit.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `frozen <file>:<line> <message>`.

## What fails

- `frozen test changed after red: <file> » <name>`, one finding per test of the evaluation set whose text differs from its text at the red commit, or that was removed or renamed. Another test of the same file, or any other line of it, is not compared. A file that cannot be read by name (it does not parse, or two tests share the name) counts as a change.
- `frozen test changed after red: <path>`, for a file frozen whole: a state file written before P8/S-60 lists the path, and the slice file at the red commit names no evaluation test in it.
- `red commit <sha> of <slice> is not in this repository`.
- `state file <path> was removed after it recorded the red commit <sha7>`, one finding naming the state file, when the tip holds no state file and an earlier version of it in the tip's history recorded a red commit.
- A state file that is not valid JSON at the tip, or frozen tests that name a path outside the repository.

## When it judges

On a slice branch whose state file records a red commit. The tip judged is `HEAD`, or under `--ci` the pull request's head. The state file, the red commit, the slice file and the tests are read from git objects, never the working tree, so a file hidden with `assume-unchanged` or `skip-worktree` is judged by its committed content. A tip that has no state file is judged by the versions of the file in the tip's history: the red commit and the frozen tests are read from them, so each frozen test that changed after red is still a finding, beside the one for the removal. A slice whose state file never recorded a red commit gets no finding. A test is unfrozen only when `build amend --test "<file> » <name>"` named it: the tip's state file lists it in `unfrozen` and the slice file changed in a commit of the slice branch after the red commit. A change to the slice file alone, from `build amend` with no `--test`, unfreezes nothing. `freezeTests` set to `false` in the config turns the rule off.

## How to clear a finding

Restore the test. Restore a removed state file from the last commit that holds it (`git revert` of the commit that removed it). When the test itself is wrong, a person agrees, the slice file records the amendment, and `build amend <id> --test "<file> » <name>" --reason <r>` unfreezes that one test.

## The failure it prevents

An agent that cannot make a failing test pass edits the test until it does, and the slice merges green while the behaviour the evaluation set asked for was never built.
