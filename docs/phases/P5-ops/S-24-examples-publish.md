---
slice: P5/S-24
name: Examples, walkthrough, user guide
repo: .
group: C
runbook: yes
requirements: [REQ-4.8, REQ-5.5, REQ-5.6, REQ-5.7, REQ-5.8]
decisions: [D-28, D-33, D-41, D-47, D-53, D-59, D-60, D-61]
---

## Done when

1. `examples/fullstack` and `examples/data` exist, committed as init leaves them (D-59); every example checks green with `0 findings` in a fresh git repository; every rendered file an example holds equals what the running kit renders, and one that differs fails naming the file; each example takes its slice from `todo` to `draft-pr` with a fixture host, then `graph` and every query exit 0 (REQ-5.5).
2. A config with an older `configVersion` is migrated on the first command that is not `hook`, written once, and each change printed on stderr; a hook reads it migrated and writes nothing; a newer `configVersion` is refused naming both versions; the kit's own config and `examples/backend`'s are at version 2 (REQ-5.6, D-60).
3. The user guide has a page for every `slicekit` command, every `/slicekit` procedure and every check rule, each rule page with a section The failure it prevents, and a test fails naming any one missing; the graph page says the graph is not a code graph and gives the graphify line; the README links the guide (REQ-5.8, REQ-4.8, D-61).
4. The README's status names Phase 5 as built and says versions are published from CI (S-48); the README walkthrough still exits 0 on `examples/backend` (REQ-5.7).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `walkthrough.test.js » the README walkthrough's commands exit 0 on examples/backend` | e2e | REQ-5.7 |
| `examples.test.js » every example checks green` | happy | REQ-5.5 |
| `examples.test.js » a rendered adapter file that differs from its template fails, naming the file` | negative | REQ-5.5 |
| `examples.test.js » each example takes its slice to a draft pull request, then graph and every query answer` | e2e | REQ-5.5 |
| `config.test.js » an older configVersion is migrated and each change printed` | happy | REQ-5.6 |
| `config.test.js » a hook reads an older config without writing it` | negative | REQ-5.6 |
| `config.test.js » a configVersion newer than the kit's is refused, naming both` | negative | REQ-5.6 |
| `user-guide.test.js » a command or check rule with no guide page fails, naming it` | negative | REQ-5.8 |
| `user-guide.test.js » every rule page says the failure it prevents` | happy | REQ-5.8 |
| `user-guide.test.js » the graph page says the graph is not a code graph and gives the graphify line` | happy | REQ-4.8 |
| `readme.test.js » the status names Phase 5 as built and links the guide` | happy | REQ-5.7 |

## Expected changes

`examples/fullstack/`, `examples/data/`, `examples/backend/.slicekit/config.json`, `src/config.js`, `src/cli/index.js`, `.slicekit/config.json`, `docs/guide/`, `README.md`, `.claude/`, tests.

## Tasks

### Task 1: configVersion 2 and the migration

**Files:** Modify `src/config.js`, `src/cli/index.js`, `examples/backend/.slicekit/config.json`, `.slicekit/config.json`, `test/config.test.js`, `test/cli.test.js`.

