# slicekit sync

Opens the pull request that carries the state change after a merge. The CI sync job runs it; a person does not type it.

## Usage

```text
slicekit sync open
```

`sync open` is the sync job's last step, after `status --sync --write` and `journal heads` on the default branch. It puts the change on a `sync/<short sha>` branch, opens a pull request titled `[sync] state after <short sha>` through the git host, and starts the workflow on that branch so its checks run. The job never pushes to the default branch.

What it prints:

| Output | Meaning |
|---|---|
| `#<n> <url>`, then `dispatched <workflow> on <branch>` | it opened the pull request |
| `sync: #<n> <url> is already open for <branch>`, then the dispatched line | that pull request was open; no second one is opened |
| `sync: no state change; nothing to open` | the merge changed no state |
| `sync: #<n> … cut from a later merge, already carries this state; nothing to open` | a newer sync pull request holds this change |
| `closed #<n>: superseded by #<m>` | an older sync pull request was closed, since the new one carries every change it did |

A person approves and merges the sync pull request. On it, `check --ci` runs the [`sync-release`](../rules/sync-release.md) and [`journal`](../rules/journal.md) rules. The sync job needs the repository setting that lets GitHub Actions create pull requests; the [`host-rules`](../rules/host-rules.md) rule reports it when it is off.

## What it reads and writes

Reads the working tree's changes and git. Writes one commit on a new `sync/<short sha>` branch, pushes it, opens the pull request, closes superseded ones and dispatches the workflow, all through the git host.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | opened one, found one open, or had nothing to open |
| 1 | git, the git host or the body rules refused |
| 2 | bad usage or a config problem |

## Example

```console
$ slicekit sync open
#161 https://github.com/acme/orders/pull/161
dispatched slicekit.yml on sync/8d2e483
```

[Back to the guide](../README.md#pages)
