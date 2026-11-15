# slicekit status

Lists every slice's state, syncs merges from the git host and regenerates `BUILD.md`.

## Usage

```text
slicekit status [--json] [--write] [--sync]
```

With no option it lists every slice as `<id>  <state>  PR <#n|->  <name>`.

- `--sync`: first asks the git host which pull requests merged and moves those slices, from `draft-pr` to `ready`, to `merged`.
- `--write`: regenerates the generated region of `BUILD.md` from the slice files and the state files, and prints `BUILD.md updated` or `unchanged` in place of the list.
- `--json`: prints one JSON document: stage, slices, synced, warnings, build.

After a merge to the default branch, the sync job of the generated workflow runs `status --sync --write`, then [`sync open`](sync.md) puts the change up as a pull request.

## What it reads and writes

Reads the slice files, the state files and, with `--sync`, the git host. `--sync` writes state files; `--write` writes `BUILD.md`. It commits nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | done |
| 2 | a bad config or slice file, a git host error, a held lock, or bad usage |

## Example

```console
$ slicekit status --sync
synced P1/S-02 → merged (PR #14)
P1/S-01  merged  PR #11  Health check
P1/S-02  merged  PR #14  Place an order
P1/S-03  todo  PR -  Refunds
```

[Back to the guide](../README.md#pages)
