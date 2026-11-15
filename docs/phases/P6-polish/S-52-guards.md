---
slice: P6/S-52
name: Guards
repo: .
group: A
runbook: yes
requirements: [REQ-3.2, REQ-3.3, REQ-3.13, REQ-3.14]
decisions: [D-72, D-83, D-88]
---

## Done when

1. `pre-bash` denies, in every session, a `gh api` call that writes the host's rules by a route it let through: a GraphQL call whose query names a mutation of branch protection or of a repository ruleset, such as `deleteBranchProtectionRule`, and a GraphQL call whose query is not in the command text (read from a file or a variable), since it cannot be judged; a GraphQL query that names no such mutation is allowed (issue #103). An endpoint given as a full URL, `https://api.github.com/repos/o/r/rulesets/1` or the same path under a GitHub Enterprise Server host's `api/v3` prefix, is judged as its path is (issue #104, REQ-3.14, D-88).
2. `pre-bash` denies a write to a test frozen for the active slice, in the main session and from a subagent, by the clobber redirection `>|`, written against the preceding word or apart from it (issue #106), and by `perl -i` in its spellings, `dd of=`, `install`, `ln` with the test as the link name, `git checkout` naming the file and `git restore` naming it; each denial names the test and the slice. The same commands on a file that is not frozen are allowed. The header comment of `src/hooks/pre-bash.js` lists the forms it guards and, under Known gaps, the forms it still does not see (issue #105, REQ-3.2, REQ-3.3).
3. While `agents.denyPaths` is set, a `cd` or `pushd` whose target holds a glob character is refused as a `cd` the guard cannot resolve, and a `cd` to a directory that does not exist yet is followed by its name, so `mkdir x && cd x && cat ../data/x.xml` is denied under `data/**` and `mkdir x && cd x && ls` is allowed (issue #118). A `cd` inside a backtick substitution ends at the closing backtick, as one inside `( … )` does: `` echo `cd src && pwd`; cat data/x.xml `` is denied (issue #121, REQ-3.13).
4. A command-line glob the guard cannot compile, such as the reversed range in `cat src/[z-a].js`, is judged as the literal word, as Bash passes it on; the hook does not throw, and the command is allowed when it names no listed path (issue #119). A relative name is outside the repository only when `..` is a whole path component: `cat ..secret` is denied under the pattern `..secret` (issue #123). `validateConfig` compiles each `agents.denyPaths` pattern with the code the guards match with and refuses one that does not compile, as `agents.denyPaths[<i>]: <reason>` (issue #120, REQ-3.13, D-72). The runbook's section on data and secret paths says what a refused pattern looks like and how a `cd` is judged.
5. `pre-edit` denies an Edit or Write to a listed path named through an absolute path that reaches the repository root by a link or junction from outside it, and a relative name given while the working directory is inside a listed directory that links out of the repository; each denial names the pattern (issue #122, REQ-3.13). Every hook test that passed before the slice passes unchanged, and `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `hooks/pre-bash.test.js » a GraphQL mutation that writes branch protection or a ruleset is denied, and a query is allowed` | negative | REQ-3.14 |
| `hooks/pre-bash.test.js » a gh api write to a ruleset through a full URL is denied` | negative | REQ-3.14 |
| `hooks/pre-bash-redirect.test.js » the clobber redirection to a frozen test is denied` | negative | REQ-3.2 |
| `hooks/pre-bash-redirect.test.js » perl -i, dd, install, ln, git checkout and git restore on a frozen test are denied` | negative | REQ-3.2 |
| `hooks/pre-bash-deny.test.js » a cd to a glob is refused and a cd to a directory the command creates is followed` | negative | REQ-3.13 |
| `hooks/pre-bash-deny.test.js » a cd inside a backtick substitution ends at the closing backtick` | negative | REQ-3.13 |
| `hooks/pre-bash-deny.test.js » a glob with a reversed range is allowed with no error` | happy | REQ-3.13 |
| `hooks/pre-bash-deny.test.js » a name beginning with two dots is judged inside the repository` | negative | REQ-3.13 |
| `config.test.js » a deny pattern the guards cannot compile is refused, naming its index` | negative | REQ-3.13 |
| `hooks/pre-edit.test.js » a listed path named through a link to the repository root, or from inside a linked directory, is denied` | negative | REQ-3.13 |

## Expected changes

`src/hooks/pre-bash.js`, `src/hooks/pre-edit.js`, `src/hooks/paths.js`, `src/config.js`, `docs/runbook.md`, tests.

## Tasks

Every task ends its run step with `node --test test/hooks/pre-bash.test.js test/hooks/pre-bash-redirect.test.js test/hooks/pre-bash-deny.test.js test/hooks/pre-edit.test.js`: a guard change that turns an earlier deny into an allow fails there.

### Task 1: Host-rule writes through GraphQL and a full URL

**Files:** Modify `src/hooks/pre-bash.js`, `test/hooks/pre-bash.test.js`.

- [ ] **Step 1: Failing tests** — the tests this slice adds to `test/hooks/pre-bash.test.js`, each command judged in the main session and from a subagent; the commands are those of issues #103 and #104, and the test also holds a read with `-X GET` on the full URL and a GraphQL query, both allowed.
- [ ] **Step 2: Run** `node --test test/hooks/pre-bash.test.js` → FAIL.
- [ ] **Step 3: Implement** in rule 0b: strip a scheme and host, and an `/api/v3` prefix, before `HOST_RULES_PATH` is tried; read the `query` field of a `graphql` endpoint and deny a named mutation or a query the text does not hold.
- [ ] **Step 4: Run** the hook tests → PASS.
- [ ] **Step 5: Commit** `fix(hooks): pre-bash denies a host-rule write through GraphQL or a full URL`.

### Task 2: More ways to write a frozen test

**Files:** Modify `src/hooks/pre-bash.js`, `test/hooks/pre-bash-redirect.test.js`.

- [ ] **Step 1: Failing tests** — the tests this slice adds to `test/hooks/pre-bash-redirect.test.js`, on the fixture that file already builds; each also runs the command on a file that is not frozen and expects an allow.
- [ ] **Step 2: Run** `node --test test/hooks/pre-bash-redirect.test.js` → FAIL.
- [ ] **Step 3: Implement**: the lexer reads `>|` as one redirection operator, so its target word is a write; `writeTargets` gains the commands of Done when 2. Rewrite the header's rule 0c line and its Known gaps.
- [ ] **Step 4: Run** the hook tests → PASS.
- [ ] **Step 5: Commit** `fix(hooks): pre-bash sees the clobber redirection and more writers of a frozen test`.

### Task 3: cd, globs and the outside test under the deny-list

**Files:** Modify `src/hooks/pre-bash.js`, `test/hooks/pre-bash-deny.test.js`.

- [ ] **Step 1: Failing tests** — the tests this slice adds to `test/hooks/pre-bash-deny.test.js`; the commands are those of issues #118, #119, #121 and #123, with `..secret` added to the fixture's files and patterns for the last.
- [ ] **Step 2: Run** `node --test test/hooks/pre-bash-deny.test.js` → FAIL.
- [ ] **Step 3: Implement**: a glob target sets `cdUnknown`; a target that does not exist is resolved by its name; the walk restores the directory at a closing backtick; `globRe` returns no expression for a class it cannot compile and its callers judge the literal word; the outside test reads `..` as a component.
- [ ] **Step 4: Run** the hook tests → PASS.
- [ ] **Step 5: Commit** `fix(hooks): pre-bash judges a cd it cannot resolve, a reversed range and a ..name`.

### Task 4: A deny pattern is compiled when the config is validated

**Files:** Modify `src/hooks/paths.js`, `src/config.js`, `docs/runbook.md`, `test/config.test.js`.

- [ ] **Step 1: Failing test** — the `config.test.js` test above: a config whose second pattern is `[z-a]` gives one error naming `agents.denyPaths[1]`, and a config of valid patterns gives none.
- [ ] **Step 2: Run** `node --test test/config.test.js` → FAIL.
- [ ] **Step 3: Implement**: `src/hooks/paths.js` exports the check that compiles one pattern as `matchesDeny` does, and `agentsErrors` calls it. These files must not import each other in a way that leaves a binding unset at load; if they would, the compiler moves to a file both import. Add the runbook's lines.
- [ ] **Step 4: Run** the same and the hook tests → PASS.
- [ ] **Step 5: Commit** `fix(config): a deny pattern the guards cannot compile is refused by name`.

### Task 5: pre-edit and a listed path behind a link

**Files:** Modify `src/hooks/pre-edit.js`, `src/hooks/paths.js`, `test/hooks/pre-edit.test.js`.

- [ ] **Step 1: Failing test** — the test this slice adds to `test/hooks/pre-edit.test.js`, with links made as the existing link test of that file makes them: a directory junction on Windows, a directory symlink elsewhere.
- [ ] **Step 2: Run** `node --test test/hooks/pre-edit.test.js` → FAIL.
- [ ] **Step 3: Implement**: a name whose existing ancestor resolves to the repository root is mapped back to the root before it is matched, and a relative name is judged against the working directory as given as well as resolved.
- [ ] **Step 4: Run** the hook tests and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `fix(hooks): pre-edit judges a listed path named through a link`.
