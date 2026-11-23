# /slicekit next

Run the one next step of the program, then stop (REQ-2.16). It takes no arguments.

`{{cli}} next` reads the state from files only: `.slicekit/state/` (a slice's worktree copy while it
is being built), the slice files, the verdict files and `decisions.md`. It writes no file and asks
nothing of the host of the pull requests. Each run is one step, so `/loop /slicekit next` runs one step per iteration, and a step
resumes after a restart or a compaction: the files say where the program is, and nothing has to be
remembered from an earlier turn (D-104).

## Steps

1. Run `{{cli}} next`. Its first line is the step; its second line is the command that runs it. Any
   later lines belong to the step: a `then:` line is the command to run once the second line's
   command is done, and a numbered line is one of the choices of a person's step.
2. When the second line starts with `person:`, the step is a person's: a merge, the approval of a
   publish, an Open decision row the step depends on, or the review budget stop of REQ-2.8, which
   lists three choices. Print every line `{{cli}} next` printed, tell the human the command after
   `person:` is theirs to run, and stop. Run nothing of it yourself.
3. Otherwise run the one command on the second line:
   - A `{{cli}}` command: run it, then each `then:` line in order, in this same iteration. Stop at
     the first that exits non-zero and print what it printed. A `then:` line
     `{{cli}} instructions reviewer <id> --worktree <path>` spawns that reviewer with the output as
     its whole prompt and waits for its verdict file; the `then:` line after it records that
     verdict. After `{{cli}} review start <n>` these lines spawn the independent reviewer and run
     `{{cli}} build verdict <id> <file> --independent` from the review worktree: run them before you
     stop, or the next iteration starts the same review again.
   - `{{cli}} instructions <role> <id> --worktree <path>`: spawn that agent with the output as its
     whole prompt, and take its report through the step of `/slicekit build` that the first line
     names (`{{cli}} instructions --command build` prints that procedure); the first line names the
     step by its number.
   - A slash command such as `/slicekit release P1`: follow the procedure
     `{{cli}} instructions --command <name> <args>` prints.
4. Stop. Print the step's first line and the last line its command printed. Do not run
   `{{cli}} next` again in this turn: the next iteration does that.

## What this procedure never does

It never merges a pull request, approves a publish or deployment, or pushes with force, and it runs
no git or gh command itself. When a command it runs refuses with a line that only a person can
answer (a branch that `has diverged from origin`, a default branch behind origin, a force push),
print that line and stop: the person decides.
