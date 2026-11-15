# slicekit branch

Puts the session on the work branch of a document pull request.

## Usage

```text
slicekit branch <spec|gaps|plan|release> <slug>
```

The branch is `<kind>/<slug>`. A new branch is cut from the default branch as origin has it, after a fetch. A branch that exists here or on origin is taken up where it stands. Untracked files go along; changes to tracked files are refused.

A `release` branch is treated differently. One that is behind the default branch's tip and holds no commit of its own is moved to that tip, and the command says so. One that holds its own commits is refused with one of three lines: the open pull request of that branch, a line saying the git host could not be asked, or the next slug to run the command with (`<slug>-2`).

The slug is the program name in lower case with other characters turned into dashes; for `release` it is the phase in lower case. It holds lowercase letters, digits and dashes, at most 60 characters, and does not start with a dash.

## What it reads and writes

Reads the config, the local branches and origin. It fetches, then creates or checks out the branch. It asks the git host only for a `release` branch that holds its own commits.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | prints the branch name |
| 1 | uncommitted changes to tracked files, a git error, or a `release` branch that holds commits the default branch lacks |
| 2 | bad usage, a bad slug, or a config problem |

## Example

```console
$ slicekit branch spec orders
spec/orders
```

[Back to the guide](../README.md#pages)