**Interfaces:**
- `CONFIG_VERSION = 2`. `defaultConfig` no longer writes `repos`. `validateConfig` on a version 2 config holding `repos` gives `repos: removed in configVersion 2; list repositories in .slicekit/workspace.json`.
- `MIGRATIONS`: `{1: (cfg) → string[]}`, each taking a config one version old, changing it in place and returning its change lines. Version 1 to 2 deletes `repos` and returns `removed repos, unread since D-47`, plus, when it held entries, `repos held <names joined by ", ">; list them in .slicekit/workspace.json`.
- `class ConfigNewerError extends ConfigError`: `config: configVersion <n> is newer than this kit's <CONFIG_VERSION>; upgrade slicekit`.
- `migrateConfig(cfg) → {cfg, from, changes}`: a copy at `CONFIG_VERSION`; `from` the version read; `changes` empty when it was current. A `configVersion` that is not an integer of 1 or more is left to `validateConfig`; one above `CONFIG_VERSION` throws `ConfigNewerError`.
- `loadConfig(root)` validates the migrated copy and never writes.
- `migrateConfigFile(root) → {from, to, changes} | null`: reads the config, and when it is older writes the migrated copy through a temporary name and a rename, JSON with two-space indentation and a final newline; `null` when there is no config file, it is not JSON, or it is current.
- `main()`: after `--version`, `--help` and the command lookup, and before `command.run`, unless the command is `hook`, calls `migrateConfigFile(io.cwd)` (so `init` rerun on an older config reads it migrated) and prints `config: migrated .slicekit/config.json from configVersion <from> to <to>` and one `  - <change>` line per change on stderr; a `ConfigNewerError` prints `slicekit: <message>` and exits 2.
- The kit's own config is moved to version 2 by running any command, and committed with `node bin/slicekit.js build config P5/S-24` (D-53).

- [ ] **Step 1: Failing tests** — `an older configVersion is migrated and each change printed`: a repository with a version 1 config holding `repos: []`, then `slicekit status` → stderr holds the migrated line and `  - removed repos, unread since D-47`; the file holds `"configVersion": 2` and no `repos`; a second `slicekit status` prints no migration line. `a hook reads an older config without writing it`: the same config, `slicekit hook stop` with Stop's JSON on stdin → the file's bytes are unchanged. `a configVersion newer than the kit's is refused, naming both`: `configVersion: 3` → exit 2 with `configVersion 3 is newer than this kit's 2`. `init rerun on an older config migrates it first`: the same version 1 config, then `slicekit init --shape backend` → exit 0 and the file holds `"configVersion": 2`. A version 2 config holding `repos` is refused naming `repos`.
- [ ] **Step 2: Run** `node --test test/config.test.js test/cli.test.js` → FAIL.
- [ ] **Step 3: Implement**; update the backend example's config by hand; then `node bin/slicekit.js status` and `node bin/slicekit.js build config P5/S-24`.
- [ ] **Step 4: Run** the same and `node --test test/init.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(config): configVersion 2 drops repos; older configs migrate on first run`.

### Task 2: The fullstack and data examples

**Files:** Create `examples/fullstack/`, `examples/data/`, `test/examples.test.js`.

**Interfaces:**
- `examples/fullstack`, "counter": `README.md` (what it is, how it was made: the docs written as `examples/backend`'s are, then `init --shape fullstack --name counter --cli slicekit` and `status --write`); `docs/` at the end of the plan stage with `REQ-1.1` (`GET /count` answers `{"count": <n>}`) and `REQ-1.2` (the page shows the count, and the designer's rules in `docs/spec/stack.md` apply), one decision, one phase with one slice `P1/S-01`, `runbook: no`, evaluation tests `count.test.js` and `page.test.js`; `.slicekit/config.json` with `commands.test` `node --test`; `package.json` with no dependencies; the files init and status leave: `.claude/` with the designer agent, `.githooks/`, the workflow, `.slicekit/rendered/`, `BUILD.md`.
- `examples/data`, "sales summary": the same layout with `--shape data --name sales`; `REQ-1.1` (`summarise(rows)` totals each region's sales); a `sales.csv` of five rows in its data directory; one slice `P1/S-01` whose evaluation tests are `summarise.test.js` and `summarise-empty.test.js`.
- In the test file: `copyExample(name) → {root, cleanup}`: the example copied into `os.tmpdir()`, `git init -b main`, `core.hooksPath` set, everything committed with `ALLOW_PROTECTED_COMMIT=1`; for `backend`, after `init --shape backend --cli <kit>`, as the walkthrough runs it. `renderDrift(root) → dest[]`: the files whose `planUpdate` status at `kitVersion()` is not `same`.
- The e2e test drives each example's slice with `state set` and the evidence each move requires (`tests-red`, `building`, `draft-pr` with a fixture host's pull request 1), runs `graph`, then `trace REQ-1.1`, `history src`, `impact P1/S-01`, `uncovered`, `shipped P1` (which exits 1 with `P1 has no release record`, the expected answer before a release) and `status`.

