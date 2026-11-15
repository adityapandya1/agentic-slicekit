# Check rule: sync-release

Under `--ci` on a sync pull request, the version, the changelog and the rendered files are exactly what CI computes for that merge.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `sync-release <file>:<line> <message>`.

## What fails

- `<file> differs from what CI computes for the merge <sha7>`, one finding per file.
- `the version for the merge <sha7> could not be computed`.

## When it judges

Only under `check --ci`, on a `sync/<short sha>` branch. CI checks out the merge the branch names in a temporary worktree, runs the sync step there and compares. So `package.json` may change only in its version, `CHANGELOG.md` only by the one new section, and a rendered file only to its fresh render at that version. The rule is silent when the config has no `release.auto` and the branch changes none of those files.

## How to clear a finding

Do not edit a sync pull request by hand. Close it and let the sync job open a new one, or restore the files to what the job wrote.

## The failure it prevents

A sync pull request, which a person approves as routine bookkeeping, carries a hand-set version number or an edited rendered hook, and that change ships in the next published version without a slice or a review.
