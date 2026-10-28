# /slicekit build

Build one slice from `todo` to a pull request ready for a human to merge: the tests first and
failing, then the code that makes them pass, then at most two review rounds and green CI (REQ-2.6,
steps 1 to 9). Arguments: {{args}}.

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`. Every step that touches the
repository's history goes through `{{cli}}`; run no git or gh command yourself. The developer writes
files and reports; you read its report and run the next command. Stop at the first command that
exits non-zero and act on what it prints. A refusal that says the slice's branch is behind origin
and ends `run slicekit build sync <id>` means another worktree, such as an independent review's,
pushed to it: run `{{cli}} build sync <id> --worktree <path>`, then the
refused command again. A refusal that says the default branch is behind origin (`pull first`) or
ahead of it, or that a branch `has diverged from origin`, goes to the human: print it and stop, since only the human
pulls or pushes by hand. So does any other refusal a step below does not say how to fix.

When the arguments are `--parallel P<n>`, build that phase's next Order step side by side: see
"Building a step in parallel" at the end.

## 1. Check the stage, pick the slice, start it

Run `{{cli}} stage require plan`. On exit 1, print what it says and stop: the build waits for the
plan.

When the arguments name a slice (`P<n>/S-<nn>`), that is `<id>`. Otherwise run `{{cli}} build next`.
It prints the slice ID, or exits 1 with `no slice is ready to build` and one line per waiting slice;
on exit 1, print those lines and stop.

Run `{{cli}} build start <id>`. A new start prints the worktree path on its first line and the
branch on its second; keep the path: every later step passes it as `<path>`. A slice this clone
already started prints `resumed <path> at <state>`; keep the path and go on at the state's step:

- `todo`: step 2.
- `tests-red`: step 3, with the same test paths; `build red` finishes the move to `building`.
- `building`: step 4.
- `draft-pr`: run step 5's `{{cli}} build pr` (without `--notes` when the notes file is gone; see
  step 7), then step 6 with the verdict path it prints.
- `in-review`: step 6, from its `build verdict` command. The resume prints a second line,
  `verdict <file>`, the latest recorded round's file; with it, `build verdict` records nothing
  again and prints that round's `next:`. After an independent round the second line is
  `next review: /slicekit review <n> in a new session` instead: stop and tell the human to run that
  in a new session, since this session built the slice.
- `changes-requested`: the loop stopped with a blocker after round 2. Stop and tell the human.
- any later state: stop and tell the human the slice is in review, at that state.

When it refuses with `already started in origin/<branch>; another clone holds it`, stop and tell the
human: the slice is being built in another clone.

## 2. The developer writes the tests

Run `{{cli}} instructions developer <id> --worktree <path>`. Spawn the developer with that output as
its whole prompt, followed by this order: "Write only the evaluation set's tests, under the worktree
path, and no code. Report their paths on one line `tests: <a>, <b>`." Give it nothing else; the
brief holds the worktree path.

## 3. The tests fail first

Take the paths from the developer's `tests:` line and pass them joined by commas, without spaces:
`{{cli}} build red <id> --tests <a>,<b> --worktree <path>`. It prints the red commit and
`tests-red → building`.

On a refusal (for example "the evaluation set must fail before the build", or an evaluation test
that is not in the files), send the developer back with the printed message and run this step again
with its new report.

## 4. The developer makes them pass

Spawn the developer again, with the same brief, to make the tests pass. It reports once, when it
stops.

After each developer report in which a test newly passes, run
`{{cli}} build commit <id> --message "<subject>" --worktree <path>`, with a subject such as
`feat(<id>): <what now works>`. It prints `<sha7> exit <n>`, or `nothing to commit` with exit 0,
which is success. A refusal naming a frozen test means the developer changed one: send it back with
the message. While tests still fail, spawn the developer again with what is left.

When the developer reports a line `amend: <test path> — <why>`, ask the human whether that test may
change. On no, tell the developer the test stands. On yes:

1. Edit the slice file in the worktree, `<path>/<docsRoot>/phases/<phase>/<slice file>`, never the
   copy in the main checkout: `build amend` reads the worktree's copy.
2. Change the evaluation set's row when the test's name or kind changes. When the row stays the
   same (only the test was wrong), still record the amendment in that file, as a line under the
   evaluation set naming the test and the reason: `build amend` refuses a slice file with no change.
3. Run `{{cli}} build amend <id> --test <test path> --reason "<why>" --worktree <path>`, and tell
   the developer it may change that one test.

## 5. Green, then the draft pull request

When the developer reports every test passing, run
`{{cli}} build commit <id> --message "<subject>" --require-green --worktree <path>`. It prints
`<sha7> exit 0`, or `nothing to commit` with exit 0 when step 4 already committed everything; both
are success. A failing test run is refused: send the developer back with the printed summary.

Write the notes file from the developer's report to a file outside the repository:
`slicekit-notes-<id>.json` in your scratchpad or temp directory, with the `/` in `<id>` written as
`-` (for example `slicekit-notes-P1-S-01.json`). It is one JSON object:

- `tryIt`: a list of exactly three strings, the steps a reviewer follows to see the slice work.
- `skipped`: one string, the report's `Skipped:` and `Not checked:` lines joined, never a list.
- `decisions` (optional): a list of strings, the choices made while building.
- `runbook` (optional): one string. When the slice's runbook flag is set and the runbook did not
  change, `no operational change: <reason>`.
- `infra` (optional): one string, the infrastructure or migration the slice needs.

Run `{{cli}} build pr <id> --notes <the notes file's absolute path> --worktree <path>`. It runs the
test, lint and build commands and `{{cli}} check`, pushes, opens the draft pull request and prints
`#<n> <url>`, then last `verdict <file>`: the absolute path, in the session root, where the next
reviewer writes its verdict. On a refusal, fix what it names (through the developer when it is code) and run
it again; a re-run never opens a second pull request. Keep the number `<n>` and the verdict path.

