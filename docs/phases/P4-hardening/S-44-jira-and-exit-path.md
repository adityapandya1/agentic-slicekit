---
slice: P4/S-44
name: Jira Cloud as a tracker, and the exit path for a second agent tool
repo: .
group: D
runbook: yes
requirements: [REQ-1.1, REQ-5.8]
decisions: [D-68, D-74, D-75]
---

## Done when

1. `tracker.kind: "jira"` with `tracker.baseUrl`, `tracker.project` and `tracker.issueType` selects `src/adapters/tracker/jira.js`; a missing key, or a base URL that is not https, is refused by `getTracker` naming it (REQ-1.1, D-74).
2. `open`, `comment` and `find` call Jira Cloud's REST API with the email and token from `JIRA_EMAIL` and `JIRA_API_TOKEN`; a missing variable is an error naming it; the token appears in no output, error or file (D-74).
3. `find` returns the oldest issue whose summary begins `[<slice>] <finding>:`, open unless its status category is done (D-74).
4. `docs/adapters.md` holds the Jira section and the exit path for a second agent tool: the files a renderer writes, each hook subcommand with its event and the JSON it reads and writes, the deny rules, and the parts already tool-neutral (REQ-5.8, D-75).
5. With `tracker.kind` unset or `github-issues`, nothing changes (REQ-1.1).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `tracker.test.js » jira open, comment and find call the Jira REST API with the configured project` | happy | REQ-1.1 |
| `tracker.test.js » jira without JIRA_API_TOKEN fails naming the variable and prints no token` | negative | REQ-1.1 |
| `config.test.js » a jira tracker without baseUrl or project, or with an http URL, is refused` | negative | REQ-1.1 |
| `readme.test.js » docs/adapters.md names every hook subcommand in its exit path` | happy | REQ-5.8 |

## Expected changes

`src/adapters/tracker/jira.js`, `src/adapters/tracker/index.js`, `src/adapters/tracker/fixture.js`, `docs/adapters.md`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The Jira adapter

**Files:** Create `src/adapters/tracker/jira.js`. Modify `src/adapters/tracker/index.js`, `src/adapters/tracker/fixture.js`, `test/tracker.test.js`, `test/config.test.js`.

- [ ] **Step 1: Failing tests** — the first three tests above; the network is replaced by a `fetch` passed in, as `intake` does.
- [ ] **Step 2: Run** `node --test test/tracker.test.js test/config.test.js` → FAIL.
- [ ] **Step 3: Implement** `POST /rest/api/3/issue`, `POST /rest/api/3/issue/{id}/comment`, and `GET /rest/api/3/search/jql` with `project = <key> AND summary ~ "<prefix>"` ordered by created; Basic auth from the two variables. The config keys are validated by the tracker's own `validate(cfg)`, called from `getTracker`, so `src/config.js` does not change.
- [ ] **Step 4: Run** the same → PASS.

### Task 2: The docs

**Files:** Modify `docs/adapters.md`, `docs/runbook.md`, `test/readme.test.js`.

- [ ] **Step 1: Failing test** — the fourth test above.
- [ ] **Step 2: Write** the Jira section and the exit path; the runbook says which variables Jira needs.
- [ ] **Step 3: Run** `node --test test/readme.test.js` → PASS.
- [ ] **Step 4: Commit** `feat(tracker): Jira Cloud; docs: the exit path for a second agent tool`.
