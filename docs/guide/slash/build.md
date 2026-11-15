# /slicekit build

Builds one slice from `todo` to a pull request ready for a person to merge: failing tests first, then code, at most two review rounds, then green CI.

## What you type

`/slicekit build`, which takes the next slice; `/slicekit build P<n>/S-<nn>` for a named one; or `/slicekit build --parallel P<n>`, which starts every runnable slice of the phase's next Order step, each in its own worktree. Run it after the plan pull request merges, once per slice.

## Agents it spawns

The developer, twice: first for the tests of the evaluation set, then for the code that makes them pass. The reviewer, once per round, which writes a verdict file. The fixer, when a verdict holds blockers or should-haves the person chose to fix. Each brief is the output of `instructions <role> <id> --worktree <path>`. The agents write files and report; they never commit or push.

## Commands its procedure runs

- [`stage`](../commands/stage.md) as `stage require plan`
- [`build`](../commands/build.md) as `build next` and `build start`, or `build parallel`; `build red`; `build commit`; `build pr`; `build verdict`; `build decline` for each should-have the person declines; `build finish`
- [`build`](../commands/build.md) as `build amend` when a person agrees a frozen test may change, `build render` and `build config` for a slice that changes the kit's version or the config, and `build sync` when another worktree pushed to the slice branch
- [`instructions`](../commands/instructions.md) as `instructions developer`, `instructions reviewer` and `instructions fixer`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

The worktree `.worktrees/P<n>-S-<nn>` on the branch `slice/P<n>-S-<nn>-<descr>`, pushed. The red commit of the frozen tests, then code commits, each with the `Slice:` trailer and the test run's result. The pull request `[P<n>/S-<nn>] <name>` with the body the kit requires. One verdict file per round under `.slicekit/reviews/`. One tracker issue per declined should-have. The slice at `ci-green`, waiting for the independent review, or at `ready`. A blocker that survives round two leaves the slice at `changes-requested` and the pull request a draft.

[Back to the guide](../README.md#pages)
