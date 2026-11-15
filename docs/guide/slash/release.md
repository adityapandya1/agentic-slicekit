# /slicekit release

Writes the release record of a phase whose slices are all merged, and opens the release pull request. It deploys nothing.

## What you type

`/slicekit release P<n>`, after the last slice of the phase merges.

## Agents it spawns

None.

## Commands its procedure runs

- [`release`](../commands/release.md) as `release P<n> --dry-run`, then `release P<n>`; `release P<n> --undo` when `check` finds a fault in the record
- [`branch`](../commands/branch.md) as `branch release <slug>`, the slug being the phase in lower case
- [`check`](../commands/check.md), until it reports `0 findings`
- [`pr`](../commands/pr.md) as `pr open --title "[release] P<n>"`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

The branch `release/<slug>`. The release record `<docsRoot>/releases/P<n>.md`, each slice of the phase at `released`, and `BUILD.md` rewritten, in one commit. The `[release] P<n>` pull request; merging it is the release of the phase in this repository. When a slice is not merged, has no recorded pull request or fails the runbook judgement, the dry run names it and nothing is written.

[Back to the guide](../README.md#pages)