A refusal that starts `plan defect:` prints one line per overlap,
`plan defect: <id> and <other> both change <path>; the plan said they do not overlap`. It is checked
before the commands run and again just before the push. No change in this slice answers it: print
every line and stop, and tell the human the plan is at fault, since it put two slices that change
one path in the same Order step. The slice stops here; nothing was pushed.

## 6. The reviewer gives a verdict

Run `{{cli}} instructions reviewer <id> --worktree <path>`. Spawn the reviewer with that output as
its whole prompt, followed by the pull request number, the worktree path, the round `k` (the number
after `-r` in the verdict file's name) and the verdict path: the `verdict <file>` line the latest
`build pr` or `build verdict` printed. Give it nothing else.

When the reviewer stops, run `{{cli}} build verdict <id> <file> --worktree <path>` with that verdict
path. It commits the verdict into the worktree, pushes, and prints `next: <step>`,
`blockers: <IDs or none>`, `should-haves: <IDs or none>` and `rounds: <used> of 2`, and last a new
`verdict <file>` line when another round is allowed. A refusal that names the verdict's content (a
finding with no "How verified", a reused finding number, a banned phrase, a `<!--`) goes back to the
reviewer with the printed message; run this command again with the file it writes. A refusal that
says `a new verdict needs a fresh fetch` means origin could not be reached: print it and stop, and
tell the human to run the step again once origin answers. A refusal that
says `run slicekit build pr <id> first` means code was committed that `build pr` has not seen: run
step 5's `build pr`, then step 6 again from the start with the path it prints, since that code needs
a review of its own. A refusal that says a file `differs from` another goes to the human: print it
and stop. Then act on `next:`:

- `next: fix`: step 7.
- `next: ask`: step 8.
- `next: ci`: step 9.
- `next: stuck`: it exits 1. A blocker survived round 2: the state is `changes-requested` and the
  pull request stays a draft. Print the output and stop; the human decides what happens to the
  slice.

## 7. The fixer answers the blockers

When the verdict also lists should-haves, first ask the human about them (step 8); those the human
chooses to fix go to the fixer with the blockers. Run `{{cli}} instructions fixer <id> --worktree <path>`.
Spawn the fixer with that output as its whole prompt, followed by the verdict file's path in the
worktree, `<path>/.slicekit/reviews/<the verdict file's name>`, and the IDs to answer: every
blocker and each should-have to fix.

When the fixer reports, run these two in this order:

1. `{{cli}} build commit <id> --message "fix: <ids>" --require-green --worktree <path>`, with the
   answered IDs joined by `, `. A failing test run or a frozen test is refused, and
   `nothing to commit` means the fixer changed nothing: send the fixer back with what was printed.
