# Check rule: sync-release

Under `--ci` on a sync pull request, the version, the changelog and the rendered files are exactly what CI computes for that merge.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `sync-release <file>:<line> <message>`.

## What fails

- `<file> differs from what CI computes for the merge <sha7>`, one finding per file. The line's second half says what a sync pull request may change in that file.
- For a rendered file of an example, that second half is `a sync pull request changes an example file only to its fresh render at the version it sets (slicekit update --yes in that folder)`.
- `the version for the merge <sha7> could not be computed`.

## When it judges

Only under `check --ci`, on a `sync/<short sha>` branch. CI checks out the merge the branch names in a temporary worktree, runs the sync step there and compares. So `package.json` may change only in its version, `CHANGELOG.md` only by the one new section, and a rendered file only to its fresh render at that version.

The rule also judges the rendered files of each folder under `examples/` that holds a rendered directory and a config. The sync step renders each example at the version it sets, as `slicekit update --yes` would in that folder, so an example file is accepted only where it equals that render.

The version is the one the sync step computes: the patch number up by one, or the minor number up by one when the merge completes a phase for the first time. A phase whose line a `CHANGELOG.md` section at the merge holds has had its minor version, so a sync pull request that carries a second minor version for that phase is one finding on `package.json` and one on `CHANGELOG.md`.

The rule is silent when the config has no `release.auto` and the branch changes none of those files.

## How to clear a finding

Do not edit a sync pull request by hand. Close it and let the sync job open a new one, or restore the files to what the job wrote.

A finding on an example file means the file on the sync branch is not the render of that example at the version the pull request sets: it was edited on the branch, or it is stamped with another version. Re-run the `sync` job of that merge, which renders the examples again and replaces the branch. To see the render the rule expects, check out the merge with the version the pull request sets and run `slicekit update --yes` in that folder.

## The failure it prevents

A sync pull request, which a person approves as routine bookkeeping, carries a hand-set version number or an edited rendered hook, and that change ships in the next published version without a slice or a review.
