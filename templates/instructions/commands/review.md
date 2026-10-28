# /slicekit review

Give a slice pull request its independent verdict: a reviewer in a fresh worktree of the pull
request head, a verdict file marked independent, and on blockers a fixer whose commits the command
pushes to the slice branch (REQ-2.8, D-39). This round does not count against the build's two.
Arguments: {{args}}.

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`. Every step that touches the
repository's history goes through `{{cli}}`; run no git or gh command yourself. Stop at the first
command that exits non-zero and act on what it prints. A refusal this procedure does not say how to
fix goes to the human: print it and stop.

## 1. A session with no context from the building session

This review runs in a session that holds no context from the session that built the slice (D-18):
no part of its conversation, its notes file or its developer's reports. The kit cannot check this;
it is left to the person who started this session. When this session built the slice, or was given
the building session's context, stop and tell the human to run `/slicekit review <PR>` in a new
session.

When the arguments are `(none)`, ask the human for the pull request's number and use it in place of
`{{args}}` below. Call that number `<n>`.

## 2. A fresh worktree of the pull request head

Run `{{cli}} review start {{args}}`. It prints four lines:

- `slice <id>`: the slice the pull request builds.
- `worktree <wt>`: the review worktree's absolute path. Every later build command in this session
  passes `--worktree <wt>`, since two worktrees now hold the slice.
- `round <k>`: the round this verdict records.
- `verdict <path>`: the absolute path, in the session root, where the reviewer writes its verdict.

Keep all four. A refusal that the head `is not origin/<branch>` and ends `run the same command again
in a minute` can be a push the git host has not seen yet: run this step once more after a minute;
when it refuses again, print it and stop. It also refuses a pull request that is not open, not a
slice pull request or from a fork, and a review worktree with uncommitted changes: print the
refusal and stop, since the human decides each of these. A refusal that names
`build pr <id> --worktree <dir>` means an earlier review session committed a fix it did not push:
run `{{cli}} build pr <id> --worktree <dir>` with the path it names, then this step again.

## 3. The reviewer gives the independent verdict

Run `{{cli}} instructions reviewer <id> --worktree <wt>`. Spawn the reviewer with that output as its
whole prompt, followed by the pull request number `<n>`, the worktree `<wt>`, the round `<k>` and
the verdict path `<path>`, all four as step 2 printed them. Give it nothing else. The brief's Where
section lets it write that one file outside the worktree.

## 4. Record the verdict

When the reviewer stops, run `{{cli}} build verdict <id> <path> --independent --worktree <wt>` with
step 2's verdict path. It commits the verdict into the review worktree, pushes it to the slice
branch, and prints `next: <step>`, `blockers: <IDs or none>`, `should-haves: <IDs or none>` and
`rounds: <used> of 2`; the rounds stay as they were. By what it prints:

- A refusal that names the verdict's content (a finding with no "How verified", a reused finding
  number, a banned phrase, a `<!--`): send the reviewer back with the printed message, then run this
  command again with the file it writes.
- A refusal that the branch is behind origin, ending `run slicekit build sync <id>`: the building
  session pushed since step 2. Run `{{cli}} build sync <id> --worktree <wt>`, then this command again.
- `a new verdict needs a fresh fetch`: origin could not be reached. Print it and stop; tell the
  human to run this command again once origin answers.
- Any other refusal goes to the human: print it and stop.

When the verdict lists should-haves, ask the human once, listing each with its ID and its "What is
wrong" from the verdict file: decline it or leave it. An independent round offers no fix for a
should-have. For each one declined, run `{{cli}} build decline <id> <H-n> --worktree <wt>`. It
prints the issue's URL, followed by `(already filed)` or `(already filed, closed)` when the issue
was there before, which is success too. Then act on `next:`:

- `next: fix`: step 5.
- `next: ci`: step 6, whatever the should-haves were.

## 5. The fixer answers the blockers

Ask the human whether the fixer should answer the blockers in the review worktree. On no, print the
blockers and stop: the slice stays in review, and the human decides what happens to it.

On yes, run `{{cli}} instructions fixer <id> --worktree <wt>`. Spawn the fixer with that output as
its whole prompt, followed by the verdict file's path in the review worktree,
`<wt>/.slicekit/reviews/<the verdict file's name>`, and every blocker's ID.

When the fixer reports, run these two in this order:

1. `{{cli}} build commit <id> --worktree <wt> --message "fix: <ids>" --require-green`, with the
   answered IDs joined by `, `. A failing test run or a frozen test is refused, and
   `nothing to commit` means the fixer changed nothing: send the fixer back with what was printed.
2. `{{cli}} build pr <id> --worktree <wt>`. Without `--notes` it keeps the pull request's live body,
   pushes the fix to the slice branch and returns the pull request to draft. A `verdict` line it
   prints is the building session's next in-loop round: ignore it here. When it refuses with
   `pass --notes <file>`, the body lost a section: print the refusal and stop, since the notes are the
   building session's.

Then start again at step 2 with `{{cli}} review start <n>`: the new head needs its own independent
verdict, at the next round. Tell the human that the slice branch moved under the building session:
that session syncs its worktree with `build sync <id>` before its next push.

## 6. Green CI, then ready

Run `{{cli}} build finish <id> --worktree <wt>`. Each call waits at most 90 seconds for CI on the
pull request's head. On exit 1, by what it prints:

- `CI failed on <sha7>: <url>`: print it and stop; tell the human CI failed on the reviewed head.
- `CI still running on <sha7>; …`: nothing has changed; run the same command again. When it still
  says so after five tries, print it and stop; tell the human CI has not finished.
- `no CI run found for <sha7>; check that the workflow ran`: print it and stop.
- A refusal that ends `run slicekit build sync <id>`, such as the branch behind origin or the head
  not in the worktree: run `{{cli}} build sync <id> --worktree <wt>`, then this command again. When
  it refuses the same way after the sync, print it and stop.

On exit 0 it prints `ci-green` and the CI run's URL, then one line:

- `ready`: print the pull request's number and URL and the CI run's URL, and stop. Tell the human
  the slice is ready: a human merges, never this session.
- `ready: not yet: <reason>`: print it and stop; tell the human the reason the slice is not ready.
- `ready: waiting for an independent review; …`: the verdict recorded in step 4 is not on the live
  head. Print it and stop; tell the human to run `/slicekit review <n>` in a new session.
