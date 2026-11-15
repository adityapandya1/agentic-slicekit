# Check rule: hooks

The git hooks the kit installs are present, executable and the ones git runs.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `hooks <file>:<line> <message>`.

## What fails

- `core.hooksPath is not set (must be .githooks); run slicekit init`.
- `core.hooksPath is <value>, not .githooks`.
- `.githooks/<name> is missing; run slicekit init`, for each of `pre-commit`, `pre-merge-commit` and `prepare-commit-msg`.
- `.githooks/<name> is not executable`.

## When it judges

On every run inside a git repository. On Windows there is no mode bit, so a tracked hook's mode in the index is read and an untracked hook is not judged for it.

## How to clear a finding

Run `slicekit init`, or `git config core.hooksPath .githooks`. For the mode, `git update-index --chmod=+x <file>`.

## The failure it prevents

Git hooks do not survive a clone, so in a fresh clone nothing refuses a commit on the protected branch or adds the slice trailer, and nobody notices until the trailer rule fails in CI.
