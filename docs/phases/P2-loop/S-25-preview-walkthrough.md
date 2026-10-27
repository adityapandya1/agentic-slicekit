---
slice: P2/S-25
name: Preview: the README walkthrough and going public
repo: .
group: F
runbook: yes
requirements: [REQ-5.7, REQ-4.8]
decisions: [D-28]
---

## Done when

1. `README.md` opens with what the kit is in two sentences, then a `## Status: preview` section that says what works (Phases 1 and 2: intake, specify, gaps, plan, build red to green, the review loop, the independent review, `--parallel`), what Phases 3 and 4 add (the graph and its queries, release, ops and audit, the other examples), that npm holds only the 0.0.1 placeholder until 0.1 (D-26), and how to run the kit from a clone (REQ-5.7, D-28).
2. Then a `## Walkthrough` section: ten minutes on a copy of `examples/backend`, from a clone of the kit, through `init`, `build next`, `build start`, the red and green steps, `build pr`, a review round, `review start` and an independent verdict, `build finish` and the merge, to `merged` in `slicekit status`. Every command sits in a ` ```sh ` fenced block, and the blocks run in order as one shell session. Against GitHub the reader uses their own repository; the walkthrough as written uses the fixture git host and tracker (`SLICEKIT_GITHOST_FIXTURE`, `SLICEKIT_TRACKER_FIXTURE`) and a bare `origin`, so it needs no account and no network. The two steps only GitHub does (CI reporting green, pressing Merge) are one line each of the host stand-in that Task 2 adds under examples/walkthrough, and the README says that GitHub does them in a real repository.
3. Then the scope line from REQ-4.8: the kit does not parse source code, and graphify or a similar tool sits alongside, with the one line to run both.
4. The walkthrough test (Task 3) reads the walkthrough's commands from `README.md` and runs them verbatim, from the kit checkout, as one shell session; every command exits 0 and the slice ends `merged`. A command that exits non-zero fails the test with the command and its `README.md` line. The test runs in the `cmd-test` job the workflow already has, on Linux, macOS and Windows (`ci.matrix` is `true`), so the workflow file does not change.
5. The walkthrough reaches `ready` under `review.independent: "required"`, which both the kit's own `.slicekit/config.json` and `examples/backend/.slicekit/config.json` carry; neither config changes.
6. The slice publishes nothing to npm and changes no repository setting. Going public is one GitHub setting (Settings, General, Danger Zone, "Change repository visibility" to Public) that the author changes by hand after this slice merges; `docs/runbook.md` gains a "Going public as a preview" section that says so and that S-24 publishes 0.1.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `walkthrough.test.js » the README walkthrough's commands exit 0 on examples/backend` | e2e | REQ-5.7 |
| `walkthrough.test.js » the walkthrough's commands are read from its sh blocks in README order` | happy | REQ-5.7 |
| `walkthrough.test.js » a walkthrough command that fails stops the run, naming the command and its README line` | negative | REQ-5.7 |
| `walkthrough.test.js » a README with no walkthrough section or no sh block in it is refused` | negative | REQ-5.7 |
| `walkthrough.test.js » the host helper records CI and a merge only inside the fixture directory` | happy | REQ-5.7 |
| `walkthrough.test.js » the host helper refuses to run without SLICEKIT_GITHOST_FIXTURE` | negative | REQ-5.7 |
| `readme.test.js » the README opens with two sentences, then Status: preview, the walkthrough and the scope line` | happy | REQ-5.7 |
| `readme.test.js » the scope line says the kit parses no source code and names graphify` | happy | REQ-4.8 |

## Expected changes

`README.md`, `examples/walkthrough/`, `examples/backend/README.md`, `test/helpers/walkthrough.js`, `test/walkthrough.test.js`, `test/readme.test.js`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The walkthrough runner

**Files:** Create `test/helpers/walkthrough.js`, `test/walkthrough.test.js`.

**Interfaces:**
- `walkthroughCommands(text) → [{line, command}]`: the lines of every ` ```sh ` block under the `## Walkthrough` heading, up to the next `##` heading, in file order; blank lines and lines starting `#` are skipped; a line ending in `\` joins the next. `line` is the 1-based `README.md` line of the command's first line. No `## Walkthrough` heading → throws `README.md has no "## Walkthrough" section`; the section holds no `sh` block → throws `the walkthrough holds no sh block`.
- `walkthroughScript(commands) → string`: one bash script, `set -u` and no `set -e`, where each command is followed by `|| { echo "walkthrough failed at README.md:<line>: <command>" >&2; exit 1; }`, so `cd` and variables carry from one command to the next, as they do for a reader.
- `runWalkthrough(commands, {cwd, env}) → {code, stdout, stderr}`: runs the script through bash with `cwd` the kit checkout. Bash is `SLICEKIT_BASH` when set; on Windows otherwise the Git for Windows bash next to `git --exec-path` (`<prefix>/bin/bash.exe`), never `C:\Windows\System32\bash.exe`; elsewhere `bash`.

- [ ] **Step 1: Failing tests** — `the walkthrough's commands are read from its sh blocks in README order`: a README text with a `## Walkthrough` holding two `sh` blocks, a `#` comment, a blank line, a `\` continuation and a `js` block → the commands of the `sh` blocks only, in order, with their line numbers, the continuation joined. `a README with no walkthrough section or no sh block in it is refused`: both messages above. `a walkthrough command that fails stops the run, naming the command and its README line`: commands `true`, `false`, `touch after` on a temp directory → code 1, stderr `walkthrough failed at README.md:<line of false>: false`, and `after` not created.
- [ ] **Step 2: Run** `node --test test/walkthrough.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `test(walkthrough): read the README's walkthrough and run it as one session`.

### Task 2: What the walkthrough copies, and the host stand-in

