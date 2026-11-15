# slicekit state

Reads or writes one slice's state file. The build commands call it; a person types it rarely.

## Usage

```text
slicekit state set <id> <to> [--commit sha] [--test-exit n] [--check-exit n] [--tests a,b] [--pr-number n --pr-title t --pr-url u --pr-sha s] [--verdict path --round n --blockers n [--independent]] [--ci-status s --ci-sha s] [--merged-at iso] [--release path] [--backfill]
slicekit state show <id> [--json]
slicekit state unfreeze <id> <path>
```

The states, in order: `todo`, `tests-red`, `building`, `draft-pr`, `in-review`, `changes-requested`, `ci-green`, `ready`, `merged`, `released`.

`state set <id> <to>` is the only writer of a slice's state file. It checks the move's precondition against the evidence passed and refuses otherwise. It prints `<id>  <state>`.

| Evidence | What it records |
|---|---|
| `--commit <sha>` | the commit the move rests on |
| `--test-exit <n>`, `--check-exit <n>` | the exit codes of the test command and of `check` |
| `--tests <a,b>` | the test files, for `tests-red` |
| `--pr-number`, `--pr-title`, `--pr-url`, `--pr-sha` | the pull request and its head |
| `--verdict <path>`, `--round <n>`, `--blockers <n>`, `--independent` | a review verdict, its round, its open blockers, and whether it is independent |
| `--ci-status <s>`, `--ci-sha <s>` | the CI result and the head it ran on |
| `--merged-at <iso>` | the merge time |
| `--release <path>` | the release record, for `released` |
| `--backfill` | with `merged`: takes the merge time and head from the git host, to record a merge that happened outside the loop |

`state show <id>` prints `<id>  <state>  PR <#n|->`. With `--json` it prints the whole state file: history, frozen tests, verdicts, handoff.

`state unfreeze <id> <path>` releases one test frozen at `tests-red` and records it in the history. [`build amend`](build.md) is the usual way: it also requires the slice file to record the amendment.

## What it reads and writes

Reads the slice file and the state file under `.slicekit/state/`; `--backfill` reads the git host. `set` and `unfreeze` write the state file under a lock. `show` writes nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | moved, printed or unfrozen |
| 1 | `set`: `refused: <reason>`, or a git host error. `unfreeze`: the path is not a frozen test of the slice |
| 2 | bad usage, an unknown state or slice, a held lock, or a config problem |

## Example

```console
$ slicekit state show P1/S-03
P1/S-03  ready  PR #17
$ slicekit state set P1/S-03 merged --backfill --pr-number 17
P1/S-03  merged
```

[Back to the guide](../README.md#pages)
