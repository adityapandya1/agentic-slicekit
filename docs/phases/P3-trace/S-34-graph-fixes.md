---
slice: P3/S-34
name: Graph and visualize fixes
repo: .
group: C
runbook: no
requirements: [REQ-4.2, REQ-4.4, REQ-4.5, REQ-4.6, REQ-4.7, REQ-3.11]
decisions: [D-23, D-47, D-51]
---

## Done when

1. The workspace collision check counts only the first segment of tracked paths that hold a slash. So an entry whose folder is a git submodule of the program (one gitlink, the node `file:<name>`), or whose name is that of a top-level file, is no longer refused by `graph` or `check`. An entry named like a top-level folder with tracked files under it is still refused with `repos[<i>].name <name> is also a top-level path of the program repository` (issue #62).
2. In visualize, a pull request node that carries `repo` is labelled `<repo>#<n>` in its title and in its pull request line, the way `src/graph/render.js` names it; a pull request of the program repository stays `#<n>`. The link is unchanged (issue #63).
3. `history` breaks a tie on the newest commit by slice ID, in code-unit order. So two slices whose newest commit is the same commit print in one order, whatever order the index returns the `in` edges (issue #48).
4. A test sends commits whose committer dates carry different UTC offsets through `history` itself, on a repository built by `test/helpers/graph-fixture.js`. In that test the text order of the dates and the instant order disagree, so it fails if `newer` or the final sort in `src/graph/history.js` goes back to comparing text (issue #49).
5. The gate job keeps the pull request cache between runs. A step `Restore the pull request cache` (`actions/cache/restore`) comes before `Build the graph`, and a step `Save the pull request cache` (`actions/cache/save`, `if: always()`) comes after it. Both name the path `.slicekit/graph/cache` and the key `slicekit-pr-cache-${{ github.run_id }}`, the restore with restore key `slicekit-pr-cache-`, and both are pinned by SHA to the `actions/cache` entry that `templates/workflow/pins.json` gains (v4.2.3). Pins without that entry are refused with `pins: actions/cache needs a 40-hex sha and a vX.Y.Z tag`. So a run fetches only the pull requests that are open or not yet cached, not one per pull request in the history. The kit's own workflow is regenerated with `workflow --write` (issue #37, D-51).
6. The header comment of `src/graph/prs.js` states the rule the code keeps: a merged or closed answer is never fetched again, and an open one is fetched again whenever the host can be reached. A cache entry is written as `{pr}` alone. The unread `key` leaves the cache entry, `prNumbers`' entries and the state fragment's pull request references. A cache entry written earlier with a `key` still reads (issue #38).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `graph/workspace-collision.test.js » an entry whose folder is a submodule, or named like a top-level file, is no collision` | happy | REQ-4.6 |
| `graph/workspace-collision.test.js » an entry named like a top-level folder with tracked files is still refused` | negative | REQ-4.6 |
| `visualize-workspace.test.js » a workspace pull request is labelled with its repository and a program one is not` | happy | REQ-4.7 |
| `graph/history-order.test.js » two slices tied on one newest commit print in slice order, whatever the edge order` | negative | REQ-4.5 |
| `graph/history-order.test.js » history orders commits whose dates carry different offsets by instant` | happy | REQ-4.5 |
| `workflow-pr-cache.test.js » the gate restores the pull request cache before the graph and saves it after` | happy | REQ-4.4 |
| `workflow-pr-cache.test.js » pins without actions/cache are refused, naming it` | negative | REQ-3.11 |
| `graph/pr-cache.test.js » a cache entry holds the answer alone, and an entry with a key still reads` | happy | REQ-4.2 |

## Expected changes

`src/graph/workspace.js`, `src/graph/history.js`, `src/graph/prs.js`, `src/graph/kitfiles.js`, `src/visualize/client.js`, `src/workflow.js`, `templates/workflow/slicekit.yml`, `templates/workflow/pins.json`, `.github/workflows/slicekit.yml`, `test/fixtures/golden/workflow/`, tests.

## Tasks

### Task 1: Workspace, history and visualize

**Files:** Modify `src/graph/workspace.js` (`topLevel`), `src/graph/history.js` (the final sort), `src/visualize/client.js` (`title` and `prLine`). Create `test/graph/workspace-collision.test.js`, `test/graph/history-order.test.js` and `test/visualize-workspace.test.js`.

- [ ] **Step 1: Failing tests**: the five tests above. The submodule case adds a gitlink with `git update-index --add --cacheinfo 160000,<sha>,bill`. The tie case builds a probe index whose edges come in two orders, as the issue's reproduction does. The visualize test runs the page's view functions under `node:vm` on the workspace fixture of `test/helpers/workspace-fixture.js`.
- [ ] **Step 2: Implement**; run `node --test test/graph/workspace-collision.test.js test/graph/history-order.test.js test/visualize-workspace.test.js test/graph/workspace.test.js test/graph/queries.test.js test/visualize.test.js` → PASS.
- [ ] **Step 3: Commit** `fix(P3/S-34): a submodule entry is no collision, history ties by slice, workspace pull request labels`.

### Task 2: The pull request cache

**Files:** Modify `src/graph/prs.js` (the header comment, `writeCache`'s entry, `prNumbers`), `src/graph/kitfiles.js` (the state fragment's pull request references), `src/workflow.js` (`ACTIONS` gains `cache: 'actions/cache'`), `templates/workflow/slicekit.yml` (the two steps), `templates/workflow/pins.json`, the golden files, and the kit's own `.github/workflows/slicekit.yml` (regenerated with `slicekit workflow --write`). Create `test/workflow-pr-cache.test.js` and `test/graph/pr-cache.test.js`.

- [ ] **Step 1: Failing tests**: the three tests above.
- [ ] **Step 2: Implement**; run `node --test test/workflow-pr-cache.test.js test/graph/pr-cache.test.js test/workflow.test.js test/graph/prs.test.js test/graph/build.test.js`, `node bin/slicekit.js workflow --check` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 3: Commit** `fix(P3/S-34): the gate keeps the pull request cache; prs.js says the rule it keeps`.