**Files:** Create `examples/walkthrough/README.md`, `examples/walkthrough/host.js`, `examples/walkthrough/test/greet.test.js`, `examples/walkthrough/src/greet.js`, `examples/walkthrough/notes.json`, `examples/walkthrough/P1-S-01-r1.md`, `examples/walkthrough/P1-S-01i-r2.md`. Modify `test/walkthrough.test.js`.

**Interfaces:**
- The directory is not an example project: its README says it holds what a developer agent, a reviewer and GitHub would produce during the walkthrough, so the walkthrough runs without an agent or an account. The test and code are the ones `test/commands/build.test.js` writes for P1/S-01; the notes file is the `--notes` input of `build pr`; the two verdicts are an in-loop `APPROVE` and an independent `APPROVE` that pass `verdictProblems`.
- `node examples/walkthrough/host.js ci <n> <success|failure>`: reads `SLICEKIT_GITHOST_FIXTURE`, sets `headRefOid` in `pr-<n>.json` to the head of the pull request's branch in the repository's `origin` and writes `ci-<sha>.json` with that status and a run URL `https://example.test/runs/<n>`. `node examples/walkthrough/host.js merge <n>`: merges the pull request's branch into the default branch of `origin` with a merge commit, sets `state` to `MERGED` in `pr-<n>.json` and appends the pull request to `merged-since.json`, so `slicekit status --sync` moves the slice to `merged`. Both print one line, `ci #<n> <status> <sha7>` or `merged #<n> <sha7>`. Without `SLICEKIT_GITHOST_FIXTURE` it exits 2 with `host.js stands in for GitHub only with SLICEKIT_GITHOST_FIXTURE set`. It writes nothing outside the fixture directory and the bare `origin`.

- [ ] **Step 1: Failing tests** — `the host helper records CI and a merge only inside the fixture directory`: on a temp repository with a bare `origin`, a pushed branch and a fixture pull request 1, `ci 1 success` writes `ci-<head>.json` and the `headRefOid`; `merge 1` puts the branch's head in `origin`'s `main`, marks the pull request `MERGED` and lists it in `merged-since.json`; a listing of the working tree before and after shows no other file changed. `the host helper refuses to run without SLICEKIT_GITHOST_FIXTURE`: exit 2 with the message above. Each verdict file passes `verdictProblems`.
- [ ] **Step 2: Run** `node --test test/walkthrough.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(examples): what the walkthrough copies, and a stand-in for GitHub`.

### Task 3: The README and the walkthrough test

**Files:** Modify `README.md`, `examples/backend/README.md`, `test/walkthrough.test.js`. Create `test/readme.test.js`.

**Interfaces:**
- `README.md`, in this order: the title; two sentences on what the kit is; `## Status: preview` (Done when 1, with the clone command `git clone https://github.com/adityapandya1/agentic-slicekit` and `node bin/slicekit.js --version` in a `sh` block outside the walkthrough, since the test runs from a checkout and reaches no network); `## Walkthrough` (Done when 2); the scope line (Done when 3); then the existing `## How the hooks find slicekit` and the license line.
- The walkthrough starts in the kit checkout with `KIT="$(pwd)"` and `WORK="$(mktemp -d)"`, copies `examples/backend` to `$WORK/greeting`, makes a bare repository under `$WORK` with `git init --bare` as the copy's `origin`, sets `SLICEKIT_GITHOST_FIXTURE` and `SLICEKIT_TRACKER_FIXTURE` to empty directories under `$WORK`, and then follows `examples/backend/README.md`'s numbered steps and the build procedure's steps 1 to 9 with the CLI forms the procedure gives: `init`, `status --write`, the first commit on `main` with `ALLOW_PROTECTED_COMMIT=1`, `build next`, `build start`, copying the test then `build red`, copying the code then `build commit --require-green`, `build pr --notes`, copying `P1-S-01-r1.md` to the verdict path `build pr` printed then `build verdict`, `host.js ci`, `build finish`, `review start`, copying `P1-S-01i-r2.md` then `build verdict --independent`, `build finish` again for `ready`, `host.js merge`, `status --sync`, and `status`. Each command a reader types into Claude Code instead (`/slicekit build`, `/slicekit review`) is named in the prose beside the CLI step it runs.
- `examples/backend/README.md` keeps its steps and ends with a line pointing to the kit's README walkthrough.

- [ ] **Step 1: Failing tests** — `the README walkthrough's commands exit 0 on examples/backend`: `runWalkthrough(walkthroughCommands(README.md), {cwd: <kit root>})` → code 0, and stdout's last `status` line shows P1/S-01 `merged`. `the README opens with two sentences, then Status: preview, the walkthrough and the scope line`: the first paragraph after the title holds two sentences; the `##` headings are in the order above; the status section names npm's placeholder and 0.1. `the scope line says the kit parses no source code and names graphify`.
- [ ] **Step 2: Run** `node --test test/walkthrough.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Write** the README sections and the pointer line.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings` (the README is under the `style` ratchet).
- [ ] **Step 5: Commit** `docs(readme): status: preview, and a walkthrough a test runs verbatim`.

### Task 4: The runbook, and the whole suite

**Files:** Modify `docs/runbook.md`.

**Interfaces:**
- `docs/runbook.md` gains `## Going public as a preview`: after this slice merges and CI is green on `main` on all three systems, the author changes the repository's visibility to Public in GitHub's settings (D-28); nothing is published to npm, which keeps the 0.0.1 placeholder until S-24 publishes 0.1; a failure of `walkthrough.test.js` on `main` after that is a broken first impression and is fixed before anything else.

- [ ] **Step 1: Write** the section.
- [ ] **Step 2: Run** `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 3: Commit** `docs(runbook): going public as a preview`.