2. `{{cli}} build pr <id> --notes <the notes file's absolute path> --worktree <path>`, with step 5's
   notes file. When that file is gone, run `{{cli}} build pr <id> --worktree <path>` without
   `--notes`: it keeps the pull request's live body. When that refuses with `pass --notes <file>`,
   the body lacks a section: write the notes file again from step 5 and run it with `--notes`. It
   updates the same pull request, returns it to draft and prints the next verdict path last.

Then go back to step 6 with that path. Run no other build command between these two: after a
commit, `build verdict` and `build finish` refuse until `build pr` has run.

## 8. The human decides the should-haves

On `next: ask`, or on `next: fix` with should-haves, ask the human once, listing every should-have
of the verdict with its ID and its "What is wrong" from the verdict file: fix it or decline it. For
each one declined, run `{{cli}} build decline <id> <H-n> --worktree <path>`. It files one issue for
the finding and adds the issue's URL to the pull request's "Should-haves declined"; it prints the
URL, followed by `(already filed)` or `(already filed, closed)` when the issue was there before,
which is success too. Then:

- with blockers: step 7, with the should-haves to fix.
- with no blockers and should-haves to fix: step 7 for those should-haves alone.
- with every should-have declined and no blockers: step 9.

After round 2 no fix is offered: `build verdict` prints
`fix: not available after round 2; decline or leave for the independent review`. Ask only whether
to decline each should-have or leave it for the independent review, then go to step 9.

## 9. Green CI, then the independent review

Run `{{cli}} build finish <id> --worktree <path>`. Each call waits at most 90 seconds for CI on the
pull request's head, and only on success marks the pull request ready and records `ci-green`. On
exit 1, by what it prints:

- `CI failed on <sha7>: <url>`: print it and stop; tell the human CI failed on the reviewed head.
- `CI still running on <sha7>; …`: nothing has changed; run the same command again. When it still
  says so after five tries, print it and stop; tell the human CI has not finished.
- `no CI run found for <sha7>; check that the workflow ran`: print it and stop; tell the human the
  workflow did not run on that head.
- A refusal that the pull request head `is not in the worktree; pull first`: run
  `{{cli}} build sync <id> --worktree <path>`, then this command again. When it refuses the same
  way after the sync, print it and stop.

On exit 0 it prints `ci-green` and the CI run's URL, then one line:

- `ready: waiting for an independent review; run /slicekit review <n> in a new session`: print the
  pull request's number and URL and the CI run's URL, and stop. Tell the human to run
  `/slicekit review <n>` in a new session for the independent verdict, which comes before the merge
  (D-18). A human merges once the slice is `ready`.
- `ready: not yet: <reason>`: print it and stop; tell the human the reason the slice is not ready.
- `ready`: the independent verdict is already on this head, or review is optional. Print the pull
  request's number and URL and the CI run's URL, and stop: a human merges.

## Building a step in parallel

With `--parallel P<n>`, run step 1's `{{cli}} stage require plan`, then
`{{cli}} build parallel P<n>` in place of `build next` and `build start`. It starts every runnable
slice of the phase's next Order step, each in its own worktree, and prints one line per slice
started: `<id> <worktree> <branch>`. Keep each slice's ID and worktree path. It exits 1 when not
every slice started: the slices on stdout started all the same, and each one that did not is a line
`<id> not started: <reason>` on stderr. Print those lines to the human and go on with the slices that
started. When none started, it prints `no slice of P<n> is ready to build` and one line per slice
saying what it waits on or where it was started; print them and stop.

Then:

1. For every slice printed, steps 2 to 5 in its own worktree, each command with that slice's ID and
   `--worktree` path. Spawn the slices' developers together, one per slice, each with its own brief;
   run each slice's next command as its developer reports.
2. Then steps 6 to 9 for each slice in turn, one slice's review loop and CI finished before the next
   one's starts (D-06). Where a step says stop, that slice stops: tell the human what the step says
   to tell, then go on with the next slice.

A slice whose `build pr` prints `plan defect` stops there, as step 5 says; the other slices go on.
Report each overlap to the human as a defect of the plan: the plan said those slices of one step do
not change one path.
