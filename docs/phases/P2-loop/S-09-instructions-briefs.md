---
slice: P2/S-09
name: `instructions`, the agent briefs and the shared commands
repo: .
group: A
runbook: yes
requirements: [REQ-2.12, REQ-2.1, REQ-1.4, REQ-1.7, REQ-2.10]
decisions: [D-07, D-09, D-17, D-19]
---

## Done when

1. `slicekit instructions <role> [P<n>/S-<nn>]` prints the brief of each of the six roles from one template set, with the slice file, its cited REQ blocks and D rows, the team's commands and the writing rules inlined; with no slice argument the slice comes from the current branch; subagent-start injects that brief without a second copy of the writing rules (REQ-2.12).
2. `slicekit instructions --command <name> [args]` prints a slash command's procedure; every rendered `.claude/commands/slicekit-*.md` is a one-line pointer to it; a command whose procedure is not built yet exits 1 naming it.
3. `slicekit decide add` and `slicekit decide settle` write decision rows with the next ID, the type, who and when; a settled row is never rewritten (REQ-1.4).
4. `slicekit stage require <stage>` exits 1 naming the first incomplete stage and the command that does it (REQ-1.7); `slicekit branch <spec|gaps|plan> <slug>` puts the session on a work branch cut from the default branch.
5. `slicekit pr open` commits named paths, pushes, and opens or updates a pull request through C-1 (`openPullRequest`, `updatePullRequestBody`, `markReady`, `pullRequestForBranch`, each with fixture support); it refuses a body the CI body rule would fail before anything is pushed (REQ-2.10, REQ-2.1).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `instructions.test.js » each role's brief inlines the slice file, its REQ and D rows and the writing rules` | happy | REQ-2.12 |
| `instructions.test.js » an unknown role exits 2` | negative | REQ-2.12 |
| `instructions.test.js » the slice comes from the branch when no argument is given` | happy | REQ-2.12 |
| `instructions.test.js » a command whose procedure is not built exits 1` | negative | REQ-2.12 |
| `hooks/subagent-start.test.js » a brief from instructions is not followed by a second copy of the writing rules` | negative | REQ-2.12 |
| `briefs.test.js » no brief tells an agent to run git` | negative | REQ-2.1 |
| `decisions.test.js » add writes the next id with who and when` | happy | REQ-1.4 |
| `decisions.test.js » a pipe in the answer is escaped and a newline is refused` | negative | REQ-1.4 |
| `stage-cli.test.js » require names the first incomplete stage and its command` | negative | REQ-1.7 |
| `branch.test.js » branch starts from the default branch and refuses a dirty tree` | negative | REQ-2.1 |
| `pr.test.js » open pushes and opens a draft through the fixture host` | happy | REQ-2.10 |
| `pr.test.js » a body missing a section is refused before anything is pushed` | negative | REQ-2.10 |
| `prbody.test.js » setSection keeps text outside the section` | negative | REQ-2.10 |

## Expected changes

`src/instructions.js`, `src/decisions.js`, `src/prbody.js`, `src/pr.js`, `src/cli/{instructions,decide,stage,branch,pr}.js`, `src/git.js`, `src/stage.js`, `src/slicefile.js`, `src/check/rules/ci-body.js`, `src/hooks/subagent-start.js`, `src/adapters/githost/`, `templates/instructions/agents/`, `templates/claude-code/commands/`, `.claude/commands/`, `.slicekit/rendered/`, `docs/runbook.md`, `docs/adapters.md`, `docs/spec/contracts/C-1-git-host.md`, `test/helpers/`, tests.

## Tasks

### Task 1: Decision rows

**Files:** Create `src/decisions.js`, `src/cli/decide.js`, `test/decisions.test.js`. Modify `src/cli/index.js` (register `decide`).

