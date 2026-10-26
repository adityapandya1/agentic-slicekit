# /slicekit build

Arguments: {{args}}

You build one slice from `todo` to a draft pull request. The commands below own git: each one commits, pushes or records state, and you run no git yourself. The developer writes files and reports; you read its report and run the next command. Stop at the first command that exits non-zero and act on what it prints.

## 1. Pick the slice and start it

When `{{args}}` names no slice, run `{{cli}} build next`. It prints the slice ID, or exits 1 with `no slice is ready to build` and one line per waiting slice; on exit 1, print those lines and stop.

Run `{{cli}} build start <id>`. It prints the worktree path on its first line and the branch on its second. Keep the path: every later step passes it as `<path>`.

## 2. The developer writes the tests

Run `{{cli}} instructions developer <id> --worktree <path>`. Spawn the developer with that output as its whole prompt, followed by this order: "Write only the evaluation set's tests, under the worktree path, and no code. Report their paths on one line `tests: <a>, <b>`." Give it nothing else; the brief holds the worktree path.

## 3. The tests fail first

Take the paths from the developer's `tests:` line and pass them joined by commas, without spaces: `{{cli}} build red <id> --tests <a>,<b> --worktree <path>`. It prints the red commit and `tests-red → building`.

On a refusal (for example "the evaluation set must fail before the build", or an evaluation test that is not in the files), send the developer back with the printed message and run this step again with its new report.

## 4. The developer makes them pass

Spawn the developer again, with the same brief, to make the tests pass. It reports once, when it stops.

After each developer report in which a test newly passes, run `{{cli}} build commit <id> --message "<subject>" --worktree <path>`, with a subject such as `feat(<id>): <what now works>`. It prints `<sha7> exit <n>`, or `nothing to commit` with exit 0, which is success. A refusal naming a frozen test means the developer changed one: send it back with the message. While tests still fail, spawn the developer again with what is left.

When the developer reports a line `amend: <test path> — <why>`, ask the human whether that test may change. On no, tell the developer the test stands. On yes:

1. Edit the slice file in the worktree, `<path>/<docs root>/phases/<phase>/<slice file>`, never the copy in the main checkout: `build amend` reads the worktree's copy.
2. Change the evaluation set's row when the test's name or kind changes. When the row stays the same (only the test was wrong), still record the amendment in that file, as a line under the evaluation set naming the test and the reason: `build amend` refuses a slice file with no change.
3. Run `{{cli}} build amend <id> --test <test path> --reason "<why>" --worktree <path>`, and tell the developer it may change that one test.

## 5. Green, then the draft pull request

When the developer reports every test passing, run `{{cli}} build commit <id> --message "<subject>" --require-green --worktree <path>`. It prints `<sha7> exit 0`, or `nothing to commit` with exit 0 when step 4 already committed everything; both are success. A failing test run is refused: send the developer back with the printed summary.

Write the notes file from the developer's report, outside the worktree: `.git/slicekit-notes-<id>.json` in the main checkout, with the `/` in `<id>` written as `-` (for example `.git/slicekit-notes-P1-S-01.json`). It is one JSON object:

- `tryIt`: a list of exactly three strings, the steps a reviewer follows to see the slice work.
- `skipped`: one string, the report's `Skipped:` and `Not checked:` lines joined, never a list.
- `decisions` (optional): a list of strings, the choices made while building.
- `runbook` (optional): one string. When the slice's runbook flag is set and the runbook did not change, `no operational change: <reason>`.
- `infra` (optional): one string, the infrastructure or migration the slice needs.

Run `{{cli}} build pr <id> --notes <file> --worktree <path>`. It runs the test, lint and build commands and `{{cli}} check`, pushes, opens the draft pull request and prints `#<n> <url>`. On a refusal, fix what it names (through the developer when it is code) and run it again; a re-run never opens a second pull request.

Steps 6 to 9 are not in this version. Print the pull request's number and URL, and tell the human that review follows in `/slicekit review <n>`.
