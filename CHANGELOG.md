# Changelog

Each version of slicekit on npm, newest first. A 0.x version may change how a command works.

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
