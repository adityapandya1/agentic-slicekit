---
slice: P6/S-53
name: Jira tracker
repo: .
group: A
runbook: yes
requirements: [REQ-1.1, REQ-2.6]
decisions: [D-74]
---

## Done when

1. The `summary ~` value `find` sends holds no reserved character of Jira's text search unescaped: the prefix `[<slice>] <finding>:` holds `[`, `]`, `/` and `:`, and each reaches Jira escaped or not at all. The hits are still narrowed to a summary that begins with the prefix, so a looser search value changes no answer. A test sends the query to a fake Jira that parses the JQL string and the search value inside it and answers HTTP 400 for an unescaped reserved character, as Jira Cloud does (issue #110, REQ-1.1, D-74).
2. `find` follows `nextPageToken`: it reads the pages in order until one holds an issue whose summary begins with the prefix, or no token is left, so a match past the first page is returned and no duplicate issue is opened. An answer that repeats a token it gave before ends the search with a `TrackerError` naming the token, so a faulty server cannot hold the command in a loop (issue #111, REQ-1.1).
3. With `tracker.kind` set to `jira`, `declineFinding` returns a promise that resolves to the issue's URL, whether it was created and its state, after the pull request body lists the URL once; `slicekit build decline` awaits it, prints the URL on stdout and exits 0, and a second run prints `(already filed)` and opens no second issue. Both paths have a test; the network is a `fetch` the test supplies (issue #112, REQ-2.6).
4. The runbook's paragraph on the Jira tracker says what `jira find failed: HTTP 400` means and the first thing to check, and that a search reads further pages. `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `tracker.test.js » jira find sends a search value with no unescaped reserved character` | happy | REQ-1.1 |
| `tracker.test.js » jira find follows nextPageToken to a match on a later page` | happy | REQ-1.1 |
| `tracker.test.js » jira find stops with an error when a page token repeats` | negative | REQ-1.1 |
| `tracker.test.js » declineFinding with a jira tracker resolves to the issue and lists it in the pull request body` | happy | REQ-2.6 |
| `tracker.test.js » build decline with a jira tracker prints already filed and opens no second issue` | negative | REQ-2.6 |

Amended (author's standing instruction, 2026-11-15): `test/tracker.test.js`, in two places no code in the expected files can meet. The new search-value test asks `find` for a slice ID with a three-digit slice number, which the kit's slice address refuses before any request is made; it takes a two-digit one. The earlier test of the REST calls asserts that the query text holds the slice ID with its slash, which a search value free of reserved characters cannot hold; it asserts the slice ID's parts in the search value instead.

## Expected changes

`src/adapters/tracker/jira.js`, `src/adapters/tracker/index.js`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The search value and the pages

**Files:** Modify `src/adapters/tracker/jira.js`, `test/tracker.test.js`.

- [ ] **Step 1: Failing tests** — the `jira find` tests above, with the `jiraFetch` helper that file already has. The fake Jira of the first test parses the `jql` parameter: it reads the string literal after `summary ~`, undoes the JQL string escapes, and answers HTTP 400 when a reserved character of the text search stands in it unescaped. The second test answers a first page of older issues that share the prefix's words with a token, and the match on the next page.
- [ ] **Step 2: Run** `node --test test/tracker.test.js` → FAIL.
- [ ] **Step 3: Implement** the search value and the page loop in `find`; `pickFinding` narrows each page as it narrows the one page today. The existing Jira test passes unchanged.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `fix(tracker): jira find escapes its search value and reads every page`.

### Task 2: The promise path of build decline

**Files:** Modify `src/adapters/tracker/index.js`, `test/tracker.test.js`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the decline tests above, on the kit the decline tests of that file already build, with a fixture host (`SLICEKIT_GITHOST_FIXTURE`) and a Jira config. `declineFinding` is called with `jiraTracker(cfg, env, fetch)`. `build decline` runs in this process through `main` of `src/cli/index.js`, with the global `fetch` replaced for the test and restored after it; when that cannot reach the adapter, `getTracker` gains a parameter that passes a `fetch` on, and nothing else in it changes.
- [ ] **Step 2: Run** `node --test test/tracker.test.js` → the tests fail or pass. These tests pin behaviour that exists; a test that passes at once is kept, and one that fails names a defect of the promise path to fix in `src/adapters/tracker/jira.js` or to report when it sits in a file this slice does not expect to change.
- [ ] **Step 3: Implement** the seam if it is needed, and the runbook's lines.
- [ ] **Step 4: Run** the same, `node --test test/config.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `test(tracker): the promise path of build decline with a jira tracker`.
