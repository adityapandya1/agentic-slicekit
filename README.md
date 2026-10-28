# Agentic SliceKit

Agentic SliceKit is a zero-dependency Node 22 kit for building software with AI coding agents on
Claude Code, one slice at a time, with a traceable line from every requirement to its tests,
commits, pull requests and releases. The spec stays true because a machine checks it on every stop
and in CI, not because anyone remembers to update it.

## Status: preview

Phases 1 and 2 work: intake, specify, the gap scan, plan, the build from red tests to green, the
review loop, the independent review and `/slicekit build --parallel`. Phases 3 and 4 add the
traceability graph and its queries, release, ops and audit, and the other examples (`fullstack`
and `data`).

npm holds only the 0.0.1 placeholder under the name `slicekit`, and it does nothing. The first real
release on npm is 0.1. Until then, run the kit from a clone. It needs Node 22 or later and git. It
has no dependencies, so there is nothing to install:

```sh
git clone https://github.com/adityapandya1/agentic-slicekit
cd agentic-slicekit
node bin/slicekit.js --version
```

`docs/spec/00-overview.md` says what the kit is and why, `docs/decisions.md` holds every choice
made so far, and `BUILD.md` shows the order the kit is built in. The kit is built with itself.

## Walkthrough

This takes about ten minutes. It builds the one slice of `examples/backend`, P1/S-01 "Greet a name",
from `todo` to `merged`: red tests, green code, a review round, an independent review, green CI and
the merge.

In your own project you type two commands into Claude Code, `/slicekit build` and
`/slicekit review`, and the kit's agents write the tests, the code and the verdicts. Here each step
is the command line that those two commands run, and the files the agents would write are copied
in from `examples/walkthrough`. A local bare repository stands in for GitHub's copy of the project,
and two fixture directories stand in for its pull requests and issues. So the walkthrough needs no
account, no agent and no network.

Run it from the root of your clone, in bash. On Windows, use Git Bash. The kit's own test runs these
blocks as written, in order, in one shell.

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
clone.

```sh
cd "$WORK/greeting"
git init -q -b main
git remote add origin "$WORK/origin.git"
node "$KIT/bin/slicekit.js" init --shape backend --cli "node $KIT/bin/slicekit.js"
node "$KIT/bin/slicekit.js" status --write
```

The kit's git hook refuses a commit on `main` unless `ALLOW_PROTECTED_COMMIT=1` is set. This first
commit is the one time it is needed.

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

### 4. Red tests, then green code

In `/slicekit build` the developer agent writes the tests first. `build red` runs them, refuses
them unless they fail, and commits them. From then on the tests are frozen: a later commit that
changes them is refused.

```sh
mkdir -p "$WT/test"
cp "$KIT/examples/walkthrough/test/greet.test.js" "$KIT/examples/walkthrough/test/greet-empty.test.js" "$WT/test/"
node "$KIT/bin/slicekit.js" build red P1/S-01 --tests test/greet.test.js,test/greet-empty.test.js --worktree "$WT"
```

Then the developer agent writes the code. `build commit --require-green` commits it only when every
test passes.

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

In `/slicekit build` the reviewer agent writes the verdict now. The copy here is an `APPROVE` with
no findings. `build verdict` checks it, commits it to the branch and prints the next step, `ci`.

```sh
mkdir -p "$(dirname "$VERDICT")"
cp "$KIT/examples/walkthrough/P1-S-01-r1.md" "$VERDICT"
node "$KIT/bin/slicekit.js" build verdict P1/S-01 "$VERDICT" --worktree "$WT"
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

### 7. The independent review

This is what `/slicekit review 1` runs, in a new Claude Code session. `review start` checks out the
pull request's head in a fresh worktree, `.worktrees/review-P1-S-01`, and prints the slice, the
worktree, the round and the verdict path.

```sh
node "$KIT/bin/slicekit.js" review start 1 | tee "$WORK/review.txt"
VERDICT="$(sed -n 's/^verdict //p' "$WORK/review.txt")"
```

The independent reviewer's verdict is round 2, also an `APPROVE`. `build verdict --independent`
commits it in the review worktree and pushes it. CI reports on that new head.

```sh
cp "$KIT/examples/walkthrough/P1-S-01i-r2.md" "$VERDICT"
node "$KIT/bin/slicekit.js" build verdict P1/S-01 "$VERDICT" --independent --worktree .worktrees/review-P1-S-01
node "$KIT/examples/walkthrough/host.js" ci 1 success
```

`build finish` now prints `ready`: CI is green and the independent verdict is on this head.

```sh
node "$KIT/bin/slicekit.js" build finish P1/S-01 --worktree .worktrees/review-P1-S-01
```

### 8. The merge

A human merges. On GitHub you press Merge; here `host.js merge` makes the same merge in the bare
repository. Then pull `main`, and `status --sync` reads the merge from the git host and moves the
slice to `merged`.

```sh
node "$KIT/examples/walkthrough/host.js" merge 1
git pull -q --ff-only
node "$KIT/bin/slicekit.js" status --sync
node "$KIT/bin/slicekit.js" status
```

The last line reads `P1/S-01  merged  PR #1  Greet a name`. `$WORK` holds the project, the bare
repository and the fixture directories. Remove it when you are done.

## Scope

The kit does not parse source code. Its graph is built from its own IDs and from git: requirements,
decisions, slices, tests, commits, pull requests and releases. It infers no calls or imports. For a
code graph, graphify or a similar tool sits alongside. With graphify installed as its own README
says, one Claude Code session runs both: `/graphify .` for the code graph, then `/slicekit build`.

## How the hooks find slicekit

`slicekit init` writes the hook command as `node node_modules/slicekit/bin/slicekit.js` when the
repository has a local install, and `slicekit` otherwise, which needs slicekit on PATH. When neither
is found, init still writes `slicekit` and warns that the hooks will fail until it is installed; it
never fetches slicekit from the registry. `cli` in `.slicekit/config.json` (or `init --cli <command>`)
overrides that choice, and init and update warn when the command does not answer `--version`. The hooks run from the session's working directory, so
a worktree outside the repository tree needs an absolute path in `cli` or a global install (D-30).

License: MIT.
