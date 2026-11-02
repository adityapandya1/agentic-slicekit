---
slice: P4/S-39
name: Paths agents may not touch
repo: .
group: F
runbook: yes
requirements: [REQ-3.13, REQ-3.3]
decisions: [D-72]
---

## Done when

1. Config accepts `agents.denyPaths`, a list of glob strings, empty by default; any other type is refused by `validateConfig` naming the key (REQ-3.13).
2. Init and update render each pattern into `.claude/settings.json` as `Read(<pattern>)` and `Edit(<pattern>)` entries of `permissions.deny`, inside the kit's managed entries, so the agent tool refuses a read; a team's own deny entries are kept (REQ-3.13).
3. `pre-edit` denies an Edit or Write to a matching path, and `pre-bash` denies a command naming a matching path, each naming the pattern (REQ-3.13, REQ-3.3).
4. With the list empty, nothing is denied that is not denied today (REQ-3.13).
5. `docs/runbook.md` says how a team lists its data and secret paths (REQ-3.13).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `render/settings.test.js » agents.denyPaths renders Read and Edit deny rules and keeps the team's own` | happy | REQ-3.13 |
| `hooks/pre-edit.test.js » an edit to a path in agents.denyPaths is denied, naming the pattern` | negative | REQ-3.13, REQ-3.3 |
| `hooks/pre-bash.test.js » a command naming a path in agents.denyPaths is denied` | negative | REQ-3.13 |
| `config.test.js » agents.denyPaths that is not a list of strings is refused` | negative | REQ-3.13 |

## Expected changes

`src/config.js`, `src/render/settings.js`, `src/hooks/paths.js`, `src/hooks/pre-edit.js`, `src/hooks/pre-bash.js`, `docs/runbook.md`, `test/fixtures/golden/`, tests.

## Tasks

### Task 1: Config and render

**Files:** Modify `src/config.js`, `src/render/settings.js`, `test/config.test.js`, `test/render/settings.test.js`, `test/fixtures/golden/`.

- [ ] **Step 1: Failing tests** — the first and fourth tests above.
- [ ] **Step 2: Implement**; the glob match is one exported `matchesDeny(path, patterns)` in `src/hooks/paths.js` reused by both hooks.
- [ ] **Step 3: Run** `node --test test/config.test.js test/render/settings.test.js` → PASS.

### Task 2: The guards

**Files:** Modify `src/hooks/pre-edit.js`, `src/hooks/pre-bash.js`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the second and third tests above.
- [ ] **Step 2: Implement**; `node bin/slicekit.js build render P4/S-39` for the kit's own settings.
- [ ] **Step 3: Run** `node --test test/hooks/pre-edit.test.js test/hooks/pre-bash.test.js` → PASS.
- [ ] **Step 4: Commit** `feat(hooks): agents.denyPaths keeps listed paths from agents`.
