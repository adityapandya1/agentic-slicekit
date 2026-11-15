# slicekit build

The steps of `/slicekit build` and `/slicekit review` that the CLI takes for one slice. The agent runs each; a person types one only to resume or inspect.

## Usage

```text
slicekit build next | build start <id> [--descr <d>] | build parallel P<n> | build red <id> --tests <a,b> [--worktree <p>] | build commit <id> --message <m> [--require-green] [--worktree <p>] (commits the staged paths; with nothing staged, every changed path) | build render <id> [--worktree <p>] | build config <id> [--worktree <p>] | build amend <id> [--test <path>] --reason <r> [--worktree <p>] (no --test: the slice file alone, once every test it names is unfrozen) | build pr <id> [--notes <file>] [--worktree <p>] | build verdict <id> <file> [--independent] [--worktree <p>] | build decline <id> <H-n> [--worktree <p>] | build finish <id> [--wait <s>, default 90] [--worktree <p>] | build sync <id> [--worktree <p>]
```

Each subcommand takes the slice ID, `P<n>/S-<nn>`. A slice's worktree is `.worktrees/P<n>-S-<nn>` on the branch `slice/P<n>-S-<nn>-<descr>`. `--worktree <p>` names the worktree to act in; without it the build worktree is used, never the review one.

| Subcommand | What it does |
|---|---|
| `build next` | Prints the first `todo` slice whose earlier phases and earlier Order steps are merged or released, and that no worktree or branch already holds. |
| `build start <id>` | Makes the worktree and branch from the default branch, commits an empty claim and pushes it. Prints the worktree path, then the branch. For a slice this clone already started it prints `resumed <path> at <state>`. |
| `build parallel P<n>` | Starts every runnable slice of the phase's next Order step, each in its own worktree. Prints `<id> <worktree> <branch>` per slice started. |
| `build red <id> --tests <a,b>` | Runs the test command and requires it to fail, commits the tests alone, records them as frozen and moves the slice to `building`. |
| `build commit <id> --message <m>` | Runs the tests, then commits with the test run's result and the `Slice:` trailer. With paths staged it commits those alone; with nothing staged, every changed path. It refuses a change to a frozen test or to a kit file. `--require-green` refuses unless every test passes. |
| `build render <id>` | For a slice that changes the kit's own version: runs `update --yes` in the worktree and commits only the files it writes. |
| `build config <id>` | For a slice whose Expected changes name `.slicekit/config.json`: commits the changed config alone. |
| `build amend <id> [--test <path>] --reason <r>` | Unfreezes one frozen test after a person agreed and the slice file records it. With no `--test` it commits the slice file alone, once every test it names is unfrozen. |
| `build pr <id> [--notes <file>]` | Runs the test, lint and build commands and `check`, pushes, opens the draft pull request or updates its body, and records `draft-pr`. Prints `#<n> <url>`, then `verdict <file>`. |
| `build verdict <id> <file>` | Checks the reviewer's verdict file, commits it under `.slicekit/reviews/`, records `in-review` and pushes. Prints `next: fix`, `ask`, `ci` or `stuck`. `--independent` records an independent review's verdict, which does not count against the two rounds. |
| `build decline <id> <H-n>` | Files one tracker issue for a declined should-have and adds its URL to the pull request body. |
| `build finish <id> [--wait <s>]` | Waits for CI on the pull request's head. On green it marks the pull request ready for review and records `ci-green`, then `ready` when the ready-label decision passes. |
| `build sync <id>` | Fast-forwards the worktree to its branch on origin and prints the new head. |

A machine that cannot run the whole test command at once can set `testCommand` in `.slicekit/local.json`. `build red`, `build commit` and `build pr` then use it and say so. CI never reads that file. <!-- slicekit:example -->

## What it reads and writes

Reads the slice file, the slice's state file, the config, git and, for `pr`, `verdict`, `decline` and `finish`, the git host and the tracker. Writes commits on the slice branch, the state file under `.slicekit/state/`, verdict files under `.slicekit/reviews/`, the pull request and its body, and tracker issues. It never pushes a protected branch.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | done; `build commit` with `nothing to commit` is success |
| 1 | refused: the slice's state, a failing command or check, a frozen test, git, the git host, the tracker or a held lock; `build next` when no slice is ready; `build verdict` on `next: stuck`; `build finish` when CI failed, is still running or has no run |
| 2 | bad usage, an unknown slice ID, a missing required option, or a config problem |

## Example

```console
$ slicekit build next
P1/S-02
$ slicekit build start P1/S-02
C:/work/orders/.worktrees/P1-S-02
slice/P1-S-02-place-order
$ slicekit build red P1/S-02 --tests test/order.test.js,test/order-empty.test.js
3f2a9c1…
tests-red → building
$ slicekit build commit P1/S-02 --message "feat(P1/S-02): place an order" --require-green
8b41d07 exit 0
$ slicekit build pr P1/S-02 --notes /tmp/slicekit-notes-P1-S-02.json
#14 https://github.com/acme/orders/pull/14
verdict C:/work/orders/P1-S-02-r1.md
```

[Back to the guide](../README.md#pages)
