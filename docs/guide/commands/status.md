# slicekit status

Lists every slice's state, syncs merges from the git host and regenerates `BUILD.md`.

## Usage

```text
slicekit status [--json] [--write] [--sync]
slicekit status --merge-driver <ancestor> <current> <other>
```

With no option it lists every slice as `<id>  <state>  PR <#n|->  <name>`.

- `--sync`: first asks the git host which pull requests merged and moves those slices, from `draft-pr` to `ready`, to `merged`.
- `--write`: regenerates the generated region of `BUILD.md` from the slice files and the state files, and prints `BUILD.md updated` or `unchanged` in place of the list. A phase with a slice not yet merged has one row per slice: its name, group, a link to its slice file and its status, with no Done when column. A phase whose slices are all merged is one line under "Merged phases" naming the phase, its number of slices and its folder under the docs root; a slice moved back from done brings its phase's rows back (D-105).
- `--json`: prints one JSON document: stage, slices, synced, warnings, build.
- `--merge-driver <ancestor> <current> <other>`: the mode git runs as the `BUILD.md` merge driver that [`init`](init.md) sets, with `%O %A %B`. It merges the slice files and state files of both sides, renders `BUILD.md` from them and writes it to `<current>`. Exit 0 is a clean merge; any other exit leaves `BUILD.md` conflicted (D-100).

A slice branch commits no change to `BUILD.md`: the `build` steps commit the state file alone, and the sync pull request rewrites `BUILD.md` on the default branch.

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
