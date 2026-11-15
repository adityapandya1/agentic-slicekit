# slicekit journal

Verifies or prints the session journal, and records the journal heads after a merge.

## Usage

```text
slicekit journal verify [--against <ref>] | journal show [-n 10] [--branch <b>] | journal heads <merge sha>
```

The session-end hook appends one line per session to this clone's journal file for the current branch. Each file is a hash chain.

`journal verify` checks each file's hash chain, that the journal directory holds no unexpected entry, and that no committed journal file was shortened or removed since the merge base. It prints `journal: <n> lines in <m> files verified`, `journal: no entries`, or every problem. It never writes.

- `--against <ref>`: the ref whose merge base the shortening check uses. Default: the default branch.

`journal show` prints the last lines of this clone's journal file for one branch.

- `-n <count>`: how many lines. Default: 10.
- `--branch <b>`: which branch's file. Default: the current branch.

`journal heads <merge sha>` is a step of the CI sync job. It appends to `.slicekit/journal-heads.log` one line per journal file whose last hash changed at that merge: the file, its last hash, the merge commit, and the run ID, workflow and actor of the CI run. It prints `journal heads: <n> lines for <sha7>`. `check --ci` recomputes each line; see the [`journal`](../rules/journal.md) rule.

## What it reads and writes

`verify` and `show` read the journal files and git, and write nothing. `heads` reads git and the variables `GITHUB_RUN_ID`, `GITHUB_WORKFLOW` and `GITHUB_ACTOR`, and appends to `.slicekit/journal-heads.log`.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | verified, printed, or the heads lines appended |
| 1 | `verify`: at least one problem, each printed. `heads`: the sha is not a commit of this clone |
| 2 | bad usage; `show`: `-n` is not a positive whole number; `heads`: not one commit sha, or not in a CI run |

## Example

```console
$ slicekit journal verify
journal: 42 lines in 6 files verified
$ slicekit journal show -n 1 --branch slice/P1-S-02-place-order
```

[Back to the guide](../README.md#pages)