**Interfaces:**
- `TYPES = ['Decision','Action','Information','Counsel','Open']`; `class DecisionError extends Error` with `code` 1 (a file problem) or 2 (bad input).
- `readDecisions(text) → {rows, next}`. Rows come from the tables under `## Settled` (`# | Type | Question | Answer | Who, when`) and `## Open` (`# | Type | Question | Why it matters | Recommendation`); each is `{id, n, table:'settled'|'open', type, question, answer, who, why, recommendation, line}`, with `\|` read as `|`. `next` is the highest `n` plus one, zero-padded to the widest ID already used (rows up to `D-37` written as `D-01`.. give `D-38`; an empty file gives `D-1`). <!-- slicekit:example -->
- `addDecision(root, cfg, {type, question, answer?, why?, recommendation?, who?, replaces?, iface?, today?}) → {id}`. Type `Open` goes to the Open table and needs `why` and `recommendation`; any other type goes to Settled and needs `answer`. Every text field: a `\r` or `\n` → code 2 `<field> must be one line`; `|` is written as `\|`. `replaces: 'D-<n>'` must name a row (code 2 `unknown decision D-<n>`) and prefixes the question with `Replaces D-<n>. `. `iface: {name, source?}` prefixes the question with `Interface: <name>. ` and, given a source `<file>:<line>`, ends the answer with ` Named at <file>:<line>.`. `who` defaults to `git config user.name`, else `unknown`; `today` to the UTC date; the last cell is `<who>, <today>`. The row goes after the table's last row. A missing file → code 1 `<path> is missing; run slicekit init`; a missing table → code 1 `decisions.md has no <Settled|Open> table`.
- `settleDecision(root, cfg, id, {answer, type = 'Decision', who?, today?}) → {id}` moves an Open row to Settled under the same ID. A Settled ID → code 1 `D-<n> is settled; a reversal is a new row (decide add --replaces D-<n>)`.
- `interfacesNamed(text) → [{id, name, source}]`: the rows whose question begins `Interface: `; `source` is the `Named at` location or null. S-10 writes this register.
- `interfacesWithoutContract(root, cfg) → [{id, name, source, line}]`: each interface row that no file under `<docsRoot>/spec/contracts/` names on its `Cites:` line; `line` is the row's line in `decisions.md`. S-11 and S-12 both report these, so the rule has one home.
- CLI `decide add --type <T> --question <q> (--answer <a> | --why <w> --recommendation <r>) [--who <w>] [--replaces D-<n>] [--interface <name> [--source <file>:<line>]]` and `decide settle D-<n> --answer <a> [--type <T>] [--who <w>]`; each prints the ID; `subcommands = ['add','settle']`.

- [ ] **Step 1: Failing tests** — `add writes the next id with who and when`: on a decisions file holding D-01 to D-03, `decide add --type Decision --question q --answer a --who ann` prints `D-04` and the Settled table ends with a row matching `| D-04 | Decision | q | a | ann, <yyyy-mm-dd> |`; `--type Open --question q --why w --recommendation r` lands in the Open table. `a pipe in the answer is escaped and a newline is refused`: answer `a|b` is stored as `a\|b` and `readDecisions` returns `a|b`; a question holding a line break exits 2 with `question must be one line` and leaves the file unchanged. Also `settle moves an open row and refuses a settled one`, `interfacesNamed reads the name and the source`, and `interfacesWithoutContract skips an interface a contract cites`.
- [ ] **Step 2: Run** `node --test test/decisions.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** `src/decisions.js` and `src/cli/decide.js`. <!-- slicekit:pending P2/S-09 -->
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(decide): decision rows with ids and provenance`.

### Task 2: `instructions`

**Files:** Create `src/instructions.js`, `src/cli/instructions.js`, `test/instructions.test.js`. Modify `src/stage.js`, `src/hooks/subagent-start.js`, `src/cli/index.js`, `test/hooks/subagent-start.test.js`.

