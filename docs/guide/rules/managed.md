# Check rule: managed

Every file the kit renders still holds the block the kit wrote.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `managed <file>:<line> <message>`.

## What fails

- `<file>: managed block edited since slicekit wrote it; run slicekit update --force or revert`.
- `<file>: managed file missing; run slicekit update`.
- `<file>: exists but is not managed by slicekit; move it or run slicekit update --force`.
- `<file>: no reference copy; cannot tell a kit change from an edit`.

## When it judges

On every run. The comparison is the one `slicekit update` makes at the kit's own version. A file whose status is `changed`, meaning the kit ships a newer template, is not a finding: that is for `update` to write.

## How to clear a finding

Revert the edit, or run `slicekit update --yes --force` to take the kit's text. Put a team's own rules outside the managed block.

## The failure it prevents

Someone weakens a hook command, an agent's tool list or a slash command by editing the rendered file, and every later session runs with the weaker rule while the kit still appears installed.