- [ ] **Step 1: Failing tests** — `every example checks green`: for `backend`, `fullstack` and `data`, `check` in the copy prints `0 findings`. `a rendered adapter file that differs from its template fails, naming the file`: in a copy of `fullstack`, one line added to `.claude/commands/slicekit.md` → `renderDrift` names it and `check` reports it under `managed`; for each example as committed, `renderDrift` is empty. `each example takes its slice to a draft pull request, then graph and every query answer`.
- [ ] **Step 2: Run** `node --test test/examples.test.js` → FAIL.
- [ ] **Step 3: Implement**: write each example's docs, run init and `status --write` in it, commit what they leave.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(examples): fullstack and data, committed as init leaves them`.

### Task 3: The user guide

**Files:** Create `docs/guide/`, `test/user-guide.test.js`. Modify `README.md`, `test/readme.test.js`.

**Interfaces:**
- Pages: `docs/guide/README.md` linking every page; `docs/guide/commands/<name>.md` for each key of `COMMANDS` in `src/cli/index.js`; `docs/guide/slash/<name>.md` for each name in `PROCEDURES` of `src/instructions.js`, plus `slash/slicekit.md` for `/slicekit` itself; `docs/guide/rules/<id>.md` for each rule in `ALL_RULES` of `src/check/index.js`. <!-- slicekit:pending P5/S-24 -->
- A command page: the usage line as `--help` prints it, what it reads and writes, its exit codes, one example. A slash command page: what the human types, which agents it spawns, which `slicekit` commands its procedure runs, what it leaves behind. A rule page: what fails, and a section `## The failure it prevents` naming the failure the rule exists for, in one paragraph.
- `docs/guide/commands/graph.md` holds the README's scope line: the graph is built from the kit's IDs and git, is not a code graph, and the graphify line. <!-- slicekit:pending P5/S-24 -->
- The README gains a `## User guide` section after `## Scope` linking the guide's README and `docs/adapters.md`.

- [ ] **Step 1: Failing tests** — `a command or check rule with no guide page fails, naming it`: the test's `missingPages()` lists `commands/<name>`, `slash/<name>` or `rules/<id>` for each one with no page; it is empty for the kit, and a fake entry added to a copy of the lists is named. `every rule page says the failure it prevents`. `the graph page says the graph is not a code graph and gives the graphify line`. `the status names Phase 5 as built and links the guide` in `test/readme.test.js`, with the status change of Task 4.
- [ ] **Step 2: Run** `node --test test/user-guide.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Implement** the pages.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings` (the references and style rules read every page).
- [ ] **Step 5: Commit** `docs(guide): a page per command, slash command and check rule`.

### Task 4: The README status and the renders

**Files:** Modify `README.md`, `.claude/`, `examples/fullstack/`, `examples/data/`, `test/readme.test.js`.

**Interfaces:**
- The version and the changelog are not this slice's: S-48's sync step sets them when this slice merges (D-90).
- The README's status section names Phase 5's commands as built and says versions are published from CI with provenance.
- `node bin/slicekit.js build render P5/S-24` re-renders the kit's `.claude/`; `slicekit update --yes` in each of `examples/fullstack` and `examples/data` re-renders them at the kit's version, and both are committed.

- [ ] **Step 1: Failing tests** — `renderDrift` of Task 2 names every rendered file until the examples are re-rendered.
- [ ] **Step 2: Run** `node --test test/readme.test.js test/examples.test.js` → FAIL.
- [ ] **Step 3: Implement**; render the kit and both examples.
- [ ] **Step 4: Run** the same, `node --test test/walkthrough.test.js` once, and `node bin/slicekit.js check` → PASS, `0 findings`. CI's full suite on three operating systems is the gate (D-43).
- [ ] **Step 5: Commit** `chore(examples): renders and the README status`.
