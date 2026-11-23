# Check rule: lane

A slice marked `lane: quick` changes no file under `src/`, `bin/` or `templates/`.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `lane <file>:<line> <message>`.

## What fails

- `<slice> is marked lane: quick but its expected changes name <path>, under src/, bin/, templates/ (D-103)`, reported at the path's line of the slice file.
- `<slice> is marked lane: quick but its branch changes <path>, under src/, bin/, templates/ (D-103)`, one finding per path, reported at the slice file's `lane:` line.
- `<slice> is marked lane: quick and the branch's changes against <default branch> cannot be read`, when the default branch is not present to compare with.

## When it judges

Every slice file whose front matter says `lane: quick` is judged by its `## Expected changes`, on any branch. On that slice's own branch the rule also reads the files the branch changes against the default branch: the merge base with the default branch (as origin has it, else the local one) against the tip, from git objects, never the working tree, so a change merged in from the default branch is not counted. The tip is `HEAD`, or under `--ci` the pull request's head. A slice with no `lane` field is never a finding. `lane` takes one value, `quick`; any other value is a slice-file error naming the field.

A quick slice gets one combined plan step, in which its slice file is written and merged in one `[plan]` pull request, and one in-loop review round in place of two. Its independent review is the same as for any slice.

## How to clear a finding

Remove `lane: quick` from the slice file, so the slice runs the full plan and two in-loop review rounds, or move the change under `src/`, `bin/` or `templates/` to a slice of its own.

## The failure it prevents

A slice planned as a document change also changes code, and that code merges after one in-loop review round instead of two, with the plan pull request never having said that the slice reaches the kit's code.