**Interfaces:**
- Consumes: `readDecisions` (Task 1); `ROLES` from `src/hooks/shapes.js`.
- `src/stage.js` exports `reqBlocks(root, cfg) → [{id, file, block}]` (the private function it has, with the file added).
- `PROCEDURES = ['intake','specify','gaps','plan','build','review','release','ops','audit']`; `class InstructionsError extends Error` with `code` 1 or 2; `TEMPLATES` is the kit's `templates/instructions` directory.
- `briefSlice(root, arg) → string | null`: `arg` when it is a slice address; any other `arg` → code 2 `not a slice address: <arg>`; no `arg` → `sliceFromBranch(currentBranch(root))`, null outside a repository or off a slice branch.
- `renderBrief(root, cfg, role, sliceId, {templatesDir = TEMPLATES} = {}) → string`. Errors, code 2: `unknown role '<r>'; one of developer, reviewer, fixer, auditor, ops, designer`; `designer is not installed for shape <shape>` unless the shape is fullstack (absent, not disabled); `unknown slice <id>`. Output, in order: the role template (`agents/<role>.md`) with `{{cli}}` replaced; `## Slice <id>` and the slice file verbatim, or `## Slice` and `No active slice.`; `## Requirements` with each named REQ block (`<REQ>: not found under <docsRoot>/spec/` when absent); `## Decisions` with `- D-<n> (<type>): <question> → <answer>` per named row (`- D-<n>: not found in decisions.md`); `## Team commands` with `- <test|lint|build|e2e>: <command or "not declared">`; `## Writing rules` with the project's `.claude/skills/slicekit-writing/SKILL.md`, else the kit template, its front matter and its `# Writing rules` heading removed.
- `renderProcedure(root, cfg, name, args, {templatesDir = TEMPLATES} = {}) → string`: a name outside `PROCEDURES` → code 2 `unknown command '<n>'`; no `commands/<name>.md` → code 1 `the /slicekit <name> command is not built in this version`; replaces `{{cli}}` and `{{args}}` (`args.join(' ')`, or `(none)`).
- CLI `instructions <role> [P<n>/S-<nn>]` and `instructions --command <name> [args…]`, where everything after `<name>` is passed through unparsed (so `--parallel P2` reaches the procedure): prints the text; exit 0, or the error's code with `slicekit: <message>` on stderr. subagent-start calls it as `run([role])` from the session root, so the one-argument form must keep working there.
- subagent-start: `roleBrief` returns `{text, fromKit}`; when `fromKit`, `assemble` adds no separate writing rules (the brief carries them). The placeholder path is unchanged.

