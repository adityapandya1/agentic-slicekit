# slicekit ci

Decides whether a push changes only the kit's bookkeeping, so CI can skip the team's commands.

## Usage

```text
slicekit ci bookkeeping [--base <sha>] [--head <sha>] [--base-branch <branch>] [--output <file>]
```

`ci bookkeeping` prints `bookkeeping <base>..<head>`, `code <base>..<head>` or `code (<why>)`. Bookkeeping is state files, verdicts and `BUILD.md`. The team command jobs are skipped only on `bookkeeping`; any doubt is `code`.

- `--base <sha>`: compare from this commit. Default: the newest commit of the pull request, at most 20 back, whose slicekit workflow run passed every team command job and which contains the base branch's tip. An empty or all-zero value means no base, so `code`.
- `--head <sha>`: the commit to judge. Default: `HEAD`.
- `--base-branch <branch>`: the branch the pull request merges into. Default: the config's default branch.
- `--output <file>`: appends `kind=bookkeeping` or `kind=code` to this file, GitHub's step output.

The gate job of the generated workflow runs it first on every pull request push.

## What it reads and writes

Reads git and, to search for a base, the git host's workflow runs. Writes only the `--output` file.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | always, whatever the decision |
| 2 | bad usage |

## Example

```console
$ slicekit ci bookkeeping --head "$SLICEKIT_PR_HEAD" --base-branch main --output "$GITHUB_OUTPUT"
bookkeeping 8b41d07..a71c5e0
```

[Back to the guide](../README.md#pages)
