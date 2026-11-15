# slicekit check

The kit's one gate: runs every check rule and prints each finding.

## Usage

```text
slicekit check [--ci] [--json]
```

Each finding is one line, `<rule> <file>:<line> <message>`. The last line is the summary, such as `check: 0 findings, 0 over baseline, 0 blocking, 18 rules`. A finding a ratchet baseline still allows is printed with `(baseline)` in front and does not fail the run.

- `--ci`: adds what only CI can judge: the pull request's title and body, read from the GitHub event file, commit signatures, and the files of a sync pull request.
- `--json`: prints one JSON document: findings, counts, over, blocking, exitCode and rules.

The rules, each with a page of its own:

| Rule | Kind | Runs | What it checks |
|---|---|---|---|
| [`ci-body`](../rules/ci-body.md) | blocking | only under `--ci` | Under `--ci`, the pull request's body carries the sections the kit requires |
| [`ci-title`](../rules/ci-title.md) | blocking | only under `--ci` | Under `--ci`, the pull request's title begins with the slice it delivers, and that slice was opened through the build loop |
| [`citations`](../rules/citations.md) | blocking | every run | Every requirement cites a source that exists, every slice file names requirements and decisions that exist, and no ID is defined twice |
| [`commands`](../rules/commands.md) | blocking | every run | Every command the team declared in the config can be found on this machine |
| [`coverage`](../rules/coverage.md) | blocking | every run | Once a program is planned, every requirement belongs to a slice and every slice can be built and judged |
| [`frozen`](../rules/frozen.md) | blocking | every run | On a slice branch, a test of the evaluation set stays as it was at the red commit |
| [`hooks`](../rules/hooks.md) | blocking | every run | The git hooks the kit installs are present, executable and the ones git runs |
| [`host-rules`](../rules/host-rules.md) | blocking | every run | The git host's rulesets on the default branch hold every rule the kit relies on |
| [`journal`](../rules/journal.md) | blocking | every run | The session journal is an unbroken, append-only record, and under `--ci` its commits are signed |
| [`layout`](../rules/layout.md) | blocking | every run | Every file and folder `slicekit init` lays down is still there, and `.claude/` holds no file of another shape |
| [`managed`](../rules/managed.md) | blocking | every run | Every file the kit renders still holds the block the kit wrote |
| [`queue`](../rules/queue.md) | blocking | every run | `BUILD.md` reads exactly as the slice files and their state say |
| [`references`](../rules/references.md) | ratchet | every run | Every path, anchor and ID a doc names exists |
| [`runbook`](../rules/runbook.md) | blocking | every run | A slice that says it changes operations changes the runbook, or says why not |
| [`style`](../rules/style.md) | ratchet | every run | No doc uses a phrase from the team's filler list |
| [`sync-release`](../rules/sync-release.md) | blocking | only under `--ci` | Under `--ci` on a sync pull request, the version, the changelog and the rendered files are exactly what CI computes for that merge |
| [`trailer`](../rules/trailer.md) | blocking | every run | On a slice branch, every commit the branch adds names the slice in a `Slice:` trailer |
| [`workspace`](../rules/workspace.md) | blocking | every run | A slice names a repository the workspace lists, and a contract names both of its parties |

A rule that crashes, or whose ID another rule already took, is a blocking finding: the gate never passes because a rule did not run.

The Stop hook runs `check` when the agent tries to end a turn and blocks the turn while it is red. CI runs `check --ci` on every pull request. `build pr` runs it before every push.

## What it reads and writes

Reads the config, every Markdown file under the docs root, `BUILD.md`, `README.md`, the verdicts and the rendered agent files, the slice and state files, the baselines and git. Under `--ci` it also reads the GitHub event file and the git host. It writes nothing; the `sync-release` rule uses a temporary worktree and removes it.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | clean |
| 1 | a failing finding |
| 2 | cannot run: bad arguments or a config problem |

## Example

```console
$ slicekit check
references docs/spec/refunds.md:9 missing file docs/spec/07-nothing.md
check: 1 findings, 1 over baseline, 1 blocking, 18 rules
```

[Back to the guide](../README.md#pages)