- [ ] **Step 1: Failing tests** — in a temp repo with one slice file naming REQ-1.1 and D-01, a spec file defining REQ-1.1 and a decisions file holding D-01: `each role's brief inlines the slice file, its REQ and D rows and the writing rules` (for developer, reviewer, fixer, auditor and ops on backend and designer on fullstack, the output holds `# Brief: <role>`, the slice's `## Done when`, the REQ-1.1 heading line, `- D-01 (Decision):`, `## Writing rules` and the line `- State the fact, the consequence, the check. Not the importance.`); `an unknown role exits 2` (`instructions tester` → 2 and stderr names the six roles; `instructions designer` on backend → 2 with `designer is not installed for shape backend`); `the slice comes from the branch when no argument is given` (on branch `slice/P1-S-01-x`, `instructions developer` holds `## Slice P1/S-01`); `a command whose procedure is not built exits 1` (`renderProcedure` with an empty `templatesDir` → code 1 and the message above; `unknown command 'foo'` → code 2). In `test/hooks/subagent-start.test.js`: `a brief from instructions is not followed by a second copy of the writing rules` (the "State the fact" line occurs once in the injected context).
- [ ] **Step 2: Run** `node --test test/instructions.test.js test/hooks/subagent-start.test.js` → FAIL.
- [ ] **Step 3: Implement** the two modules, the `reqBlocks` export and the subagent-start change. The brief templates arrive in Task 3; the tests write their own into a temp `templatesDir`, and one test reads the kit's `TEMPLATES` once Task 3 lands.
- [ ] **Step 4: Run** the same and `node --test test/stage.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(instructions): one home for briefs and procedures`.

### Task 3: The six briefs, the command pointers and the brief lint

**Files:** Create `templates/instructions/agents/{developer,reviewer,fixer,auditor,ops,designer}.md`, `test/helpers/brief-lint.js`, `test/briefs.test.js`. Modify the nine `templates/claude-code/commands/slicekit-*.md`, the goldens under `test/fixtures/golden/`, and the kit's own `.claude/commands/` and `.slicekit/rendered/` (re-rendered with `node bin/slicekit.js update --yes`).

**Interfaces:**
- Each pointer's body: ``Run `{{cli}} instructions --command <name> $ARGUMENTS` and follow the procedure it prints. The procedure is the only source of this command's rules.`` and the writing-rules line it has; front matter unchanged.
- Each brief has `# Brief: <role>`, `## You write`, `## You never`, `## Your report`, from REQ-2.12's table, and states the shape subagent-stop checks (`src/hooks/shapes.js`): every role ends its reply with a `Skipped:` line and a `Not checked:` line; the developer reports each command as `ran: <command> → exit <code>`; the fixer names each finding ID it answered; the reviewer writes `.slicekit/reviews/P<n>-S-<nn>[i]-r<k>.md` in the session root with `Verdict: BLOCK|CHANGES|APPROVE` as its first line, a findings table `ID | File:line | What is wrong | Why it matters | How verified` (`B-<n>` blockers, `H-<n>` should-haves), `## Checklists run` and `## Not checked` (`src/verdict.js`); ops proposes actions marked by who may take them and changes nothing; the designer gives a verdict on a screen and writes no code. S-12, S-14 and S-15 add the procedure-specific parts of the auditor, developer, reviewer and fixer briefs.
- `briefProblems(text, {kind: 'agent'|'command', commands = COMMANDS, banned = seedBanned()}) → string[]`: each `{{cli}} <word>` names a key of `commands` (`unknown command <word>`), and when that module exports `subcommands` and the next token is a bare lower-case word, that word is one of them (`unknown subcommand <word> <sub>`); in a procedure, a `git` or `gh` command in a code span or at the start of a line → `procedure runs git: <line>`; in a brief, a git command that writes or moves history (`commit`, `push`, `merge`, `rebase`, `reset`, `tag`, `cherry-pick`, `revert`, `am`, `pull`) or any `gh pr`, `gh issue` or `gh api` call, on a line without the word "never" → `brief tells an agent to run git: <line>` (reading with `git diff` or `git log` stays allowed, as pre-bash allows it); each banned phrase (`bannedPhrasesIn`) → `banned phrase "<p>"`; a brief without `Skipped:` or `Not checked:` → `brief does not require "<line>"`.

- [ ] **Step 1: Failing tests** — `no brief tells an agent to run git`: `briefProblems` is `[]` for every file under `templates/instructions/agents/` (kind agent) and matching `templates/instructions/commands/*.md` (kind command; none yet); ``Run `git commit -m x`.`` as a brief gives `brief tells an agent to run git: …`; `{{cli}} nosuch` gives `unknown command nosuch`. `each pointer names its own command`: every `templates/claude-code/commands/slicekit-<name>.md` holds `instructions --command <name> $ARGUMENTS`. <!-- slicekit:pending P2/S-09 -->
- [ ] **Step 2: Run** `node --test test/briefs.test.js` → FAIL.
- [ ] **Step 3: Write** the six briefs and the lint; change the nine pointers; run `node bin/slicekit.js update --yes`; regenerate the three goldens from the renderer.
- [ ] **Step 4: Run** `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(briefs): six agent briefs and one-line command pointers`.

### Task 4: `stage require`, `branch`, and the git helpers

**Files:** Create `src/cli/stage.js`, `src/cli/branch.js`, `test/stage-cli.test.js`, `test/branch.test.js`. Modify `src/git.js`, `src/slicefile.js`, `src/cli/index.js`, `test/helpers/tmp-repo.js`, `test/slicefile.test.js`.

**Interfaces:**
- `src/git.js`: `gitUser(root) → string | null`; `isClean(root) → boolean`; `hasRemote(root, name = 'origin') → boolean`; `switchBranch(root, name, {create = false, from} = {})`; `commitPaths(root, paths, message) → sha | null` (stages `paths`; null when nothing is staged); `pushBranch(root) → {branch, remoteRef}` (pushes `HEAD` to the upstream branch when one is set, else `git push -u origin <branch>`). Each throws `GitError`.
- `src/slicefile.js`: `parseOrder(phaseText) → string[][] | null` from the first line outside fences matching `^\*\*Order:\*\*\s*(.+)$`, split on `;` into steps and on `,` into groups, trimmed. S-13 validates it; S-14 and S-16 follow it.
- `test/helpers/tmp-repo.js`: `makeRemote(root) → {remote, cleanup}` creates a bare repository and adds it as `origin`.
- CLI `stage require <stage>` → `ready: <stage>` and exit 0; the `StageError` message and exit 1; `unknown stage '<s>'; one of intake, clarify, …` and exit 2. `subcommands = ['require']`.
- CLI `branch <spec|gaps|plan> <slug>`: a slug not matching `^[a-z0-9][a-z0-9-]{0,59}$` → exit 2; already on `<kind>/<slug>` → print it, exit 0; uncommitted changes → exit 1 `commit or stash your changes first`; fetches `origin <defaultBranch>` when `origin` exists (a failed fetch prints `slicekit: could not fetch origin (<reason>); branching from local <default>` to stderr); switches to the branch when it exists, else creates it from `origin/<default>` (or the local default). Prints `<kind>/<slug>`. `subcommands = ['spec','gaps','plan']`.

- [ ] **Step 1: Failing tests** — `require names the first incomplete stage and its command`: an initialised repo with no snapshot → exit 1 with `intake not done: no snapshot under docs/intake/; run /slicekit intake`; after a snapshot with a valid sidecar, `stage require clarify` prints `ready: clarify`. `branch starts from the default branch and refuses a dirty tree`: with `makeRemote`, `branch spec demo` prints `spec/demo` and its parent is `origin/main`; with an untracked file present → exit 1 and the branch is unchanged. `parseOrder reads steps and parallel groups`: `**Order:** A; B, C; D` → `[['A'],['B','C'],['D']]`; no line → null.
- [ ] **Step 2: Run** `node --test test/stage-cli.test.js test/branch.test.js test/slicefile.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(cli): stage require, branch and the git helpers`.

### Task 5: Pull requests: C-1 write operations, the body, `pr open`

**Files:** Create `src/prbody.js`, `src/pr.js`, `src/cli/pr.js`, `test/prbody.test.js`, `test/pr.test.js`. Modify `src/check/rules/ci-body.js`, `src/adapters/githost/{github,fixture,gh-json}.js`, `src/cli/index.js`, `docs/runbook.md`, `docs/adapters.md`, `docs/spec/contracts/C-1-git-host.md`.

**Interfaces:**
- `src/prbody.js`: `prBodyProblems(title, body, cfg) → string[]` with exactly the messages the `ci-body` rule emits today; `ci-body` keeps its bot exemption and maps each message to a finding. `renderPrBody({slice, name, sections}) → string`: `## [<slice>] <name>`, then `**<Section>:** <text>` for each of `REQUIRED_SECTIONS` in order (with `slice: null`, no heading and only the first three); a missing or blank section throws `PrBodyError('section "<name>" is empty')`. `setSection(body, name, text) → string` replaces that section's line and its continuation lines (up to the next required section, a heading or the end) and keeps every other byte; an absent section is inserted before the next required section that is present, else at the end. `getSection(body, name) → string | null` returns the text `setSection` would replace. <!-- slicekit:pending P2/S-09 -->
- C-1, the same names on `githubHost` and `fixtureHost`: `openPullRequest({branch, base, title, body, draft}) → {number, url}` (`gh pr create --head --base --title --body-file - [--draft]`, the body on stdin, the number read from the printed URL's `/pull/<n>`); `updatePullRequestBody(number, body)` (`gh pr edit <n> --body-file -`); `markReady(number)` (`gh pr ready <n>`); `pullRequestForBranch(branch) → {number, url} | null` (`gh pr list --head <branch> --state open --json number,url --limit 1`). `gh()` takes an `input` option and then pipes stdin. `mapPullRequest` adds `headRef` (from `headRefName`) and `draft` (from `isDraft`), both null when absent; `PR_FIELDS` gains both.
- Fixture: `openPullRequest` writes `pr-<n>.json`, `n` one above the highest existing `pr-<n>.json` (1 when none), holding `{number, url: 'https://example.test/pull/<n>', state: 'OPEN', isDraft, headRefName, baseRefName, title, body, headRefOid: null, labels: []}`, and is refused when `pr-create-error.txt` exists; `updatePullRequestBody` and `markReady` rewrite that file; `pullRequestForBranch` scans the open ones; each write appends `{op, …input}` to `pr-calls.jsonl`.
- `src/pr.js`: `openOrUpdate(root, cfg, host, {title, body, draft = true, base = cfg.defaultBranch}) → {number, url, created}`. Before pushing it refuses (`PrError`, code 1) from the default or a protected branch (`open a pull request from a work branch, not <b>`) and on any `prBodyProblems`; then `pushBranch`; then it updates the branch's open pull request or opens one. S-14 calls it. <!-- slicekit:pending P2/S-09 -->
- CLI `pr open --title <t> --body-file <f> [--commit <message> --paths <a,b>] [--draft] [--base <b>]`: with `--commit`, `commitPaths` runs first; prints `#<n> <url>`, or `updated #<n> <url>`. `subcommands = ['open']`.

- [ ] **Step 1: Failing tests** — `setSection keeps text outside the section`: a body with a human paragraph after `**Try it:**` and a note under the heading; replacing `Reviewer blocked` changes only that line, and the result has no `prBodyProblems`. `open pushes and opens a draft through the fixture host`: `makeRepo` and `makeRemote`, branch `spec/demo`, title `[spec] demo`, a three-section body → exit 0, stdout `#1 https://example.test/pull/1`, `origin` has `spec/demo` at the local head, and `pr-calls.jsonl` has one `openPullRequest` with `draft: true`; a second run prints `updated #1 https://example.test/pull/1`. `a body missing a section is refused before anything is pushed`: no `**Proof:**` → exit 1 with `pull request body is missing "Proof"`, `origin` has no `spec/demo`, and there is no `pr-calls.jsonl`. Also `the GitHub host passes the body on stdin and reads the number from the url`, through the `exec` seam.
- [ ] **Step 2: Run** `node --test test/prbody.test.js test/pr.test.js` → FAIL.
- [ ] **Step 3: Implement**, moving the body logic out of `ci-body` into `prbody.js`.
- [ ] **Step 4: Run** the same and `node --test test/check/ci-body.test.js test/sync.test.js test/ready-label.test.js` → PASS (the move changes no message).
- [ ] **Step 5: Runbook** — under "Dependencies and their owners" in `docs/runbook.md`, replace "Not yet known" with: `gh` (GitHub CLI), authenticated (`gh auth status`), is needed by `slicekit pr open` and the build commands; tests use `SLICEKIT_GITHOST_FIXTURE` instead. C-1's table gains the row `pullRequestForBranch | branch | number and url of its open pull request, or none`, and `getPullRequest`'s output gains `headRef, draft`. In `docs/adapters.md`, the git host paragraph lists every operation `github.js` implements once this task lands.
- [ ] **Step 6: Commit** `feat(pr): open and update pull requests through C-1`.
