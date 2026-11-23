# slicekit next

Prints the one next step of the program and the command that runs it. `/slicekit next` runs it; a person types it to see where the program is.

## Usage

```text
slicekit next
```

It takes no option. The first line is the step, the second the command that runs it. A `then:` line after them is the command to run once the second line's command is done; numbered lines are the choices of a person's step.

It finds the step from the program stage first: while a stage before the build is not complete, the step is that stage's slash command. Once the plan is complete, it takes the first slice in phase and Order step that is not `merged` or `released`, and names the step its state calls for:

| State | Step | Command |
|---|---|---|
| `todo`, no worktree | start the build | `build start <id>` |
| `todo`, with its worktree | the developer writes the tests | `instructions developer <id> --worktree <wt>` |
| `tests-red` | record the failing tests | `build red <id> --tests <files> --worktree <wt>` |
| `building` | the developer makes the tests pass | `instructions developer <id> --worktree <wt>` |
| `draft-pr` | the next in-loop review, or the independent review once those rounds are used | `instructions reviewer <id> --worktree <wt>`, or `review start <PR>` |
| `in-review` | green CI | `build finish <id> --worktree <wt>` |
| `changes-requested` | the fixer answers the blockers while a round is left | `instructions fixer <id> --worktree <wt>` |
| `ci-green` | the independent review, when it is required and missing | `review start <PR>`, else `build finish` |
| `ready` | a person merges | `gh pr merge <PR>` on GitHub, then `status --sync` |

When every slice is merged, the step is `/slicekit release P<n>` for a phase with no release record.

A step whose result the files already record is never printed: a recorded verdict is not asked for again, and a run with no change since the last prints the same lines. While a slice is being built, its state is read from the state file in its worktree, `.worktrees/P<n>-S-<nn>`, since the build commits each move there first.

## A person's step

`slicekit next` never merges a pull request, approves a publish or pushes with force. At those points its second line starts with `person:` and names the command for the person; nothing runs it. It stops the same way at:

- a slice at `ready`: the person merges the pull request, named by its number;
- an Open row of `decisions.md` that the slice's file cites, or that the spec cites before the build: the person settles it with `decide settle D-<n> --answer "<answer>"`;
- the spec or plan pull request to merge;
- the review budget stop of D-101, when the last allowed round still holds a blocker: it prints the three choices, fix by hand, re-scope the slice, or allow one more round with a decision row;
- every phase released: a publish, when the team makes one, is approved by a person.

## What it reads and writes

Reads the config, the files the program stage reads, `.slicekit/state/` and the state files in the slices' worktrees, the slice files, the verdict files under `.slicekit/reviews/` and `decisions.md`. It writes no file, asks no git host and commits nothing. An older config is read migrated and left as it is.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | the step is printed, a person's step included |
| 2 | an argument was given, or a bad config or slice file |

## Example

```console
$ slicekit next
P1/S-02 is ready: a person merges pull request #14
person: gh pr merge 14
then: slicekit status --sync records the merge
```

[Back to the guide](../README.md#pages)
