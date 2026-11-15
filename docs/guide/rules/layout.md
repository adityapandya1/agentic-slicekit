# Check rule: layout

Every file and folder `slicekit init` lays down is still there, and `.claude/` holds no file of another shape.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `layout <file>:<line> <message>`.

## What fails

- `<path> is missing; run slicekit init`: a file or a directory of the layout is gone or is the wrong kind.
- `<file> is not part of shape <shape>; run slicekit update`: a file under `.claude/` that the kit ships only for another shape.

## When it judges

On every run once `.slicekit/config.json` exists. A file under `.claude/` that the kit does not ship is the team's and is never a finding.

## How to clear a finding

Run `slicekit init` to put back what is missing, or `slicekit update` to remove a file of another shape.

## The failure it prevents

A deleted or renamed part of the layout, such as the decisions file or the state folder, makes a later command fail in the middle of a build or read an empty folder as "nothing planned".
