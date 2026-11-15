# Changelog

Each version of slicekit on npm, newest first. A 0.x version may change how a command works.

## 0.5.1

- P6/S-53 Jira tracker (#176)
- P6/S-52 Guards (#177)
- P6/S-51 Versions and the build loop (#179)

## 0.5.0

Phase 5: Ops.

- P5/S-21 Runbook rule and `/slicekit release` (#150)
- P5/S-22 Observability steps in CI (#149)
- P5/S-23 `/slicekit ops` and `/slicekit audit` (#156)
- P5/S-24 Examples, walkthrough, user guide (#161)
- P5/S-48 Versions follow the plan, published from CI (#139)
- P5/S-49 Release version fixes (#147)
- P5/S-50 Examples follow the version, and the review leftovers of Phase 5 (#169)

## 0.4.0

Phase 5: Ops.

- P5/S-21 Runbook rule and `/slicekit release` (#150)
- P5/S-22 Observability steps in CI (#149)
- P5/S-23 `/slicekit ops` and `/slicekit audit` (#156)
- P5/S-24 Examples, walkthrough, user guide (#161)
- P5/S-48 Versions follow the plan, published from CI (#139)
- P5/S-49 Release version fixes (#147)

## 0.3.4

- P5/S-23 `/slicekit ops` and `/slicekit audit` (#156)

## 0.3.3

- P5/S-22 Observability steps in CI (#149)
- P5/S-21 Runbook rule and `/slicekit release` (#150)

## 0.3.2

- P5/S-49 Release version fixes (#147)

## 0.3.1

- P5/S-48 Versions follow the plan, published from CI (#139)

## 0.3.0

Phase 4: the guards refuse what they cannot judge, the git host's rules are checked, the state sync
goes up as a pull request, and versions follow the plan and are published from CI. The first version
published from CI, with a provenance attestation.

### New

- `slicekit check --ci` fails with `frozen test changed after red: <path>` when a test of a slice's
  evaluation set differs from its content at the red commit. It reads the state file, the red commit
  and the tests from git objects, so a file hidden with `git update-index --assume-unchanged` or
  `--skip-worktree` is judged by its committed content (#71).
- `agents.denyPaths` in `.slicekit/config.json` lists glob patterns agents may not read or change.
  `init` and `update` render each one into `.claude/settings.json` as `Read` and `Edit` deny entries,
  and the `pre-edit` and `pre-bash` hooks deny a matching path, naming the pattern. A team's own deny
  entries are kept.
- A new check rule, `host-rules`: the rulesets on the default branch must require a pull request, an
  approval (from a code owner when CODEOWNERS exists) and the kit's CI checks, and refuse a force push.
  Each missing rule is named. `slicekit init --protect`, run by a human with admin rights, sets the
  missing ones as one ruleset named `slicekit`.
- `slicekit sync open`: after a merge, the state change goes up as a pull request `[sync] state after
  <short sha>` on a `sync/<short sha>` branch, and the workflow is started on that branch so its checks
  run. The sync job no longer pushes to the default branch.
- Journal commits must be signed: under `--ci` the journal rule names each commit that changes a
  journal file and whose signature the git host does not verify. The sync pull request adds one line
  per journal file the merge changed to `.slicekit/journal-heads.log`, and `check --ci` recomputes each
  line from git and the run.
- `ci.runsOn` sets the runner label, or labels, of every generated job. A repository with a Maven or
  Gradle build file, or a declared command that calls `mvn`, `gradle` or `./gradlew`, gets a JDK of
  `ci.java` (default 25) in each job that runs a team command.
- `tracker.kind: "jira"` sends declined should-haves to Jira Cloud, with the email and token read from
  `JIRA_EMAIL` and `JIRA_API_TOKEN`.
- `docs/adapters.md` describes the exit path for a second agent tool: the files a renderer writes,
  each hook subcommand with the JSON it reads and writes, and the deny rules.
- `slicekit init --default-branch <name>` names the default branch.
- `release.auto` in `.slicekit/config.json`: the sync pull request after a slice merge sets the next
  version in `package.json` (a patch per slice, a minor per completed phase), adds its `CHANGELOG.md`
  section and carries the render at that version. `check --ci` recomputes all three on the sync pull
  request and names any file that differs.
- The kit is published from CI: a merge to `main` whose version is neither on npm nor tagged is
  published with provenance through npm trusted publishing, after the author approves it in the
  environment `npm`, and then tagged `v<version>`. No npm token is stored.

### Changed

- The `pre-bash` hook denies a command it cannot judge, in every session: `git` or `gh` run through
  `eval`, a shell's `-c` or an interpreter's inline code, and a git command whose subcommand, ref or
  remote comes from a variable or a command substitution. It also denies a Bash write to a test frozen
  for the active slice, `slicekit init --protect`, and a `gh api` call that writes to a repository's
  rulesets or branch protection.
- With paths staged, `build commit` commits only the staged paths and leaves the rest of the worktree
  as it was; with nothing staged it commits every changed path, as before (#69).
- With no origin, no `init.defaultBranch` and a current branch that is neither `main` nor `master`,
  `init` refuses and asks for `--default-branch <name>`; it no longer protects the current branch (#87).

### Fixed

- `build commit` commits a deletion already staged with `git rm`; it failed with "pathspec did not
  match" (#69).
- `build amend --reason <text>` with no test named commits a change to the slice file alone when every
  test the slice names is already unfrozen (#72).
- The references rule no longer reports a path under `.slicekit/rendered/<version>/` named in a verdict
  already on the default branch, so a version bump does not fail `check` on merged verdicts (#75).
- `init` un-ignores `.slicekit/journal-heads.log`, and appends its un-ignore rules again when a later
  rule such as `*.log` overrides them, so the sync job's `git add` is no longer refused.

## 0.2.1

Fixes for a new user's first minutes.

- `slicekit init` writes the repository's own default branch as `defaultBranch` and as the protected
  branch: the branch `origin`'s HEAD points at when it still exists; else the first of `main`, `master`
  and git's `init.defaultBranch` that is a local branch; else, in an empty repository, the branch it is
  on when it has one of those names; else `main`. Any other branch you are on is never taken, since the default branch is protected and
  would refuse your commits. An existing config is left as it is.
  It wrote `main` every time, so in a repository on `master` every graph command failed (#78).
- `slicekit <command> --help` prints that command's usage on standard output and exits 0. It was refused
  as an unknown option (#77).
- `test/check/references.test.js` names the requirement it checks, so the graph no longer counts it as
  covering REQ-1.1 through its fixture text (#83).

## 0.2.0

Phase 3: the traceability graph, its queries and views, and workspaces that span several
repositories.

### New

- `slicekit graph` builds `.slicekit/graph/graph.json` from the kit's own IDs and from git: requirements,
  decisions, slices, commits, files, tests, pull requests, verdicts and releases, and the edges between
  them. It is not a code graph: no source file is parsed, and a test file counts as covering a
  requirement when one of its lines names the requirement's ID. A second run walks only the new
  commits; `graph --full` rebuilds from scratch. Pull requests are fetched once each and cached; with
  `gh` missing, the graph is built without them.
- `slicekit trace <REQ>` prints the slices that implement a requirement, with their pull requests,
  commits and files, and the tests that cover it. `slicekit trace --file <path>` prints the slices that
  touched a file, with their requirements and decisions.
- `slicekit history <path>…` prints one line per slice that touched the paths, newest first, with its
  pull request, its verdict and the release that shipped it.
- `slicekit uncovered` lists the requirements with no covering test, the tests that name no
  requirement, and the commits on the default branch with no slice trailer.
- `slicekit shipped P<n>` prints a phase's release record, its requirements and its pull requests.
- `slicekit visualize` serves the graph as one page on `127.0.0.1`; `visualize --write <file>` writes it
  as a single HTML file that loads nothing from the network. Six views: requirements, board, timeline,
  heat, contracts and releases. Clicking a node shows its files, commits and pull requests.
- Workspaces: `.slicekit/workspace.json` lists other repositories, and `graph` walks each one found on
  disk alongside the program repository. `slicekit impact <REQ|C-n|slice|path>` prints the contracts,
  slices, files and repositories a change reaches, across repositories.
- A new check rule, `workspace`: a slice that names a repository the workspace file does not list, and
  a contract with no producer or no consumer, are findings.
- A new check finding: a test file a slice branch adds or changes that names no requirement.
- `trace`, `history`, `uncovered`, `shipped` and `impact` take `--json`.
- `slicekit build config <id>` commits a slice's change to `.slicekit/config.json` as the kit's own step
  (#51).

### Improved

- CI skips the tests on a push that changes only the kit's bookkeeping (state files, verdicts,
  `BUILD.md`), decided by the new `slicekit ci bookkeeping`. `ci.shards` in `.slicekit/config.json`
  splits a test job into parallel shards; the kit's own Windows tests run in 3 shards, about 20 minutes
  down to about 7.
- The gate job keeps the pull request cache between runs, so a run fetches only the pull requests that
  are open, closed or new (#37). A cache entry no longer carries an unread `key`, and the cache's header
  comment states the rule the code keeps (#38).
- `slicekit instructions <role> <id> --worktree <p>` reads the slice, its requirements and its decisions
  from the worktree under review (#56).
- `test/commands/review.test.js` and `test/commands/review-loop.test.js` are split into three files
  each, replacing the module hook that split them at run time (#55).
- New tests: `build finish` and `status --sync` read CI records that carry a workflow name and event
  (#43); the `gh run list` call behind the bookkeeping walk is pinned (#53); `history` is run on
  commits whose dates carry different time zones (#49).

### Changed

- `slicekit --help` prints the usage on standard output, so `slicekit --help | less` shows it; an
  unknown command still prints it on standard error and exits 2.
- Every line of the help begins with its command's name, with no `slicekit ` prefix and no description
  after the syntax. The rule for a value that starts with `-` (write it as `--option=<text>`) is stated
  once, under options.
- The install advice is `npm install --save-dev slicekit`, in the README and in init's warning when
  slicekit is not installed.

### Fixed

- `build finish` no longer reads a run cancelled by a newer run of the same workflow as a failure; each
  workflow and event is judged by its newest run (#33).
- Two workflow files that share a display name are judged apart (#41), and a re-run that succeeds after a
  newer run failed is the commit's answer (#42).
- The bookkeeping walk passes over a run still in progress and a run whose test jobs were all skipped,
  so an edited pull request or a re-run does not run the full suite again (#52).
- `build commit` no longer refuses a merge of main that brings another slice's render commit, a version
  bump or a config change (#32), and it judges merge commits: a merge may bring in this slice's state
  file or verdicts only as a branch whose own commits were each judged (#31, D-53).
- `build verdict` refuses a review worktree on a detached head and says to run `review start` (#61).
- A workspace entry whose folder is a git submodule of the program, or whose name is that of a top-level
  file, is no longer refused as a collision (#62).
- `visualize` labels a workspace pull request `<repo>#<n>` (#63).
- `history` orders two slices that share their newest commit by slice ID, so the order is the same on
  every run (#48).

## 0.1.2

`init` ignores `node_modules/`, npm arguments are quoted on Windows (#24), and the release deprecates both placeholder versions.

## 0.1.1

The first preview on npm: Phases 1 and 2, from intake and specify to the build, the review loop and `/slicekit build --parallel`.
