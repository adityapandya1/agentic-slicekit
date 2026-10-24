<!-- slicekit:managed:start v0.0.0-test -->
---
name: slicekit-loop
description: The slice states in order and the nine steps of the build loop.
---
# The loop

## States, in order

`todo`, `tests-red`, `building`, `draft-pr`, `in-review`, `changes-requested`, `ci-green`, `ready`, `merged`, `released`.

Only the CLI writes the state file.

## Build steps

1. Create a worktree and the branch `slice/P<n>-S-<nn>-<descr>` from the default branch.
2. Spawn developer with `npx --no-install slicekit instructions developer P<n>/S-<nn>`.
3. Run the developer's tests, require a non-zero exit, commit, set `tests-red`, freeze the test files.
4. Set `building`; developer makes the tests pass; commit each time a new test passes, with the trailer.
5. Run the test, lint and build commands and `slicekit check`; push; open a draft pull request; set `draft-pr`.
6. Spawn reviewer with the pull request number; receive the verdict file; set `in-review`.
7. On blockers spawn fixer and review again, at most two rounds; a blocker after round two sets `changes-requested`.
8. For should-haves ask the human once per round; a decline goes in the pull request body and becomes an issue.
9. With zero open blockers mark the pull request ready, set `ci-green` when CI passes, stop; a human merges.
<!-- slicekit:managed:end -->
