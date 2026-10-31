---
slice: P3/S-35
name: Release 0.2.0
repo: .
group: C
runbook: yes
requirements: [REQ-1.1, REQ-5.7, REQ-5.8]
decisions: [D-41]
---

## Done when

1. `package.json` carries `0.2.0` and the kit's own rendered files are re-rendered for it. Publishing stays the author's, after merge (D-41).
2. The README's `## Status: preview` says Phases 1 to 3 work, names the Phase 3 commands (`graph`, `trace`, `impact`, `history`, `uncovered`, `shipped`, `visualize`) and workspaces, and says Phase 4 (release, ops, audit and the other examples) is not built yet. Its install block and the hooks section give `npm install --save-dev slicekit`. `init`'s not-installed warning gives the same command: `slicekit is not installed locally or on PATH; hooks will fail until it is (npm install --save-dev slicekit, or set cli in .slicekit/config.json)`.
3. `slicekit --help` prints the usage to standard output and exits 0, so `slicekit --help | less` shows it. An unknown command still prints the usage and its error to standard error and exits 2. Every usage line in the help begins with the command's name, with no `slicekit ` prefix and no description after the syntax.
4. A new `CHANGELOG.md` at the repository root lists 0.2.0 (the graph, its queries, `visualize`, workspaces and contracts, the CI speed-up, and the fixes of S-30, S-33 and S-34, each with its issue numbers) and the earlier previews 0.1.1 and 0.1.2 in one line each. The runbook's release steps name it: the changelog entry is written in the release slice, before the version is published.
5. `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `package.test.js » package.json is 0.2.0, links the repository and has no dependencies` | happy | REQ-5.7 |
| `readme.test.js » the status names Phase 3's commands and the install uses --save-dev` | happy | REQ-5.7 |
| `init.test.js » the not-installed warning gives npm install --save-dev slicekit` | happy | REQ-1.1 |
| `cli.test.js » --help prints the usage on standard output and exits 0` | happy | REQ-1.1 |
| `cli.test.js » an unknown command prints the usage on standard error and exits 2` | negative | REQ-1.1 |
| `cli.test.js » every usage line begins with its command's name` | happy | REQ-1.1 |
| `runbook.test.js » the release steps write the changelog entry before publishing` | happy | REQ-5.8 |

## Expected changes

`package.json`, `README.md`, `CHANGELOG.md`, `src/hook-cli.js`, `src/cli/index.js`, `src/cli/decide.js`, `src/cli/gaps.js`, `src/cli/hook.js`, `src/cli/intake.js`, `docs/runbook.md`, `.claude/`, `.slicekit/rendered/`, `test/package.test.js`, `test/readme.test.js`, `test/init.test.js`, `test/hook-cli.test.js`, `test/cli.test.js`, `test/runbook.test.js`, tests.

## Tasks

### Task 1: The version, the README, the help and the changelog

Build this slice after P3/S-33 and P3/S-34 have merged, so the changelog and the rendered files carry their changes.

**Files:** as Expected changes.

- [ ] **Step 1: Failing tests:** the seven tests above. The existing tests that pin `0.1.2` or `npm i -D slicekit` change through `build amend` with the reason "0.2.0 release (S-35)".
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** Done when 1 to 4; run `node bin/slicekit.js update --yes`.
- [ ] **Step 4: Run** the targeted tests and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `release(P3/S-35): 0.2.0`.
