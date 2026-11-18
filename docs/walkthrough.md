# The ten-minute walkthrough

This page builds the one slice of `examples/backend`, P1/S-01 "Greet a name", from `todo` to
`merged` on your machine. The kit's own test runs its `sh` blocks as written, in order, in one
shell, and checks that every line in its `text` blocks is one the run prints.

## Before you start

The walkthrough runs from a clone of the kit, because it copies files only the repository holds
(`examples/backend` and `examples/walkthrough`). It needs Node 22 or later and git.

```sh
git clone https://github.com/adityapandya1/agentic-slicekit
cd agentic-slicekit
node bin/slicekit.js --version
```

The last line prints the version the clone carries.

## Walkthrough

This takes about ten minutes. It builds P1/S-01 from `todo` to `merged`: red tests, green code, a
review round, an independent review, green CI and the merge.

In your own project you type two commands into Claude Code, `/slicekit build` and
`/slicekit review`, and the kit's agents write the tests, the code and the verdicts. (Each command
also has a file of its own, so `/slicekit-build` and `/slicekit-review` work too.) Here each step
is the command line that those two commands run, and the files the agents would write are copied
in from `examples/walkthrough`. A local bare repository stands in for GitHub's copy of the project,
and two fixture directories stand in for its pull requests and issues. So the walkthrough needs no
account, no agent and no network.

Run it from the root of your clone, in bash. On Windows, use Git Bash. After each step a `text`
block shows lines the step prints. Commit SHAs and temporary paths differ from run to run, so those
lines are left out of the blocks.

git needs a name and an email set (`git config --global user.name` and `user.email`), since the kit
makes commits. If your git signs commits, it signs these too, and may ask for your key at each of
them. To skip that for this run, run `export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false`
first.

### 1. A project to build in

`KIT` is your clone. On Windows, `pwd -W` gives a path that Node can read; elsewhere it fails and
`pwd` is used. `WORK` is a new temporary directory for everything else.

```sh
KIT="$(pwd -W 2>/dev/null || pwd)"
WORK="$(mktemp -d)"
cp -R examples/backend "$WORK/greeting"
git init -q --bare "$WORK/origin.git"
mkdir "$WORK/githost" "$WORK/tracker"
export SLICEKIT_GITHOST_FIXTURE="$WORK/githost"
export SLICEKIT_TRACKER_FIXTURE="$WORK/tracker"
```

With `SLICEKIT_GITHOST_FIXTURE` set, the kit keeps pull requests as files in that directory instead
of calling `gh`. `SLICEKIT_TRACKER_FIXTURE` does the same for issues.

### 2. Add the kit to the project

These are the steps in `examples/backend/README.md`. `init` adds the hooks, the Claude Code
commands and the rest of the docs layout. `--cli` tells the hooks how to run the kit from your
clone. The path inside it is quoted, so a clone under a folder with a space in its name still works.

```sh
cd "$WORK/greeting"
git init -q -b main
git remote add origin "$WORK/origin.git"
node "$KIT/bin/slicekit.js" init --shape backend --cli "node \"$KIT/bin/slicekit.js\""
node "$KIT/bin/slicekit.js" status --write
```

`init` prints one line per file it writes, among them:

```text
created .claude/commands/slicekit-build.md
created .claude/commands/slicekit-review.md
created .github/workflows/slicekit.yml
created BUILD.md
BUILD.md updated
```

The kit's git hook refuses a commit on `main` unless `ALLOW_PROTECTED_COMMIT=1` is set. This first
commit is the one time it is needed. On Windows, git may print warnings that LF will be replaced by
CRLF; they are harmless.

```sh
git add -A
ALLOW_PROTECTED_COMMIT=1 git commit -q -m "chore: slicekit init"
git push -q -u origin main
```

### 3. Pick the slice and start it

From here to step 6, the steps are what `/slicekit build` runs. `build next` prints the next slice
that is ready to build. `build start` makes its worktree and branch, and pushes the branch.

```sh
node "$KIT/bin/slicekit.js" build next
node "$KIT/bin/slicekit.js" build start P1/S-01
WT=.worktrees/P1-S-01
```

`build next` prints the slice, and `build start` the worktree's path and then the branch:

```text
P1/S-01
slice/P1-S-01-greet
```

### 4. Red tests, then green code

In `/slicekit build` the developer agent writes the tests first. `build red` runs them, refuses
them unless they fail, and commits them. From then on the tests are frozen: a later commit that
changes them is refused.

```sh
mkdir -p "$WT/test"
cp "$KIT/examples/walkthrough/test/greet.test.js" "$KIT/examples/walkthrough/test/greet-empty.test.js" "$WT/test/"
node "$KIT/bin/slicekit.js" build red P1/S-01 --tests test/greet.test.js,test/greet-empty.test.js --worktree "$WT"
```

`build red` prints the commit's SHA, then the state change:

```text
tests-red → building
```

Then the developer agent writes the code. `build commit --require-green` commits it only when every
test passes. It prints the commit's short SHA and `exit 0`, the exit of the test run.

