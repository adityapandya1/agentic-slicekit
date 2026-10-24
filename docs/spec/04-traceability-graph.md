# 04 — Traceability and the graph

A deterministic graph built from the kit's own IDs and git, the questions it answers from the CLI,
the multi-repo workspace, and the local visualize page. Decisions cited: D-13, D-15, D-23.

## REQ-4.1 Nodes and edges

The graph SHALL contain nodes of kind: intake, decision, requirement, gap, contract, phase, slice,
test, commit, pull-request, file, release, runbook-section, repo. Edges: `cites`, `covers` (test →
requirement), `implements` (slice → requirement), `touched` (commit → file), `in` (commit → slice,
slice → phase, file → repo), `reviewed-by` (pull-request → verdict), `released-in` (pull-request →
release), `produces` and `consumes` (slice → contract). Every node carries the path or ID it came
from; every edge carries the file and line, or the commit SHA, that produced it.

Enforced by: `slicekit graph` (schema validation on write).

## REQ-4.2 Sources, all deterministic

The builder SHALL read only: the markdown under the docs root (IDs by pattern); `git log` on every
branch that matches `slice/*` and the default branch, with trailers and touched files; the state,
verdict and journal files; and pull request metadata fetched through `gh` once per SHA and cached
under `.slicekit/graph/cache/`. It SHALL make no model call. With no network it SHALL build from the <!-- slicekit:example -->
cache and mark pull-request nodes `stale`.

Scenario: GIVEN `gh` is not installed WHEN graph runs THEN it builds every node except pull requests
and prints "pull requests skipped: gh not found".

Enforced by: `slicekit graph`.

## REQ-4.3 Tests link to requirements by ID

A test SHALL be linked to a requirement when its name or a comment in its file contains a REQ ID.
This is language-neutral. `slicekit check` SHALL fail a slice branch whose new or changed test files
contain no REQ ID (the `citations` rule).

Scenario: GIVEN `BillingTest.java` with `@DisplayName("REQ-2.3 refuses negative amount")` WHEN graph
runs THEN a `covers` edge exists from that test to REQ-2.3 with the file and line.

Enforced by: `slicekit graph`; `slicekit check`.

## REQ-4.4 Build and storage

`slicekit graph` SHALL write `.slicekit/graph/graph.json` with `schemaVersion`, `builtAt`, the <!-- slicekit:example -->
default-branch SHA it was built from, nodes and edges. It SHALL be incremental: a second run walks
only commits after the recorded SHA and files whose hash changed. `.slicekit/graph/` SHALL be in `.gitignore` <!-- slicekit:example -->
(D-23). CI SHALL build it and upload it as an artefact on every pull request.

Enforced by: `slicekit graph`; init writes the ignore rule; the workflow uploads.

## REQ-4.5 Queries

The CLI SHALL answer the following, in text by default and JSON with `--json`, each in under two
seconds on a repository with ten thousand commits:

| Command | Answer |
|---|---|
| `slicekit trace REQ-2.3` | the slices, tests, commits, pull requests and files under that requirement, as a tree |
| `slicekit trace --file <path>` | the requirements, decisions and slices above that file |
| `slicekit history <path> [<path>…]` | newest first: the slices and pull requests that touched those files, with each one's verdict and release |
| `slicekit impact <REQ or path>` | files, slices and contracts that share files or contracts with it, across repositories |
| `slicekit uncovered` | requirements with no covering test; tests naming no requirement; commits on the default branch with no slice trailer |
| `slicekit shipped P1` | the requirements and pull requests in that release, with links |
| `slicekit status [--json] [--sync] [--write]` | every phase and slice with state; `--sync` reads merged pull requests from `gh`; `--write` regenerates `BUILD.md` |

Scenario: GIVEN a failing test in `src/billing/` WHEN `slicekit history src/billing` runs THEN the <!-- slicekit:example -->
output lists P1/S-03 (PR 14, APPROVE, released P1) above P1/S-07 (PR 21, APPROVE, unreleased), and
nothing else.

Enforced by: `slicekit <query>`; performance tested in the kit's own suite against a generated
10,000-commit fixture.

## REQ-4.6 Multi-repo workspace

A program repository MAY hold `.slicekit/workspace.json` listing repositories as `{ name, path or <!-- slicekit:example -->
url, defaultBranch }` (D-15). `slicekit graph` in a program repository SHALL build across every
listed repository that is present on disk, prefixing file nodes with the repo name, and SHALL report
the ones it could not reach. A slice file's `repo:` field SHALL name a workspace entry. A contract
file in `spec/contracts/C-<n>-<name>.md` SHALL name its producer slice and consumer slices; the graph
draws `produces` and `consumes` edges, which `impact` follows across repositories.

Scenario: GIVEN contract C-2 "order.created topic" produced by P1/S-04 in repo `orders` and consumed
by P1/S-09 in repo `billing` WHEN `slicekit impact C-2` runs THEN both slices and both repos are <!-- slicekit:example -->
listed.

Enforced by: `slicekit graph`; `slicekit check` (slice `repo:` names a workspace entry; a contract
names at least one producer and one consumer).

## REQ-4.7 Visualize

`slicekit visualize [--port]` SHALL start Node's own HTTP server on localhost, serve one static HTML
page and `graph.json`, open nothing automatically, print the URL, and exit on Ctrl-C. The page SHALL
offer six views: requirement tree, phase board (slices by state), slice timeline, file heat map (how
many slices touched each path), cross-repo contracts, and what shipped per release. Clicking a node
shows its files, commits and pull requests with links to the git host. The page SHALL load no
external resource and SHALL work with the file opened directly from disk, with the graph inlined.

Scenario: GIVEN a laptop with no network WHEN visualize runs THEN every view renders.

Enforced by: the kit's own end-to-end test (05) using a headless browser only if one is present,
otherwise an HTML and script lint.

## REQ-4.8 What the graph is not

The graph SHALL NOT parse source code, infer calls or imports, or classify anything. Where a team
wants a code graph, graphify or a similar tool sits alongside; the kit's documentation says so and
gives the one-line way to run both.

Enforced by: advisory; a scope line in the README.
