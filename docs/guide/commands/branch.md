# slicekit branch

Puts the session on the work branch of a document pull request.

## Usage

```text
slicekit branch <spec|gaps|plan|release> <slug>
```

The branch is `<kind>/<slug>`. A new branch is cut from the default branch as origin has it, after a fetch. A branch that exists here or on origin is taken up where it stands. Untracked files go along; changes to tracked files are refused, with one exception, the migrated config below.

A `release` branch is treated differently. One that is behind the default branch's tip and holds no commit of its own is moved to that tip, and the command says so. One that holds its own commits is refused with one of three lines: the open pull request of that branch, a line saying the git host could not be asked, or the next slug to run the command with (`<slug>-2`). The git host is also asked about each numbered branch of the slug, `release/<slug>-<n>`, that holds commits the default branch lacks: an open pull request on any of them refuses, the line names that pull request and its branch, and no further slug is named.

The slug is the program name in lower case with other characters turned into dashes; for `release` it is the phase in lower case. It holds lowercase letters, digits and dashes, at most 60 characters, and does not start with a dash.

## A migrated config

A kit with a newer config version migrates `.slicekit/config.json` on the first command that is not `hook`, and writes the file once (REQ-5.6). `slicekit branch` is one of the two cases where it does not (D-93):

- `slicekit branch`, of every kind, reads an older config as migrated and writes nothing. It prints one `config:` line on stderr saying so. The branch is cut first, and the next command writes the migration on that branch, where `pr open` commits it.
- The other case is every command on a slice branch or a slice's review branch, unless that slice's Expected changes name the config.

When an earlier command on the default branch, such as `release --dry-run`, already wrote the migrated config, it is an uncommitted change to a tracked file. `slicekit branch` does not refuse that one change (D-94). It applies when the config is the only uncommitted change to a tracked file and the file equals what the migration writes from the committed config:

| The commit the session is put on | What happens to the change |
|---|---|
| holds the config the current commit holds | it is carried to the branch, where `pr open` commits it |
| holds the migrated config already, with equal content | this copy of the change is dropped, then the branch is switched to |
| holds a config that differs from the migrated one | exit 1 with one line naming the file, the branch and the fields that differ; the change is left where it is and no branch is switched to |

Any other uncommitted change to a tracked file is refused with `commit or stash your changes first`.

## What it reads and writes

Reads the config, the local branches and origin. It fetches, then creates or checks out the branch. It asks the git host only for a `release` branch, or a numbered branch of its slug, that holds its own commits. It writes no config; it restores `.slicekit/config.json` to the committed one only in the second row of the table above.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | prints the branch name |
| 1 | uncommitted changes to tracked files, a migrated config that differs from the one the branch holds, a git error, a `release` branch that holds commits the default branch lacks, or a numbered branch of its slug with an open pull request |
| 2 | bad usage, a bad slug, or a config problem |

## Example

```console
$ slicekit branch spec orders
spec/orders
```

[Back to the guide](../README.md#pages)