```sh
mkdir -p "$WT/src"
cp "$KIT/examples/walkthrough/src/greet.js" "$WT/src/"
node "$KIT/bin/slicekit.js" build commit P1/S-01 --message "feat(P1/S-01): greet a name" --require-green --worktree "$WT"
```

### 5. The draft pull request and a review round

`build pr` runs the tests and `slicekit check`, pushes, and opens a draft pull request. It builds
the body from the slice file and from the notes that the developer agent reported. The last line it
prints is `verdict <path>`, the file the reviewer writes its verdict to.

```sh
node "$KIT/bin/slicekit.js" build pr P1/S-01 --notes "$KIT/examples/walkthrough/notes.json" --worktree "$WT" | tee "$WORK/pr.txt"
VERDICT="$(sed -n 's/^verdict //p' "$WORK/pr.txt")"
```

```text
#1 https://example.test/pull/1
```

In `/slicekit build` the reviewer agent writes the verdict now. The copy here is an `APPROVE` with
no findings. Its `Head:` line names the commit it reviewed, here the worktree's head. `build verdict`
checks it, commits it to the branch and prints the next step, `ci`.

```sh
sed "s/^Head: .*/Head: $(git -C "$WT" log -1 --format=%H)/" "$KIT/examples/walkthrough/P1-S-01-r1.md" > "$VERDICT"
node "$KIT/bin/slicekit.js" build verdict P1/S-01 "$VERDICT" --worktree "$WT"
```

```text
next: ci
blockers: none
should-haves: none
rounds: 1 of 2
```

### 6. Green CI

On GitHub, CI reports on each push by itself. Here `host.js ci` records a green run on the pull
request's head. `build finish` waits for CI and, on green, records `ci-green` and pushes that
record. It then prints `ready: waiting for an independent review`: a second session must review the
slice before the merge. The push made a new head, so CI reports again.

```sh
node "$KIT/examples/walkthrough/host.js" ci 1 success
node "$KIT/bin/slicekit.js" build finish P1/S-01 --worktree "$WT"
node "$KIT/examples/walkthrough/host.js" ci 1 success
```

```text
ci-green
https://example.test/runs/1
ready: waiting for an independent review; run /slicekit review 1 in a new session
```

### 7. The independent review

This is what `/slicekit review 1` runs, in a new Claude Code session. `review start` checks out the
pull request's head in a fresh worktree, `.worktrees/review-P1-S-01`, and prints the slice, the
worktree, the round and the verdict path.

```sh
node "$KIT/bin/slicekit.js" review start 1 | tee "$WORK/review.txt"
VERDICT="$(sed -n 's/^verdict //p' "$WORK/review.txt")"
```

```text
slice P1/S-01
round 2
```

The independent reviewer's verdict is round 2, also an `APPROVE`. `build verdict --independent`
commits it in the review worktree and pushes it. CI reports on that new head. It still prints
`rounds: 1 of 2`: round 2 counts all of the slice's verdicts, while `rounds` counts only the two
review rounds inside `/slicekit build`, and the independent review uses neither of them.

```sh
sed "s/^Head: .*/Head: $(git -C .worktrees/review-P1-S-01 log -1 --format=%H)/" "$KIT/examples/walkthrough/P1-S-01i-r2.md" > "$VERDICT"
node "$KIT/bin/slicekit.js" build verdict P1/S-01 "$VERDICT" --independent --worktree .worktrees/review-P1-S-01
node "$KIT/examples/walkthrough/host.js" ci 1 success
```

`build finish` now prints `ready`: CI is green and the independent verdict is on this head.

```sh
node "$KIT/bin/slicekit.js" build finish P1/S-01 --worktree .worktrees/review-P1-S-01
```

```text
ci-green
ready
```

### 8. The merge

A human merges. On GitHub you press Merge; here `host.js merge` makes the same merge in the bare
repository. The merge happened on the remote, and the slice's state is kept in files on `main`, so
pull `main` first. Then `status --sync` reads the merge from the git host and moves the slice to
`merged`.

```sh
node "$KIT/examples/walkthrough/host.js" merge 1
git pull -q --ff-only
node "$KIT/bin/slicekit.js" status --sync
node "$KIT/bin/slicekit.js" status
```

The last line reads `P1/S-01  merged  PR #1  Greet a name`:

```text
synced P1/S-01 → merged (PR #1)
P1/S-01  merged  PR #1  Greet a name
```

### 9. Clean up

Unset the two fixture variables. Otherwise a later slicekit command in this shell writes pull
requests and issues into a deleted folder, instead of calling `gh`. The same line unsets the
`GIT_CONFIG_*` variables, in case you set them above to turn signing off. Then go back to your
clone and remove `$WORK`, which holds the project, the bare repository and the fixture directories.

```sh
unset SLICEKIT_GITHOST_FIXTURE SLICEKIT_TRACKER_FIXTURE GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
cd "$KIT"
rm -rf "$WORK"
```
