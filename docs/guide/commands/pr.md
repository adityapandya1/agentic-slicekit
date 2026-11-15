# slicekit pr

Commits, pushes and opens or updates a document pull request.

## Usage

```text
slicekit pr open --title <t> --body-file <f> [--commit <message> --paths <a,b>] [--draft] [--base <b>]
```

`pr open` optionally commits the named paths, pushes the current branch and opens its pull request through the git host. When one is already open for the branch, it updates that pull request's body instead. It never pushes a protected branch. It is the last step of specify, gaps, plan and release; slice pull requests use [`build pr`](build.md).

- `--title <t>`: the pull request title. Required.
- `--body-file <f>`: a UTF-8 file holding the body. Required.
- `--commit <message>` and `--paths <a,b>`: commit these comma-separated paths with this message. The two go together.
- `--draft`: opens the pull request as a draft.
- `--base <b>`: the branch it merges into. Default: the default branch.

## What it reads and writes

Reads the body file, the config and git. Writes one commit when `--commit` is given, pushes the branch, and opens or updates the pull request on the git host.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | prints `#<n> <url>`, or `updated #<n> <url>` |
| 1 | git, the host or the body rules refused |
| 2 | bad usage, or a body file that cannot be read or is not UTF-8 |

## Example

```console
$ slicekit pr open --title "[spec] orders" --body-file /tmp/spec-body.md \
    --commit "docs(spec): orders" --paths docs/spec,docs/decisions.md
#12 https://github.com/acme/orders/pull/12
```

[Back to the guide](../README.md#pages)
